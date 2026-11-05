"""The edge service main loop: config polling, camera workers, event sending, health and heartbeat."""

from __future__ import annotations

import logging
import signal
import threading
import time
from collections.abc import Callable
from types import FrameType

from . import __version__
from .api_client import EdgeApi, EdgeApiError
from .config import Settings
from .detect import Detector
from .events import heartbeat
from .models import CameraConfig, EdgeConfig
from .outbox import Outbox
from .sender import Sender
from .sources import FrameSource, open_source
from .worker import CameraWorker

log = logging.getLogger(__name__)


def make_detector(settings: Settings) -> Detector:
    if settings.detector == "synthetic":
        from .detect.synthetic import SyntheticDetector

        return SyntheticDetector()
    from .detect.yolox import YoloxDetector

    return YoloxDetector(settings.model_path, settings.min_confidence)


def _worker_key(c: CameraConfig) -> str:
    # Everything except the snapshot flag: changing zones, URL or FPS restarts the camera's worker.
    return c.model_copy(update={"snapshot_wanted": False}).model_dump_json()


class EdgeService:
    def __init__(
        self,
        settings: Settings,
        api: EdgeApi | None = None,
        detector: Detector | None = None,
        source_factory: Callable[[str], FrameSource] | None = None,
    ) -> None:
        self.settings = settings
        self.api = api or EdgeApi(
            settings.api_url,
            settings.device_id,
            settings.device_secret.get_secret_value(),
            timeout=settings.http_timeout_seconds,
        )
        self.outbox = Outbox(settings.data_dir / "outbox.sqlite3")
        self.sender = Sender(self.api, self.outbox)
        self.detector = detector or make_detector(settings)
        self._open = source_factory or (lambda url: open_source(url, settings.dev_mode))
        self.config: EdgeConfig | None = None
        self.workers: dict[str, tuple[str, CameraWorker]] = {}
        self._stop = threading.Event()
        self._started = time.monotonic()

    def stop(self, *_: object) -> None:
        self._stop.set()

    def refresh_config(self) -> None:
        try:
            config = self.api.get_config()
        except EdgeApiError as e:
            log.warning("could not load config (keeping the last one): %s", e)
            return
        if self.config is None or config.config_version != self.config.config_version:
            log.info("config %s: %d camera(s)", config.config_version[:8], len(config.cameras))
        self.config = config
        self._reconcile(config)

    def _reconcile(self, config: EdgeConfig) -> None:
        wanted = {c.id: c for c in config.cameras if c.enabled}
        for cam_id in [k for k in self.workers if k not in wanted]:
            self.workers.pop(cam_id)[1].stop()
        for cam_id, cam in wanted.items():
            key = _worker_key(cam)
            current = self.workers.get(cam_id)
            if current and current[0] != key:
                current[1].stop()
                current = None
            if current is None:
                w = CameraWorker(
                    cam,
                    config.settings,
                    self.detector,
                    self.outbox,
                    self.api,
                    self._open,
                    self.settings.min_confidence,
                )
                w.start()
                self.workers[cam_id] = (key, w)
                log.info("camera %s started (%d zone(s), %d fps)", cam.name, len(cam.zones), cam.fps)
            if cam.snapshot_wanted:
                self.workers[cam_id][1].request_snapshot()

    def report_health(self) -> None:
        now = time.time()
        events = [w.health_event(now) for _, w in self.workers.values()]
        events.append(
            heartbeat(
                at=now,
                version=__version__,
                uptime_s=time.monotonic() - self._started,
                queue_depth=self.outbox.depth(),
            )
        )
        self.outbox.put(events)

    def run(self) -> None:
        if threading.current_thread() is threading.main_thread():

            def _handler(_sig: int, _frame: FrameType | None) -> None:
                self.stop()

            signal.signal(signal.SIGTERM, _handler)
            signal.signal(signal.SIGINT, _handler)
        s = self.settings
        next_config = next_health = 0.0
        log.info("dinesense-vision %s for device %s → %s", __version__, s.device_id, s.api_url)
        try:
            while not self._stop.is_set():
                now = time.monotonic()
                if now >= next_config:
                    self.refresh_config()
                    next_config = now + s.config_poll_seconds
                if now >= next_health:
                    self.report_health()
                    next_health = now + s.health_interval_seconds
                while self.sender.flush_once() and not self._stop.is_set():
                    pass
                self._stop.wait(s.send_interval_seconds)
        finally:
            for _, w in self.workers.values():
                w.stop()
            self.sender.flush_once()
            self.api.close()
            self.outbox.close()
