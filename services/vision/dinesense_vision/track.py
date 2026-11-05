"""Small IoU tracker (two-stage association in the spirit of ByteTrack: confident boxes first, then weak ones).

Tracks only give detections a stable id across frames, so the staff-presence rule can measure how long one
person stood at a table. Pure Python; deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass

from .detect import Detection


def iou(a: Detection, b: Detection) -> float:
    ix = max(0.0, min(a.x2, b.x2) - max(a.x1, b.x1))
    iy = max(0.0, min(a.y2, b.y2) - max(a.y1, b.y1))
    inter = ix * iy
    union = a.width * a.height + b.width * b.height - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Track:
    id: int
    detection: Detection
    last_seen: float
    hits: int = 1


class IouTracker:
    def __init__(self, match_iou: float = 0.3, high_confidence: float = 0.5, lost_seconds: float = 2.0) -> None:
        self.match_iou = match_iou
        self.high_confidence = high_confidence
        self.lost_seconds = lost_seconds
        self._tracks: list[Track] = []
        self._next_id = 1

    def update(self, detections: list[Detection], now: float) -> list[Track]:
        """Returns the tracks matched or started on this frame."""
        unmatched = list(self._tracks)
        current: list[Track] = []
        high = [d for d in detections if d.confidence >= self.high_confidence]
        low = [d for d in detections if d.confidence < self.high_confidence]
        for group, may_start in ((high, True), (low, False)):
            pairs = sorted(
                ((iou(t.detection, d), ti, di) for ti, t in enumerate(unmatched) for di, d in enumerate(group)),
                reverse=True,
            )
            used_t: set[int] = set()
            used_d: set[int] = set()
            for score, ti, di in pairs:
                if score < self.match_iou:
                    break
                if ti in used_t or di in used_d:
                    continue
                used_t.add(ti)
                used_d.add(di)
                t = unmatched[ti]
                t.detection, t.last_seen, t.hits = group[di], now, t.hits + 1
                current.append(t)
            unmatched = [t for i, t in enumerate(unmatched) if i not in used_t]
            if may_start:
                for di, d in enumerate(group):
                    if di not in used_d:
                        t = Track(self._next_id, d, now)
                        self._next_id += 1
                        self._tracks.append(t)
                        current.append(t)
        self._tracks = [t for t in self._tracks if now - t.last_seen <= self.lost_seconds]
        return current
