"""Detector protocol: one frame in, boxes out (pixel coordinates of that frame): people, and tableware for the
dirty-table check."""

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
    #: "person", or a tableware class from TABLEWARE (cup, bowl, ...).
    label: str = "person"

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1


#: COCO classes (YOLOX ids) that mean "something was left on the table".
TABLEWARE: dict[int, str] = {
    39: "bottle",
    40: "wine glass",
    41: "cup",
    42: "fork",
    43: "knife",
    44: "spoon",
    45: "bowl",
}


class Detector(Protocol):
    def detect(self, frame: Frame) -> list[Detection]: ...
