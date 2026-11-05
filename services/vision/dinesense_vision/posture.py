"""Posture estimate from the person box (decision D2: aspect ratio first; a pose model can replace it later).

Seated people (cut off by the table, legs hidden) give short, wide boxes; standing people give tall, narrow ones.
"""

from __future__ import annotations

from typing import Literal, Protocol

from .detect import Detection

Posture = Literal["standing", "seated"]


class PostureEstimator(Protocol):
    def posture(self, d: Detection) -> Posture: ...


class AspectRatioPosture:
    def __init__(self, standing_ratio: float = 2.0) -> None:
        self.standing_ratio = standing_ratio

    def posture(self, d: Detection) -> Posture:
        if d.width <= 0:
            return "standing"
        return "standing" if d.height / d.width >= self.standing_ratio else "seated"
