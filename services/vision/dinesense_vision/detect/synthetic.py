"""Detector for footage made by `ds-vision synth` (dev mode and eval only).

Synthetic people are saturated colour blobs on a grey/brown scene; this finds them by colour. It does not work on
real footage — use the YOLOX detector for real cameras.
"""

from __future__ import annotations

import cv2
import numpy as np

from .base import Detection, Frame


class SyntheticDetector:
    def __init__(self, min_area: int = 60) -> None:
        self._min_area = min_area
        self._kernel = np.ones((3, 3), np.uint8)

    def detect(self, frame: Frame) -> list[Detection]:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, np.array([0, 150, 90]), np.array([180, 255, 255]))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self._kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out: list[Detection] = []
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if w * h < self._min_area:
                continue
            out.append(Detection(float(x), float(y), float(x + w), float(y + h), 0.9))
        return out
