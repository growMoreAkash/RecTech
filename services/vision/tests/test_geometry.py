from __future__ import annotations

from dinesense_vision.detect import Detection
from dinesense_vision.models import Zone
from dinesense_vision.posture import AspectRatioPosture
from dinesense_vision.staff import StaffPresence
from dinesense_vision.track import IouTracker, iou
from dinesense_vision.zones import point_in_polygon, zone_of

SQUARE = ((0.1, 0.1), (0.5, 0.1), (0.5, 0.5), (0.1, 0.5))


def test_point_in_polygon() -> None:
    assert point_in_polygon((0.3, 0.3), SQUARE)
    assert not point_in_polygon((0.6, 0.3), SQUARE)
    assert not point_in_polygon((0.3, 0.05), SQUARE)
    concave = ((0, 0), (1, 0), (1, 1), (0.5, 0.4), (0, 1))
    assert not point_in_polygon((0.5, 0.8), concave)
    assert point_in_polygon((0.2, 0.5), concave)


def test_zone_uses_the_lower_body_point() -> None:
    zones = (
        Zone(tableId="a", polygon=SQUARE),
        Zone(tableId="b", polygon=((0.6, 0.1), (0.9, 0.1), (0.9, 0.5), (0.6, 0.5))),
    )
    # Head outside zone a (y=0.02), lower body inside: belongs to a.
    head_out = Detection(100, 5, 140, 140, 0.9)
    assert zone_of(head_out, zones, 640, 360) == "a"
    assert zone_of(Detection(450, 50, 500, 100, 0.9), zones, 640, 360) == "b"
    assert zone_of(Detection(330, 300, 360, 350, 0.9), zones, 640, 360) is None


def test_aspect_ratio_posture() -> None:
    p = AspectRatioPosture()
    assert p.posture(Detection(0, 0, 26, 30, 1)) == "seated"
    assert p.posture(Detection(0, 0, 16, 48, 1)) == "standing"


def test_tracker_keeps_ids_through_motion_and_short_misses() -> None:
    tr = IouTracker(lost_seconds=2)
    (a,) = tr.update([Detection(0, 0, 20, 50, 0.9)], 0)
    (b,) = tr.update([Detection(3, 0, 23, 50, 0.9)], 1)
    assert a.id == b.id
    assert tr.update([], 2) == []
    (c,) = tr.update([Detection(5, 0, 25, 50, 0.9)], 3)
    assert c.id == a.id
    tr.update([], 6)
    (d,) = tr.update([Detection(5, 0, 25, 50, 0.9)], 6.5)
    assert d.id != a.id


def test_tracker_low_confidence_boxes_continue_but_never_start_tracks() -> None:
    tr = IouTracker(high_confidence=0.5)
    assert tr.update([Detection(0, 0, 10, 10, 0.3)], 0) == []
    (a,) = tr.update([Detection(0, 0, 10, 10, 0.8)], 1)
    (b,) = tr.update([Detection(1, 0, 11, 10, 0.3)], 2)
    assert a.id == b.id
    assert iou(Detection(0, 0, 10, 10, 1), Detection(20, 20, 30, 30, 1)) == 0


def test_staff_presence_reported_once_per_person_per_episode() -> None:
    sp = StaffPresence(staff_present_s=10)
    out = []
    for t in range(0, 15):
        out += sp.update(t, [(7, 0.8)], table_occupied=t >= 5)
    assert [(e.track_id, e.seconds) for e in out] == [(7, 10)]
    sp.reset()
    out = []
    for t in range(15, 30):
        out += sp.update(t, [(7, 0.8)], table_occupied=True)
    assert len(out) == 1  # next party, same waiter


def test_staff_presence_needs_continuous_dwell() -> None:
    sp = StaffPresence(staff_present_s=10, gap_s=2)
    out = []
    for t in range(0, 30):
        out += sp.update(t, [(1, 0.8)] if t % 8 < 5 else [], table_occupied=True)
    assert out == []
