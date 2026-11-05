"""Per-table debounced occupancy state machine (pure; time is passed in).

EMPTY ──person seated──▶ PENDING ──seated for `confirm_s` (gaps < grace)──▶ OCCUPIED   [emits occupied]
PENDING ──nobody for `grace_s`──▶ EMPTY
OCCUPIED ──nobody seated──▶ PENDING_EMPTY ──nobody for `vacancy_s`──▶ EMPTY             [emits vacated]
PENDING_EMPTY ──people back for `grace_s`──▶ OCCUPIED (no event: a short absence, e.g. hand-wash)
OCCUPIED: a different head count, stable for `count_stable_s`, emits guest_count_changed.

One-frame blips (false positives or missed detections) never change what the API sees.
"""

from __future__ import annotations

from collections import Counter, deque
from dataclasses import dataclass
from enum import Enum


class ZoneState(Enum):
    EMPTY = "empty"
    PENDING = "pending"
    OCCUPIED = "occupied"
    PENDING_EMPTY = "pending_empty"


@dataclass(frozen=True)
class Occupied:
    at: float
    guest_count: int
    dwell_seconds: float
    confidence: float


@dataclass(frozen=True)
class Vacated:
    at: float
    empty_seconds: float
    confidence: float


@dataclass(frozen=True)
class CountChanged:
    at: float
    guest_count: int
    previous: int
    confidence: float


OccupancyChange = Occupied | Vacated | CountChanged
MAX_GUESTS = 60


class OccupancyTracker:
    def __init__(
        self,
        confirm_s: float = 30,
        vacancy_s: float = 90,
        grace_s: float = 5,
        count_stable_s: float = 20,
    ) -> None:
        self.confirm_s = confirm_s
        self.vacancy_s = vacancy_s
        self.grace_s = grace_s
        self.count_stable_s = count_stable_s
        self.state = ZoneState.EMPTY
        self.guest_count = 0
        self._since = 0.0  # PENDING: first sighting; PENDING_EMPTY: last time someone was seated
        self._last_seen = 0.0
        self._present_since: float | None = None
        self._count_since = 0.0  # when the reported guest count was last set
        self._samples: deque[tuple[float, int, float]] = deque()

    @property
    def occupied(self) -> bool:
        """What the API has been told (or would be): occupied from confirmation until vacancy is confirmed."""
        return self.state in (ZoneState.OCCUPIED, ZoneState.PENDING_EMPTY)

    def update(self, now: float, count: int, confidence: float) -> list[OccupancyChange]:
        count = max(0, min(MAX_GUESTS, count))
        self._samples.append((now, count, confidence))
        horizon = max(self.confirm_s, self.vacancy_s, self.count_stable_s) + self.grace_s
        while self._samples and self._samples[0][0] < now - horizon:
            self._samples.popleft()
        present = count > 0
        if present:
            self._last_seen = now

        if self.state is ZoneState.EMPTY:
            if present:
                self.state, self._since = ZoneState.PENDING, now
            return []

        if self.state is ZoneState.PENDING:
            if now - self._last_seen >= self.grace_s:
                self.state = ZoneState.EMPTY
            elif present and now - self._since >= self.confirm_s:
                ratio, mean_conf, counts = self._window(self._since, now)
                self.state = ZoneState.OCCUPIED
                self.guest_count = _mode(counts)
                self._count_since = now
                return [Occupied(now, self.guest_count, now - self._since, ratio * mean_conf)]
            return []

        if self.state is ZoneState.OCCUPIED:
            if not present:
                self.state, self._since, self._present_since = ZoneState.PENDING_EMPTY, now, None
                return []
            return self._count_change(now)

        # PENDING_EMPTY
        if present:
            self._present_since = self._present_since if self._present_since is not None else now
            if now - self._present_since >= self.grace_s:
                self.state = ZoneState.OCCUPIED
            return []
        self._present_since = None
        if now - self._since >= self.vacancy_s:
            ratio, _, _ = self._window(self._since, now)
            self.state, self.guest_count = ZoneState.EMPTY, 0
            return [Vacated(now, now - self._since, 1.0 - ratio)]
        return []

    def _window(self, start: float, end: float) -> tuple[float, float, list[int]]:
        """Share of samples with someone seated, their mean detection confidence, and the positive counts."""
        window = [s for s in self._samples if start <= s[0] <= end]
        positive = [s for s in window if s[1] > 0]
        if not window or not positive:
            return 0.0, 0.0, []
        return len(positive) / len(window), sum(s[2] for s in positive) / len(positive), [s[1] for s in positive]

    def _count_change(self, now: float) -> list[OccupancyChange]:
        if now - self._count_since < self.count_stable_s:
            return []
        start = now - self.count_stable_s
        window = [s for s in self._samples if s[0] >= start and s[1] > 0]
        if not window:
            return []
        (value, n), *_ = Counter(s[1] for s in window).most_common(1)
        share = n / len(window)
        if value == self.guest_count or share < 0.7:
            return []
        previous, self.guest_count, self._count_since = self.guest_count, value, now
        mean_conf = sum(s[2] for s in window) / len(window)
        return [CountChanged(now, value, previous, share * mean_conf)]


def _mode(counts: list[int]) -> int:
    if not counts:
        return 1
    # Most common, ties → larger (people hidden behind each other are more often missed than invented).
    c = Counter(counts)
    return max(c, key=lambda k: (c[k], k))
