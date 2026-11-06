"""Dirty-table check: tableware on an empty table for long enough, once per episode."""

from __future__ import annotations

import numpy as np

from dinesense_vision.detect import Detection
from dinesense_vision.detect.scripted import ScriptedDetector
from dinesense_vision.dirty import DirtyCheck
from dinesense_vision.models import CameraConfig, EdgeSettings
from dinesense_vision.pipeline import CameraPipeline

CUP = [("cup", 0.8), ("bowl", 0.6)]


def run(check: DirtyCheck, frames: list[tuple[float, list[tuple[str, float]], int, bool]]) -> list[float]:
    return [d.at for t, objs, seated, occ in frames if (d := check.update(t, objs, seated, occ))]


def test_reports_once_after_the_confirm_time_while_empty() -> None:
    check = DirtyCheck(confirm_s=20)
    hits = run(check, [(float(t), CUP, 0, False) for t in range(0, 60)])
    assert hits == [20.0]


def test_an_occupied_table_never_counts_and_restarts_the_episode() -> None:
    check = DirtyCheck(confirm_s=20)
    frames = [(float(t), CUP, 2, True) for t in range(0, 100)]
    frames += [(float(t), CUP, 0, False) for t in range(100, 130)]
    assert run(check, frames) == [120.0]


def test_a_one_frame_false_person_pauses_but_does_not_reset() -> None:
    check = DirtyCheck(confirm_s=20)
    frames = [(float(t), CUP, 1 if t == 10 else 0, False) for t in range(0, 30)]
    assert run(check, frames) == [20.0]


def test_clearing_the_table_ends_the_episode() -> None:
    check = DirtyCheck(confirm_s=10, gap_s=3)
    frames = [(float(t), CUP, 0, False) for t in range(0, 15)]  # reported at 10
    frames += [(float(t), [], 0, False) for t in range(15, 20)]  # cleared
    frames += [(float(t), CUP, 0, False) for t in range(20, 35)]  # dirty again → reported at 30
    assert run(check, frames) == [10.0, 30.0]
    # Short gaps (a hand over the cup) are tolerated.
    check = DirtyCheck(confirm_s=10, gap_s=3)
    frames = [(float(t), [] if t in (4, 5) else CUP, 0, False) for t in range(0, 15)]
    assert run(check, frames) == [10.0]


def test_pipeline_emits_table_dirty_for_tableware_inside_a_zone_only() -> None:
    zone = {"tableId": "T1", "polygon": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]}
    cam = CameraConfig.model_validate({"id": "c", "name": "c", "rtspUrl": "file://x", "zones": [zone]})
    inside = Detection(100, 100, 110, 110, 0.8, "cup")
    outside = Detection(500, 300, 510, 310, 0.8, "bowl")
    det = ScriptedDetector([[inside, outside]] * 100)
    pipe = CameraPipeline(cam, EdgeSettings(dirtyConfirmSeconds=5), det)
    frame = np.zeros((360, 640, 3), np.uint8)
    events = [e for t in range(0, 30) for e in pipe.process(frame, float(t)).events]
    dirty = [e for e in events if e["type"] == "table.dirty"]
    assert len(dirty) == 1
    assert dirty[0]["tableId"] == "T1" and dirty[0]["payload"]["classes"] == ["cup"]
    # Tableware is never tracked as a person.
    assert not any(e["type"] == "table.occupied" for e in events)
