from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

import cv2

from ..detect.base import Frame

log = logging.getLogger(__name__)
# TCP is far more reliable than UDP on restaurant Wi-Fi; drop stale frames instead of buffering.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp|stimeout;5000000")


class RtspSource:
    """Reads an RTSP stream on a background thread, keeping only the latest frame. Reconnects with backoff."""

    def __init__(self, url: str, max_backoff: float = 30.0) -> None:
        self._url = url
        self._max_backoff = max_backoff
        self.reconnects = 0
        self.error: str | None = None
        self._latest: Frame | None = None
        self._seq = 0
        self._returned = 0
        self._cond = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="rtsp-reader", daemon=True)
        self._thread.start()

    def _open(self) -> Any:
        cap = cv2.VideoCapture(self._url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def _run(self) -> None:
        backoff = 1.0
        first = True
        while not self._stop.is_set():
            if not first:
                self.reconnects += 1
            first = False
            cap = self._open()
            if not cap.isOpened():
                self.error = "cannot connect"
                cap.release()
                self._stop.wait(backoff)
                backoff = min(self._max_backoff, backoff * 2)
                continue
            backoff = 1.0
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    self.error = "stream interrupted"
                    break
                self.error = None
                with self._cond:
                    self._latest, self._seq = frame, self._seq + 1
            cap.release()
            if not self._stop.is_set():
                log.warning("camera stream lost; reconnecting in %.0fs", backoff)
                self._stop.wait(backoff)

    def read(self) -> Frame | None:
        with self._cond:
            if self._seq == self._returned:
                return None
            self._returned = self._seq
            return self._latest

    def close(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5)


def wait_for_frame(source: RtspSource, timeout: float = 10.0) -> Frame | None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        frame = source.read()
        if frame is not None:
            return frame
        time.sleep(0.05)
    return None
