from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from pathlib import Path

import cv2

from ..detect.base import Frame


def iter_video(path: str | Path, sample_fps: float) -> Iterator[tuple[float, Frame]]:
    """Yields (seconds into the video, frame) at about `sample_fps`, as fast as it can decode (for eval)."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise FileNotFoundError(f"cannot open video {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, round(fps / sample_fps))
    i = 0
    try:
        while True:
            ok = cap.grab()
            if not ok:
                return
            if i % step == 0:
                ok, frame = cap.retrieve()
                if ok:
                    yield i / fps, frame
            i += 1
    finally:
        cap.release()


class FileSource:
    """Plays a video file in real time like a camera would (dev mode), looping at the end."""

    def __init__(self, path: str, loop: bool = True, clock: Callable[[], float] = time.monotonic) -> None:
        self.path = path
        self.loop = loop
        self.reconnects = 0
        self.error: str | None = None
        self._clock = clock
        self._cap = cv2.VideoCapture(path)
        if not self._cap.isOpened():
            self.error = f"cannot open {Path(path).name}"
        self._fps = self._cap.get(cv2.CAP_PROP_FPS) or 25.0
        self._start = clock()
        self._pos = -1  # index of the last decoded frame

    def read(self) -> Frame | None:
        if self.error:
            return None
        want = int((self._clock() - self._start) * self._fps)
        if want <= self._pos:
            return None
        frame = None
        while self._pos < want:
            ok = self._cap.grab()
            if not ok:
                if not self.loop:
                    self.error = "end of file"
                    return None
                self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                self._start, self._pos, want = self._clock(), -1, 0
                continue
            self._pos += 1
        ok, frame = self._cap.retrieve()
        return frame if ok else None

    def close(self) -> None:
        self._cap.release()
