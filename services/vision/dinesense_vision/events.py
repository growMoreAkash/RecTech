"""Builders for the edge events in packages/shared/src/edge/contracts.ts (validated against the generated JSON
Schema in tests)."""

from __future__ import annotations

import os
import time
from datetime import UTC, datetime
from typing import Any, Literal

Event = dict[str, Any]


def uuid7() -> str:
    """Time-ordered unique id (RFC 9562 UUIDv7 layout), used as the idempotency key of each event."""
    ms = time.time_ns() // 1_000_000
    rand = int.from_bytes(os.urandom(10), "big")
    value = (ms & ((1 << 48) - 1)) << 80 | 0x7 << 76 | (rand >> 68 & 0xFFF) << 64 | 0b10 << 62
    value |= rand & ((1 << 62) - 1)
    h = f"{value:032x}"
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _conf(c: float) -> float:
    return round(min(1.0, max(0.0, c)), 3)


def table_event(
    kind: Literal["table.occupied", "table.vacated", "table.guest_count_changed", "table.staff_present"],
    *,
    camera_id: str,
    table_id: str,
    at: float,
    confidence: float,
    payload: dict[str, Any],
) -> Event:
    return {
        "eventId": uuid7(),
        "type": kind,
        "occurredAt": iso(at),
        "cameraId": camera_id,
        "tableId": table_id,
        "confidence": _conf(confidence),
        "payload": payload,
    }


def party_arrived(*, camera_id: str, at: float, count: int, track_ids: list[int], confidence: float) -> Event:
    return {
        "eventId": uuid7(),
        "type": "party.arrived",
        "occurredAt": iso(at),
        "cameraId": camera_id,
        "confidence": _conf(confidence),
        "payload": {"count": max(1, min(60, count)), "trackIds": track_ids[:60]},
    }


def camera_health(
    *,
    camera_id: str,
    at: float,
    status: Literal["ok", "degraded", "down"],
    fps: float,
    latency_ms: float,
    last_frame_at: float | None,
    reconnects: int,
    error: str | None = None,
) -> Event:
    payload: dict[str, Any] = {
        "status": status,
        "fps": round(min(120.0, max(0.0, fps)), 2),
        "latencyMs": round(max(0.0, latency_ms), 1),
        "lastFrameAt": iso(last_frame_at) if last_frame_at is not None else None,
        "reconnects": reconnects,
    }
    if error:
        payload["error"] = error[:300]
    return {
        "eventId": uuid7(),
        "type": "camera.health",
        "occurredAt": iso(at),
        "cameraId": camera_id,
        "payload": payload,
    }


def heartbeat(*, at: float, version: str, uptime_s: float, queue_depth: int) -> Event:
    return {
        "eventId": uuid7(),
        "type": "device.heartbeat",
        "occurredAt": iso(at),
        "payload": {"version": version[:40], "uptimeS": round(uptime_s, 1), "queueDepth": queue_depth},
    }
