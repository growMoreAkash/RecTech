"""One thread per camera: sample frames at the camera's FPS, run the pipeline, queue events.

Frames stay in memory; the only image that leaves is a blurred calibration snapshot when a manager asks.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from .api_client import EdgeApi, EdgeApiError
from .detect import Detector
from .health import CameraStats
from .models import CameraConfig, EdgeSettings
from .outbox import Outbox
from .pipeline import CameraPipeline
from .privacy import snapshot_jpeg
from .sources import FrameSource

log = logging.getLogger(__name__)


class CameraWorker:
    def __init__(
        self,
        camera: CameraConfig,
        settings: EdgeSettings,
        detector: Detector,
        outbox: Outbox,
        api: EdgeApi,
        open_source: Callable[[str], FrameSource],
        min_confidence: float = 0.35,
    ) -> None:
        self.camera = camera
        self.settings = settings
        self.stats = CameraStats(target_fps=camera.fps)
        self._pipeline = CameraPipeline(camera, settings, detector, min_confidence=min_confidence)
        self._outbox = outbox
        self._api = api
        self._open_source = open_source
        self._source: FrameSource | None = None
        self._stop = threading.Event()
        self._snapshot = threading.Event()
        self._error: str | None = None
        self._thread = threading.Thread(target=self._run, name=f"camera-{camera.id}", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=10)

    def request_snapshot(self) -> None:
        self._snapshot.set()

    def health_event(self, now: float) -> dict[str, Any]:
        src = self._source
        return self.stats.event(
            self.camera.id, now, src.reconnects if src else 0, self._error or (src.error if src else None)
        )

    def _run(self) -> None:
        try:
            self._source = self._open_source(self.camera.rtsp_url)
        except Exception as e:
            self._error = str(e)[:200]
            log.error("camera %s: %s", self.camera.name, e)
            return
        interval = 1.0 / max(1, self.camera.fps)
        try:
            while not self._stop.is_set():
                started = time.monotonic()
                frame = self._source.read()
                if frame is not None:
                    now = time.time()
                    try:
                        result = self._pipeline.process(frame, now)
                    except Exception:
                        log.exception("camera %s: pipeline error", self.camera.name)
                        self._stop.wait(1)
                        continue
                    self.stats.frame(now, (time.monotonic() - started) * 1000)
                    if result.events:
                        self._outbox.put(result.events)
                        for ev in result.events:
                            log.info("camera %s: %s %s", self.camera.name, ev["type"], ev.get("tableId", ""))
                    if self._snapshot.is_set():
                        self._snapshot.clear()
                        self._send_snapshot(snapshot_jpeg(frame, result.detections))
                self._stop.wait(max(0.01, interval - (time.monotonic() - started)))
        finally:
            self._source.close()

    def _send_snapshot(self, jpeg: bytes) -> None:
        try:
            self._api.post_snapshot(self.camera.id, jpeg)
            log.info("camera %s: calibration snapshot uploaded (%d KB, blurred)", self.camera.name, len(jpeg) // 1024)
        except EdgeApiError as e:
            log.warning("camera %s: snapshot upload failed: %s", self.camera.name, e)
