"""`ds-vision eval`: replays a video through the live pipeline and scores it against labelled intervals.

Debounce delays are by design (occupancy is confirmed after N s, vacancy after M s), so besides raw per-sample
accuracy we report accuracy outside those expected windows (the ≥ 95 % target applies to it) and the event
latency itself.
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from .detect import Detector
from .detect.base import Frame
from .models import CameraConfig, EdgeSettings, Zone
from .pipeline import CameraPipeline

Interval = tuple[float, float]


def load_labels(path: Path) -> dict[str, list[Interval]]:
    out: dict[str, list[Interval]] = defaultdict(list)
    with path.open(newline="") as f:
        for row in csv.DictReader(f):
            if row["state"].strip().lower() == "occupied":
                out[row["table_id"].strip()].append((float(row["start_s"]), float(row["end_s"])))
    return dict(out)


def load_zones(path: Path) -> tuple[Zone, ...]:
    data = json.loads(path.read_text())
    return tuple(Zone.model_validate(z) for z in data["zones"])


def load_door(path: Path) -> tuple[tuple[float, float], ...] | None:
    door = json.loads(path.read_text()).get("door")
    return tuple((float(x), float(y)) for x, y in door) if door else None


def load_arrivals(path: Path) -> list[tuple[float, int]]:
    with path.open(newline="") as f:
        return [(float(r["time_s"]), int(r["size"])) for r in csv.DictReader(f)]


def load_dirty(path: Path) -> dict[str, list[Interval]]:
    out: dict[str, list[Interval]] = defaultdict(list)
    with path.open(newline="") as f:
        for r in csv.DictReader(f):
            out[r["table_id"].strip()].append((float(r["start_s"]), float(r["end_s"])))
    return dict(out)


@dataclass
class DirtyScore:
    #: Labelled episodes long enough that a check must fire (past vacancy + dirty confirmation).
    expected: int = 0
    detected: int = 0
    spurious: int = 0
    latency: list[float] = field(default_factory=list)

    def text(self) -> str:
        if not self.expected and not self.spurious:
            return ""
        lat = sum(self.latency) / len(self.latency) if self.latency else float("nan")
        return (
            f"dirty tables: detected {self.detected}/{self.expected}, false alarms {self.spurious}, "
            f"mean time after guests left {lat:.0f}s"
        )


@dataclass
class ArrivalScore:
    parties: int = 0
    detected: int = 0
    exact: int = 0
    abs_error: int = 0
    spurious: int = 0

    def text(self) -> str:
        if not self.parties:
            return ""
        return "\n".join(
            [
                f"door: parties detected {self.detected}/{self.parties}, exact size {self.exact}/{self.detected or 1}"
                f" ({self.exact / max(1, self.detected):.0%}), mean |size error| "
                f"{self.abs_error / max(1, self.detected):.2f}, false arrivals {self.spurious}",
            ]
        )


def _inside(t: float, intervals: list[Interval]) -> bool:
    return any(a <= t < b for a, b in intervals)


@dataclass
class TableScore:
    samples: int = 0
    correct: int = 0
    scored: int = 0  # outside debounce windows
    scored_correct: int = 0
    tp: int = 0
    fp: int = 0
    fn: int = 0
    occupy_latency: list[float] = field(default_factory=list)
    vacate_latency: list[float] = field(default_factory=list)
    missed_events: int = 0
    spurious_events: int = 0


@dataclass
class Report:
    tables: dict[str, TableScore]
    events: int
    arrivals: ArrivalScore = field(default_factory=ArrivalScore)
    dirty: DirtyScore = field(default_factory=DirtyScore)

    def _sum(self, attr: str) -> int:
        return sum(int(getattr(s, attr)) for s in self.tables.values())

    @property
    def accuracy(self) -> float:
        return self._sum("correct") / max(1, self._sum("samples"))

    @property
    def adjusted_accuracy(self) -> float:
        return self._sum("scored_correct") / max(1, self._sum("scored"))

    @property
    def precision(self) -> float:
        tp, fp = self._sum("tp"), self._sum("fp")
        return tp / max(1, tp + fp)

    @property
    def recall(self) -> float:
        tp, fn = self._sum("tp"), self._sum("fn")
        return tp / max(1, tp + fn)

    def text(self) -> str:
        lines = [f"{'table':<10}{'acc':>8}{'adj.acc':>9}{'occ.lat':>9}{'vac.lat':>9}{'missed':>8}{'spurious':>9}"]
        for t, s in sorted(self.tables.items()):
            occ = sum(s.occupy_latency) / len(s.occupy_latency) if s.occupy_latency else float("nan")
            vac = sum(s.vacate_latency) / len(s.vacate_latency) if s.vacate_latency else float("nan")
            lines.append(
                f"{t:<10}{s.correct / max(1, s.samples):>8.1%}{s.scored_correct / max(1, s.scored):>9.1%}"
                f"{occ:>8.1f}s{vac:>8.1f}s{s.missed_events:>8}{s.spurious_events:>9}"
            )
        lines += [
            "",
            f"accuracy (all samples):              {self.accuracy:.1%}",
            f"accuracy (outside debounce windows): {self.adjusted_accuracy:.1%}   target ≥ 95%",
            f"occupied precision / recall:         {self.precision:.1%} / {self.recall:.1%}",
            f"events emitted:                      {self.events}",
            *([self.arrivals.text()] if self.arrivals.parties else []),
            *([self.dirty.text()] if self.dirty.text() else []),
        ]
        return "\n".join(lines)


def evaluate(
    frames: Iterable[tuple[float, Frame]],
    labels: dict[str, list[Interval]],
    zones: tuple[Zone, ...],
    detector: Detector,
    settings: EdgeSettings,
    tolerance_s: float = 10.0,
    min_confidence: float = 0.35,
    door: tuple[tuple[float, float], ...] | None = None,
    arrivals: list[tuple[float, int]] | None = None,
    dirty: dict[str, list[Interval]] | None = None,
) -> Report:
    camera = CameraConfig.model_validate(
        {
            "id": "eval",
            "name": "eval",
            "rtspUrl": "file://eval",
            "zones": [z.model_dump(by_alias=True) for z in zones],
            "door": door,
        }
    )
    seen_arrivals: list[tuple[float, int]] = []
    dirty_seen: dict[str, list[float]] = defaultdict(list)
    pipe = CameraPipeline(camera, settings, detector, min_confidence=min_confidence)
    scores = {z.table_id: TableScore() for z in zones}
    emitted: dict[str, list[tuple[float, str]]] = defaultdict(list)
    n_events = 0
    t_end = 0.0
    for t, frame in frames:
        t_end = t
        result = pipe.process(frame, t)
        for e in result.events:
            if e["type"] == "party.arrived":
                seen_arrivals.append((t, int(e["payload"]["count"])))
            if e["type"] == "table.dirty":
                dirty_seen[e["tableId"]].append(t)
            if e["type"] in ("table.occupied", "table.vacated"):
                emitted[e["tableId"]].append((t, e["type"]))
        n_events += len(result.events)
        for table, occupied in pipe.occupied().items():
            truth_list = labels.get(table, [])
            truth = _inside(t, truth_list)
            s = scores[table]
            s.samples += 1
            s.correct += occupied == truth
            # Expected lag windows after each labelled change are not scored.
            lag = any(
                a <= t < a + settings.occupancy_confirm_seconds + tolerance_s
                or b <= t < b + settings.vacancy_confirm_seconds + tolerance_s
                for a, b in truth_list
            )
            if not lag:
                s.scored += 1
                s.scored_correct += occupied == truth
                s.tp += occupied and truth
                s.fp += occupied and not truth
                s.fn += truth and not occupied

    for table, s in scores.items():
        evs = emitted.get(table, [])
        used: set[int] = set()
        for a, b in labels.get(table, []):
            occ = next(
                (i for i, (t, k) in enumerate(evs) if k == "table.occupied" and a <= t <= b and i not in used), None
            )
            if occ is None:
                s.missed_events += 1
            else:
                used.add(occ)
                s.occupy_latency.append(evs[occ][0] - a)
            vac = next(
                (
                    i
                    for i, (t, k) in enumerate(evs)
                    if k == "table.vacated" and b <= t <= b + settings.vacancy_confirm_seconds + 60 and i not in used
                ),
                None,
            )
            if vac is not None:
                used.add(vac)
                s.vacate_latency.append(evs[vac][0] - b)
            elif b + settings.vacancy_confirm_seconds + 60 <= t_end:
                s.missed_events += 1
        s.spurious_events = len(evs) - len(used)
    arrival_score = ArrivalScore()
    if arrivals:
        matched: set[int] = set()
        arrival_score.parties = len(arrivals)
        for t0, size in arrivals:
            # Reported once the group is complete: within ~10 s of the first person coming in.
            match = next(
                (i for i, (t, _) in enumerate(seen_arrivals) if i not in matched and t0 - 1 <= t <= t0 + 10), None
            )
            if match is None:
                continue
            matched.add(match)
            got = seen_arrivals[match][1]
            arrival_score.detected += 1
            arrival_score.exact += got == size
            arrival_score.abs_error += abs(got - size)
        arrival_score.spurious = len(seen_arrivals) - len(matched)
    dirty_score = DirtyScore()
    if dirty is not None:
        must_wait = settings.vacancy_confirm_seconds + settings.dirty_confirm_seconds + tolerance_s
        for table, seen in dirty_seen.items():
            taken: set[int] = set()
            for a, b in dirty.get(table, []):
                hit = next((i for i, t in enumerate(seen) if i not in taken and a <= t <= b + 5), None)
                if hit is not None:
                    taken.add(hit)
                    dirty_score.latency.append(seen[hit] - a)
            dirty_score.spurious += len(seen) - len(taken)
        for table, intervals in dirty.items():
            for a, b in intervals:
                if b - a >= must_wait and b <= t_end:
                    dirty_score.expected += 1
                    dirty_score.detected += any(a <= t <= b + 5 for t in dirty_seen.get(table, []))
    return Report(scores, n_events, arrival_score, dirty_score)
