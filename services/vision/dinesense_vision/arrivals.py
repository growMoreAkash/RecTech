"""Party-size estimate at the entrance (pure; time is passed in).

A person counts as *arriving* when their track is first seen inside the door zone (guests walking out were first
seen at their table, so they never count). New arrivals within `gap_s` of each other form one party; the party is
reported once nobody new has come through for `gap_s`.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class PartyArrived:
    at: float
    count: int
    track_ids: tuple[int, ...]
    confidence: float


@dataclass
class _Group:
    first: float
    last: float
    track_ids: list[int] = field(default_factory=list)
    confidences: list[float] = field(default_factory=list)


class ArrivalGrouper:
    def __init__(self, gap_s: float = 2.0, forget_s: float = 600.0) -> None:
        self.gap_s = gap_s
        self.forget_s = forget_s
        self._seen: dict[int, float] = {}
        #: Tracks seen once: a person must be seen on two frames (one-frame blips are noise).
        self._pending: dict[int, tuple[float, bool, float]] = {}
        self._group: _Group | None = None

    def update(self, now: float, tracks: list[tuple[int, bool, float]]) -> list[PartyArrived]:
        """`tracks`: (track id, anchor inside the door zone, confidence) for every track on this frame."""
        out: list[PartyArrived] = []
        for track_id, in_door, conf in tracks:
            if track_id in self._seen:
                self._seen[track_id] = now
                pending = self._pending.pop(track_id, None)
                if pending is None or not pending[1]:
                    continue  # first seen elsewhere: already inside (or staff), not an arrival
                first, _, first_conf = pending
                if self._group and first - self._group.last > self.gap_s:
                    out.append(self._close())
                if not self._group:
                    self._group = _Group(first, first)
                self._group.last = max(self._group.last, first)
                self._group.track_ids.append(track_id)
                self._group.confidences.append((first_conf + conf) / 2)
                continue
            self._seen[track_id] = now
            self._pending[track_id] = (now, in_door, conf)
        if self._group and now - self._group.last > self.gap_s:
            out.append(self._close())
        for t in [t for t, last in self._seen.items() if now - last > self.forget_s]:
            del self._seen[t]
        for t in [t for t, (first, _, _) in self._pending.items() if now - first > self.gap_s]:
            del self._pending[t]
        return out

    def _close(self) -> PartyArrived:
        g = self._group
        assert g is not None
        self._group = None
        return PartyArrived(
            at=g.last,
            count=len(g.track_ids),
            track_ids=tuple(g.track_ids),
            confidence=sum(g.confidences) / len(g.confidences),
        )
