"""Calibration snapshots only: heads and faces are pixelated before a frame leaves the device.

No face recognition anywhere — faces are only located (OpenCV's bundled Haar cascade, BSD/Intel licence) so they
can be blurred, together with the head region of every detected person box.
"""

from __future__ import annotations

from collections.abc import Sequence
from functools import lru_cache
from typing import Any

import cv2
import numpy as np

from .detect import Detection
from .detect.base import Frame


@lru_cache(maxsize=1)
def _faces() -> Any:
    cascades: str = cv2.data.haarcascades  # type: ignore[attr-defined]
    return cv2.CascadeClassifier(cascades + "haarcascade_frontalface_default.xml")


def _pixelate(img: Frame, x1: int, y1: int, x2: int, y2: int) -> None:
    h, w = img.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
    if x2 - x1 < 2 or y2 - y1 < 2:
        return
    roi = img[y1:y2, x1:x2]
    small = cv2.resize(roi, (max(1, (x2 - x1) // 12), max(1, (y2 - y1) // 12)), interpolation=cv2.INTER_AREA)
    img[y1:y2, x1:x2] = cv2.resize(small, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST)


def blur_people(frame: Frame, people: Sequence[Detection]) -> Frame:
    out = frame.copy()
    for d in people:
        pad = 0.15 * d.width
        _pixelate(out, int(d.x1 - pad), int(d.y1 - pad), int(d.x2 + pad), int(d.y1 + 0.35 * d.height))
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    for x, y, w, h in _faces().detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(16, 16)):
        _pixelate(out, int(x - 0.2 * w), int(y - 0.2 * h), int(x + 1.2 * w), int(y + 1.2 * h))
    return out


def snapshot_jpeg(frame: Frame, people: Sequence[Detection], max_width: int = 1280, quality: int = 80) -> bytes:
    img = blur_people(frame, people)
    if img.shape[1] > max_width:
        scale = max_width / img.shape[1]
        img = cv2.resize(img, (max_width, int(img.shape[0] * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    return bytes(np.asarray(buf).tobytes())
