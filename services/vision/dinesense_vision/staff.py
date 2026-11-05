"""Staff presence at a table: a standing person who stays in the table's zone for `staff_present_s`.

Reported at most once per person per occupancy episode, and only while the table is occupied (that is when the
API may count it as the greet, if the outlet enabled camera greet).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class StaffPresent:
    at: float
    track_id: int
    seconds: float
    confidence: float


@dataclass
class _Dwell:
    start: float
    last: float
    confidences: list[float] = field(default_factory=list)


class StaffPresence:
    def __init__(self, staff_present_s: float = 10, gap_s: float = 2.0) -> None:
        self.staff_present_s = staff_present_s
        self.gap_s = gap_s
        self._dwell: dict[int, _Dwell] = {}
        self._reported: set[int] = set()

    def reset(self) -> None:
        """New occupancy episode: the same waiter may be reported again for the next party."""
        self._reported.clear()

    def update(self, now: float, standing: list[tuple[int, float]], table_occupied: bool) -> list[StaffPresent]:
        """`standing`: (track id, confidence) of standing people in this table's zone on this frame."""
        for track_id, conf in standing:
            d = self._dwell.get(track_id)
            if d is None or now - d.last > self.gap_s:
                d = self._dwell[track_id] = _Dwell(now, now)
            d.last = now
            d.confidences.append(conf)
        for track_id in [t for t, d in self._dwell.items() if now - d.last > self.gap_s]:
            del self._dwell[track_id]
        if not table_occupied:
            return []
        out = []
        for track_id, d in self._dwell.items():
            seconds = d.last - d.start
            if track_id not in self._reported and d.last == now and seconds >= self.staff_present_s:
                self._reported.add(track_id)
                out.append(StaffPresent(now, track_id, seconds, sum(d.confidences) / len(d.confidences)))
        return out
