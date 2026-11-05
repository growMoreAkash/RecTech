"""The service loop pieces against a mocked API: config → workers → events/snapshot/health → signed batch."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx
import numpy as np
from pydantic import SecretStr

from dinesense_vision.api_client import EdgeApi
from dinesense_vision.config import Settings
from dinesense_vision.detect import Detection
from dinesense_vision.detect.base import Frame
from dinesense_vision.service import EdgeService


class StillSource:
    """A camera that always shows two seated guests."""

    reconnects = 0
    error: str | None = None

    def read(self) -> Frame | None:
        return np.zeros((360, 640, 3), np.uint8)

    def close(self) -> None:
        pass


class TwoSeated:
    def detect(self, frame: Frame) -> list[Detection]:
        return [Detection(100, 100, 126, 130, 0.9), Detection(140, 100, 166, 130, 0.9)]


def _config(version: str, zones: list[dict[str, Any]], snapshot: bool = False) -> dict[str, Any]:
    return {
        "outletId": "o1",
        "configVersion": version,
        "settings": {"occupancyConfirmSeconds": 1, "vacancyConfirmSeconds": 5, "staffPresentSeconds": 1},
        "cameras": [
            {
                "id": "cam1",
                "name": "Hall",
                "rtspUrl": "rtsp://cam/1",
                "fps": 10,
                "enabled": True,
                "snapshotWanted": snapshot,
                "zones": zones,
            }
        ],
    }


def test_service_runs_cameras_and_ships_events(tmp_path: Path) -> None:
    state: dict[str, Any] = {"config": _config("v1", [], snapshot=True), "batches": [], "snapshots": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/edge/config"):
            return httpx.Response(200, json=state["config"])
        if req.url.path.endswith("/snapshot"):
            assert req.content[:2] == b"\xff\xd8"
            state["snapshots"] += 1
            return httpx.Response(204)
        body = json.loads(req.content)
        state["batches"].append(body["events"])
        return httpx.Response(200, json={"accepted": [e["eventId"] for e in body["events"]]})

    settings = Settings(device_id="edg_1", device_secret=SecretStr("s"), data_dir=tmp_path, detector="synthetic")
    api = EdgeApi("http://api.test/api/v1", "edg_1", "s", transport=httpx.MockTransport(handler))
    svc = EdgeService(settings, api=api, detector=TwoSeated(), source_factory=lambda url: StillSource())
    try:
        svc.refresh_config()
        assert list(svc.workers) == ["cam1"]
        first = svc.workers["cam1"][1]
        _wait(lambda: state["snapshots"] == 1)

        # Zones change → the worker restarts with them; the table is confirmed occupied after 1 s.
        state["config"] = _config("v2", [{"tableId": "t1", "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]]}])
        svc.refresh_config()
        assert svc.workers["cam1"][1] is not first
        _wait(lambda: svc.outbox.depth() >= 1)
        svc.report_health()
        while svc.sender.flush_once():
            pass
        sent = [e for batch in state["batches"] for e in batch]
        kinds = {e["type"] for e in sent}
        assert {"table.occupied", "camera.health", "device.heartbeat"} <= kinds
        occupied = next(e for e in sent if e["type"] == "table.occupied")
        assert occupied["tableId"] == "t1" and occupied["payload"]["guestCount"] == 2
        assert svc.outbox.depth() == 0

        # Camera removed from the device → its worker stops.
        state["config"] = {**_config("v3", []), "cameras": []}
        svc.refresh_config()
        assert svc.workers == {}
    finally:
        for _, w in svc.workers.values():
            w.stop()


def test_file_cameras_need_dev_mode() -> None:
    from dinesense_vision.sources import open_source

    try:
        open_source("file:///tmp/x.mp4", dev_mode=False)
    except ValueError as e:
        assert "DS_DEV_MODE" in str(e)
    else:  # pragma: no cover
        raise AssertionError("file:// accepted outside dev mode")


def _wait(cond: Any, timeout: float = 5) -> None:
    deadline = time.monotonic() + timeout
    while not cond():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.05)
