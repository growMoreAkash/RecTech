"""Scripted detector for tests: returns the detections given for each call, in order."""

from __future__ import annotations

from collections.abc import Iterable

from .base import Detection, Frame


class ScriptedDetector:
    def __init__(self, script: Iterable[list[Detection]]) -> None:
        self._script = iter(script)

    def detect(self, frame: Frame) -> list[Detection]:
        return next(self._script, [])
