from __future__ import annotations

from dinesense_vision.occupancy import CountChanged, OccupancyTracker, Occupied, Vacated, ZoneState


def run(tr: OccupancyTracker, start: float, end: float, count: int, step: float = 1.0, conf: float = 0.9) -> list:
    out = []
    t = start
    while t < end:
        out += tr.update(t, count, conf if count else 0.0)
        t += step
    return out


def test_occupied_only_after_the_confirm_window() -> None:
    tr = OccupancyTracker(confirm_s=30, vacancy_s=90)
    assert run(tr, 0, 30, 2) == []
    assert tr.state is ZoneState.PENDING
    (ev,) = tr.update(30, 2, 0.9)
    assert isinstance(ev, Occupied)
    assert ev.guest_count == 2 and ev.dwell_seconds == 30
    assert 0.85 < ev.confidence <= 0.9
    assert tr.occupied


def test_a_short_visit_never_reaches_the_api() -> None:
    tr = OccupancyTracker(confirm_s=30, vacancy_s=90, grace_s=5)
    assert run(tr, 0, 20, 1) == []
    assert run(tr, 20, 30, 0) == []
    assert tr.state is ZoneState.EMPTY


def test_single_frame_blips_change_nothing() -> None:
    tr = OccupancyTracker(confirm_s=30, vacancy_s=90, grace_s=5)
    # A false positive on an empty table.
    assert tr.update(0, 1, 0.9) == [] and run(tr, 1, 10, 0) == []
    assert tr.state is ZoneState.EMPTY
    # Missed detections while seated: confirm still happens on time.
    events = []
    for t in range(10, 45):
        events += tr.update(t, 0 if t % 7 == 0 else 2, 0.9)
    assert [type(e) for e in events] == [Occupied]


def test_vacated_after_the_vacancy_window_and_short_absence_is_ignored() -> None:
    tr = OccupancyTracker(confirm_s=10, vacancy_s=60, grace_s=5)
    run(tr, 0, 20, 2)
    assert tr.occupied
    # Everyone steps away for 40 s, then comes back for good: no event.
    assert run(tr, 20, 60, 0) == []
    assert tr.state is ZoneState.PENDING_EMPTY and tr.occupied
    assert run(tr, 60, 70, 2) == []
    assert tr.state is ZoneState.OCCUPIED
    # They leave.
    events = run(tr, 70, 140, 0)
    assert len(events) == 1 and isinstance(events[0], Vacated)
    assert events[0].empty_seconds == 60 and events[0].at == 130
    assert tr.state is ZoneState.EMPTY and tr.guest_count == 0


def test_blips_while_pending_empty_do_not_restart_the_vacancy_clock() -> None:
    tr = OccupancyTracker(confirm_s=10, vacancy_s=60, grace_s=5)
    run(tr, 0, 20, 2)
    events = []
    for t in range(20, 90):
        events += tr.update(t, 1 if t in (40, 41, 55) else 0, 0.9)
    assert [type(e) for e in events] == [Vacated]
    assert events[0].at == 80


def test_guest_count_change_needs_a_stable_new_count() -> None:
    tr = OccupancyTracker(confirm_s=10, vacancy_s=60, count_stable_s=20)
    run(tr, 0, 11, 2)
    assert tr.guest_count == 2
    # A noisy few seconds of 3 do not change the count…
    assert run(tr, 11, 16, 3) + run(tr, 16, 40, 2) == []
    # …20 s of 4 people does.
    events = run(tr, 40, 70, 4)
    changes = [e for e in events if isinstance(e, CountChanged)]
    assert len(changes) == 1 and changes[0].previous == 2 and changes[0].guest_count == 4
    assert tr.guest_count == 4


def test_occupied_count_is_the_most_common_count_ties_up() -> None:
    tr = OccupancyTracker(confirm_s=4, vacancy_s=60)
    events = []
    for t, c in enumerate([3, 2, 3, 2, 1]):
        events += tr.update(t, c, 0.9)
    assert isinstance(events[0], Occupied) and events[0].guest_count == 3
