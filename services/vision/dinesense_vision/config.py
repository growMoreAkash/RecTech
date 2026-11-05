"""Service settings (environment variables prefixed DS_, or a .env file next to the process)."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DS_", env_file=".env", extra="ignore")

    #: API base URL including the /api/v1 prefix.
    api_url: str = "http://localhost:4000/api/v1"
    #: Edge device id and secret, shown once when a manager registers the device (dashboard → Cameras).
    device_id: str = ""
    device_secret: SecretStr = SecretStr("")

    #: DEV_MODE: cameras whose URL is a file:// path loop that file in real time (no RTSP needed).
    dev_mode: bool = False
    #: "yolox" for real cameras; "synthetic" only understands footage made by `ds-vision synth`.
    detector: Literal["yolox", "synthetic"] = "yolox"
    model_path: Path = Path("models/yolox_s.onnx")
    #: Person detections below this score are ignored.
    min_confidence: float = Field(0.35, ge=0, le=1)

    #: Local state (SQLite outbox). Never holds video.
    data_dir: Path = Path("data")
    config_poll_seconds: float = Field(30, gt=0)
    health_interval_seconds: float = Field(30, gt=0)
    send_interval_seconds: float = Field(1, gt=0)
    http_timeout_seconds: float = Field(10, gt=0)
