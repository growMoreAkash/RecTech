from __future__ import annotations

import json
import time
from typing import Any

import httpx

from dinesense_vision import events
from dinesense_vision.api_client import EdgeApi
from dinesense_vision.outbox import Outbox
from dinesense_vision.sender import Sender
from dinesense_vision.signing import edge_signature


class Clock:
    def __init__(self, t: float = 1_000_000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def _ev(i: int, at: float) -> dict[str, Any]:
    e = events.heartbeat(at=at, version="t", uptime_s=i, queue_depth=0)
    e["eventId"] = f"evt_{i:06d}"
    return e


def test_outbox_replays_in_order_and_dedupes() -> None:
    clock = Clock()
    ob = Outbox(clock=clock)
    ob.put([_ev(1, clock.t), _ev(2, clock.t)])
    ob.put([_ev(1, clock.t), _ev(3, clock.t)])
    assert [e["eventId"] for e in ob.due()] == ["evt_000001", "evt_000002", "evt_000003"]
    ob.done(["evt_000002"])
    assert ob.depth() == 2


def test_outbox_backoff_and_stale_drop() -> None:
    clock = Clock()
    ob = Outbox(clock=clock)
    ob.put([_ev(1, clock.t)])
    ob.defer(["evt_000001"])
    assert ob.due() == []
    clock.t += 2
    assert len(ob.due()) == 1
    ob.defer(["evt_000001"])
    clock.t += 3
    assert ob.due() == []  # second attempt waits 4 s
    clock.t += 1
    assert len(ob.due()) == 1
    clock.t += 15 * 60 + 1
    assert ob.due() == [] and ob.depth() == 0


def test_outbox_is_bounded() -> None:
    ob = Outbox(max_rows=10)
    ob.put([_ev(i, time.time()) for i in range(25)])
    ids = [e["eventId"] for e in ob.due(100)]
    assert len(ids) == 10 and ids[0] == "evt_000015"


def test_outbox_survives_restart(tmp_path: Any) -> None:
    path = tmp_path / "ob.sqlite3"
    ob = Outbox(path)
    ob.put([_ev(1, time.time())])
    ob.close()
    assert Outbox(path).depth() == 1


def _api(handler: Any) -> EdgeApi:
    return EdgeApi("http://api.test/api/v1", "edg_1", "secret", transport=httpx.MockTransport(handler))


def test_sender_signs_requests_and_applies_the_per_event_result() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        assert req.url.path == "/api/v1/edge/events"
        sig = edge_signature("secret", req.headers["x-ds-timestamp"], "POST", "/api/v1/edge/events", req.content)
        assert req.headers["x-ds-signature"] == sig
        assert req.headers["x-ds-device"] == "edg_1"
        body = json.loads(req.content)
        assert body["deviceId"] == "edg_1"
        ids = [e["eventId"] for e in body["events"]]
        return httpx.Response(
            200,
            json={
                "accepted": ids[:1],
                "duplicates": ids[1:2],
                "rejected": [{"eventId": ids[2], "reason": "NO_ZONE"}],
                "retry": ids[3:],
            },
        )

    ob = Outbox()
    ob.put([_ev(i, time.time()) for i in range(4)])
    sender = Sender(_api(handler), ob)
    assert sender.flush_once() == 3
    assert ob.depth() == 1  # the retry one stays, with backoff
    assert sender.flush_once() == 0 and len(seen) == 1


def test_sender_keeps_events_when_the_api_is_down() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    ob = Outbox()
    ob.put([_ev(1, time.time())])
    sender = Sender(_api(handler), ob)
    assert sender.flush_once() == 0
    assert ob.depth() == 1 and sender.last_error and "ConnectError" in sender.last_error


def test_sender_keeps_events_on_auth_errors() -> None:
    ob = Outbox()
    ob.put([_ev(1, time.time())])
    sender = Sender(
        _api(lambda r: httpx.Response(401, json={"error": {"code": "UNAUTHENTICATED", "message": "Bad signature"}})),
        ob,
    )
    assert sender.flush_once() == 0
    assert ob.depth() == 1 and "Bad signature" in (sender.last_error or "")


def test_config_and_snapshot_requests() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/edge/config"):
            assert req.method == "GET"
            assert req.headers["x-ds-signature"] == edge_signature(
                "secret", req.headers["x-ds-timestamp"], "GET", "/api/v1/edge/config", b""
            )
            return httpx.Response(
                200,
                json={
                    "outletId": "o1",
                    "configVersion": "v1",
                    "settings": {"occupancyConfirmSeconds": 30, "vacancyConfirmSeconds": 90, "staffPresentSeconds": 10},
                    "cameras": [
                        {
                            "id": "c1",
                            "name": "Hall",
                            "rtspUrl": "rtsp://x",
                            "fps": 3,
                            "enabled": True,
                            "snapshotWanted": True,
                            "zones": [{"tableId": "t1", "polygon": [[0, 0], [1, 0], [1, 1]]}],
                        }
                    ],
                },
            )
        assert req.url.path == "/api/v1/edge/cameras/c1/snapshot"
        assert req.headers["content-type"] == "image/jpeg"
        return httpx.Response(204)

    api = _api(handler)
    cfg = api.get_config()
    assert cfg.cameras[0].zones[0].table_id == "t1" and cfg.settings.vacancy_confirm_seconds == 90
    assert "rtsp" not in repr(cfg.cameras[0])
    api.post_snapshot("c1", b"\xff\xd8jpeg")
