from __future__ import annotations

import time
from typing import Any

import jsonschema
from jsonschema import Draft7Validator, FormatChecker

from dinesense_vision import events
from dinesense_vision.signing import edge_signature, signed_headers


def _validator(schema: dict[str, Any]) -> Draft7Validator:
    return Draft7Validator(schema, format_checker=FormatChecker())


def test_signature_matches_the_shared_known_answer_vector(contracts: dict[str, Any]) -> None:
    v = contracts["signingVector"]
    assert edge_signature(v["secret"], v["timestamp"], v["method"], v["path"], v["body"].encode()) == v["signature"]


def test_signed_headers_carry_device_and_timestamp_but_never_the_secret() -> None:
    h = signed_headers("edg_1", "s3cret", "GET", "/api/v1/edge/config", b"", now=1_762_300_800)
    assert h["x-ds-device"] == "edg_1"
    assert h["x-ds-timestamp"] == "1762300800"
    assert "s3cret" not in "".join(h.values())
    assert h["x-ds-signature"] == edge_signature("s3cret", "1762300800", "GET", "/api/v1/edge/config", b"")


def test_every_event_builder_produces_a_contract_valid_event(contracts: dict[str, Any]) -> None:
    v = _validator(contracts["event"])
    now = time.time()
    samples = [
        events.table_event(
            "table.occupied",
            camera_id="cam",
            table_id="t",
            at=now,
            confidence=1.2,
            payload={"guestCount": 3, "dwellSeconds": 30.5},
        ),
        events.table_event(
            "table.vacated", camera_id="cam", table_id="t", at=now, confidence=0.9, payload={"emptySeconds": 90}
        ),
        events.table_event(
            "table.guest_count_changed",
            camera_id="cam",
            table_id="t",
            at=now,
            confidence=0.5,
            payload={"guestCount": 4, "previous": 3},
        ),
        events.table_event(
            "table.staff_present",
            camera_id="cam",
            table_id="t",
            at=now,
            confidence=0.7,
            payload={"seconds": 12.5, "trackId": 7},
        ),
        events.camera_health(
            camera_id="cam", at=now, status="ok", fps=3, latency_ms=40, last_frame_at=now, reconnects=0
        ),
        events.camera_health(
            camera_id="cam",
            at=now,
            status="down",
            fps=0,
            latency_ms=0,
            last_frame_at=None,
            reconnects=3,
            error="x" * 500,
        ),
        events.heartbeat(at=now, version="0.1.0", uptime_s=12.3, queue_depth=0),
    ]
    for e in samples:
        errors = list(v.iter_errors(e))
        assert not errors, (e["type"], [er.message for er in errors])


def test_contract_rejects_unknown_payload_fields(contracts: dict[str, Any]) -> None:
    e = events.table_event(
        "table.vacated", camera_id="c", table_id="t", at=time.time(), confidence=1, payload={"emptySeconds": 1}
    )
    e["payload"]["face"] = "nope"
    assert not _validator(contracts["event"]).is_valid(e)


def test_batch_envelope_is_contract_valid(contracts: dict[str, Any]) -> None:
    hb = events.heartbeat(at=time.time(), version="0.1.0", uptime_s=1, queue_depth=0)
    jsonschema.validate({"deviceId": "edg_1", "sentAt": events.iso(time.time()), "events": [hb]}, contracts["batch"])


def test_event_ids_are_unique_time_ordered_uuid7() -> None:
    ids = [events.uuid7() for _ in range(500)]
    assert len(set(ids)) == 500
    assert all(i[14] == "7" and i[19] in "89ab" for i in ids)
    assert ids[0][:8] <= ids[-1][:8]
