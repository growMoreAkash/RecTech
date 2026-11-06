"""End to end on synthetic footage: the live pipeline must hit the accuracy target."""

from __future__ import annotations

import random
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft7Validator, FormatChecker

from dinesense_vision.detect import Detection
from dinesense_vision.detect.scripted import ScriptedDetector
from dinesense_vision.detect.synthetic import SyntheticDetector
from dinesense_vision.evaluate import evaluate, load_dirty, load_labels, load_zones
from dinesense_vision.models import CameraConfig, EdgeSettings
from dinesense_vision.pipeline import CameraPipeline
from dinesense_vision.sources import iter_video
from dinesense_vision.synth import generate, plan, render

FAST = EdgeSettings(occupancyConfirmSeconds=10, vacancyConfirmSeconds=30, staffPresentSeconds=8)


def test_eval_on_synthetic_footage_meets_the_target(tmp_path: Path) -> None:
    video = generate(tmp_path, "t", seconds=420, fps=3, seed=11)
    labels = load_labels(tmp_path / "t.labels.csv")
    report = evaluate(iter_video(video, 3), labels, load_zones(tmp_path / "t.zones.json"), SyntheticDetector(), FAST)
    assert report.adjusted_accuracy >= 0.95, report.text()
    assert report.precision >= 0.95 and report.recall >= 0.95
    assert all(s.missed_events == 0 and s.spurious_events == 0 for s in report.tables.values()), report.text()
    for s in report.tables.values():
        assert all(9 <= x <= 13 for x in s.occupy_latency)
    assert "target" in report.text()


def test_dirty_tables_are_found_after_guests_leave_without_false_alarms(tmp_path: Path) -> None:
    video = generate(tmp_path, "d", seconds=900, fps=3, seed=7)
    dirty = load_dirty(tmp_path / "d.dirty.csv")
    report = evaluate(
        iter_video(video, 3),
        load_labels(tmp_path / "d.labels.csv"),
        load_zones(tmp_path / "d.zones.json"),
        SyntheticDetector(),
        EdgeSettings(),
        dirty=dirty,
    )
    assert report.dirty.expected >= 3, report.text()
    assert report.dirty.detected == report.dirty.expected, report.text()
    assert report.dirty.spurious == 0, report.text()
    # Cups during the meal never count: every report comes after the table was confirmed empty.
    assert all(lat >= 90 + 20 for lat in report.dirty.latency), report.dirty.latency


def test_pipeline_events_are_contract_valid_and_include_staff_presence(contracts: dict[str, Any]) -> None:
    rng = random.Random(5)
    parties = plan(420, rng)
    zones = [{"tableId": t, "polygon": z} for t, z in {p.table.id: p.table.polygon() for p in parties}.items()]
    cam = CameraConfig.model_validate({"id": "cam1", "name": "Hall", "rtspUrl": "file://x", "zones": zones})
    pipe = CameraPipeline(cam, FAST, SyntheticDetector())
    out = []
    t = 0.0
    while t < 420:
        out += pipe.process(render(t, parties, rng), t).events
        t += 1 / 3
    v = Draft7Validator(contracts["event"], format_checker=FormatChecker())
    for e in out:
        assert v.is_valid(e), e
    kinds = Counter(e["type"] for e in out)
    assert kinds["table.occupied"] >= 4 and kinds["table.vacated"] >= 1
    assert kinds["table.staff_present"] >= 1


@pytest.mark.parametrize("seated", [True, False])
def test_only_seated_people_make_a_table_occupied(seated: bool) -> None:
    box = Detection(100, 100, 126, 130, 0.9) if seated else Detection(100, 82, 116, 130, 0.9)
    cam = CameraConfig.model_validate(
        {
            "id": "c",
            "name": "c",
            "rtspUrl": "file://x",
            "zones": [{"tableId": "t", "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]]}],
        }
    )
    pipe = CameraPipeline(cam, FAST, ScriptedDetector([box] for _ in range(40)))
    import numpy as np

    frame = np.zeros((360, 640, 3), np.uint8)
    events = [e for t in range(40) for e in pipe.process(frame, float(t)).events]
    assert any(e["type"] == "table.occupied" for e in events) is seated
