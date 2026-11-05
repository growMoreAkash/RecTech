"""Detector protocol: one frame in, person boxes out (pixel coordinates of that frame)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import numpy.typing as npt

#: BGR image as decoded by OpenCV (uint8, H×W×3).
Frame = npt.NDArray[Any]


@dataclass(frozen=True, slots=True)
class Detection:
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1


class Detector(Protocol):
    def detect(self, frame: Frame) -> list[Detection]: ...
