"""Dirty-table check: tableware (cup, bowl, bottle, glass, cutlery) on a table nobody is sitting at.

Reported once per "dirty episode" after `confirm_s` of continuously seeing tableware while the table is empty
(occupancy not confirmed, nobody seated on that frame). The episode ends when the table is cleared (no tableware
for `gap_s`) or guests sit down again. Only the event leaves the box; frames never do.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Dirty:
    at: float
    seconds: float
    objects: int
    classes: tuple[str, ...]
    confidence: float


class DirtyCheck:
    def __init__(self, confirm_s: float = 20, gap_s: float = 3.0) -> None:
        self.confirm_s = confirm_s
        self.gap_s = gap_s
        self._since: float | None = None
        self._last: float = 0.0
        self._reported = False
        self._confidences: list[float] = []

    def _clear(self) -> None:
        self._since = None
        self._reported = False
        self._confidences = []

    def update(self, now: float, objects: list[tuple[str, float]], seated: int, occupied: bool) -> Dirty | None:
        """`objects`: (class, confidence) of tableware in this table's zone on this frame."""
        if occupied:
            self._clear()
            return None
        if seated:
            return None  # someone sat down (or a one-frame false positive): wait, occupancy decides
        if objects:
            if self._since is None:
                self._since = now
            self._last = now
            self._confidences = (self._confidences + [c for _, c in objects])[-200:]
        elif self._since is not None and now - self._last > self.gap_s:
            self._clear()  # cleared
            return None
        if self._since is None or self._reported or not objects or now - self._since < self.confirm_s:
            return None
        self._reported = True
        return Dirty(
            at=now,
            seconds=now - self._since,
            objects=len(objects),
            classes=tuple(sorted({c for c, _ in objects}))[:10],
            confidence=sum(self._confidences) / len(self._confidences),
        )
