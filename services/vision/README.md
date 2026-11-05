# DineSense edge vision

Runs at the outlet, next to the cameras. Turns camera frames into table events
(`table.occupied`, `table.vacated`, `table.guest_count_changed`, `table.staff_present`) plus camera health, and
sends them to the API as HMAC-signed batches. **Video never leaves the process**; only calibration snapshots are
uploaded, with heads and faces pixelated. No face recognition.

```bash
uv sync                                   # Python 3.11
uv run ds-vision fetch-model              # YOLOX-S ONNX (Apache-2.0), sha256-verified → models/
cp ../../.env.example .env                # set DS_API_URL, DS_DEVICE_ID, DS_DEVICE_SECRET (dashboard → Cameras)
uv run ds-vision run                      # real RTSP cameras configured in the dashboard
uv run ds-vision run --dev --detector synthetic   # file:// cameras looping synthetic footage
uv run ds-vision synth --out samples      # labelled synthetic footage + zones
uv run ds-vision eval --detector synthetic --video samples/dining-room.mp4 \
  --labels samples/dining-room.labels.csv --zones samples/dining-room.zones.json
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
```

Pipeline (`pipeline.py`, identical live and in `eval`): detect (YOLOX) → posture (box aspect ratio) → IoU tracker →
zone (lower-body point in the table polygon) → per-table debounce (`occupancy.py`) and staff presence (`staff.py`)
→ events → SQLite outbox (`outbox.py`) → signed POST `/edge/events` (`sender.py`).

The event contract and signing spec live in `packages/shared/src/edge`; `dinesense_vision/contracts/edge-contracts.json`
is generated from them (`pnpm --filter @dinesense/shared gen:edge-schema`) and checked by the tests.

Licences: YOLOX weights Apache-2.0 (Megvii); OpenCV Apache-2.0 (Haar cascade data: Intel licence, BSD-style);
ONNX Runtime MIT.
