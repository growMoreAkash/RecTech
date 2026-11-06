from __future__ import annotations

from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator, FormatChecker

from dinesense_vision.arrivals import ArrivalGrouper
from dinesense_vision.detect.synthetic import SyntheticDetector
from dinesense_vision.evaluate import evaluate, load_arrivals, load_door, load_labels, load_zones
from dinesense_vision.events import party_arrived
from dinesense_vision.models import EdgeSettings
from dinesense_vision.sources import iter_video
from dinesense_vision.synth import generate


def run(g: ArrivalGrouper, frames: list[tuple[float, list[tuple[int, bool, float]]]]) -> list[tuple[float, int]]:
    out = []
    for t, tracks in frames:
        out += [(a.at, a.count) for a in g.update(t, tracks)]
    return out


def test_people_coming_in_together_are_one_party() -> None:
    g = ArrivalGrouper(gap_s=2)
    frames: list[tuple[float, list[tuple[int, bool, float]]]] = []
    # Three people step in 0.7 s apart and walk on (out of the door zone).
    for i in range(30):
        t = i / 3
        tracks = [(k, t - k * 0.7 < 1.5, 0.9) for k in (1, 2, 3) if t >= k * 0.7]
        frames.append((t, tracks))
    assert [c for _, c in run(g, frames)] == [3]


def test_people_first_seen_inside_or_once_do_not_count() -> None:
    g = ArrivalGrouper(gap_s=2)
    frames: list[tuple[float, list[tuple[int, bool, float]]]] = []
    for i in range(20):
        t = i / 3
        tracks = [(10, False, 0.9)]  # seated guest walking out through the door later
        if i == 3:
            tracks.append((11, True, 0.9))  # one-frame noise blob in the doorway
        if i > 10:
            tracks = [(10, True, 0.9)]
        frames.append((t, tracks))
    assert run(g, frames) == []


def test_two_groups_far_apart_are_two_parties() -> None:
    g = ArrivalGrouper(gap_s=2)
    frames = [(t / 3, [(1, True, 0.9)] if t < 6 else [(1, False, 0.9)]) for t in range(10)]
    frames += [(10 + t / 3, [(1, False, 0.9), (2, True, 0.8), (3, True, 0.8)]) for t in range(15)]
    assert [c for _, c in run(g, frames)] == [1, 2]


def test_party_event_matches_the_contract(contracts: dict[str, Any]) -> None:
    e = party_arrived(camera_id="cam", at=1_762_300_800, count=4, track_ids=[1, 2, 3, 4], confidence=0.87)
    assert Draft7Validator(contracts["event"], format_checker=FormatChecker()).is_valid(e)


def test_synthetic_door_footage_estimates_parties(tmp_path: Path) -> None:
    video = generate(tmp_path, "d", seconds=360, fps=3, seed=7)
    zones = tmp_path / "d.zones.json"
    report = evaluate(
        iter_video(video, 3),
        load_labels(tmp_path / "d.labels.csv"),
        load_zones(zones),
        SyntheticDetector(),
        EdgeSettings(occupancyConfirmSeconds=10, vacancyConfirmSeconds=30, staffPresentSeconds=8),
        door=load_door(zones),
        arrivals=load_arrivals(tmp_path / "d.arrivals.csv"),
    )
    a = report.arrivals
    assert a.parties >= 3
    assert a.detected >= a.parties - 1, report.text()
    assert a.spurious == 0, report.text()
    assert a.abs_error / max(1, a.detected) <= 1.0, report.text()
    assert report.adjusted_accuracy >= 0.95  # door watching doesn't disturb table occupancy
