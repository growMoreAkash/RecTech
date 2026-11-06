"""The device configuration served by GET /edge/config."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class _Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, frozen=True, extra="ignore")


class Zone(_Model):
    table_id: str = Field(alias="tableId")
    #: Normalised [x, y] points in 0..1 of the frame.
    polygon: tuple[tuple[float, float], ...]


class CameraConfig(_Model):
    id: str
    name: str
    rtsp_url: str = Field(alias="rtspUrl", repr=False)
    fps: int = 3
    enabled: bool = True
    snapshot_wanted: bool = Field(False, alias="snapshotWanted")
    zones: tuple[Zone, ...] = ()
    #: Entrance zone (normalised polygon) for party-size estimates; None when this camera doesn't watch the door.
    door: tuple[tuple[float, float], ...] | None = None


class EdgeSettings(_Model):
    occupancy_confirm_seconds: float = Field(30, alias="occupancyConfirmSeconds")
    vacancy_confirm_seconds: float = Field(90, alias="vacancyConfirmSeconds")
    staff_present_seconds: float = Field(10, alias="staffPresentSeconds")
    dirty_confirm_seconds: float = Field(20, alias="dirtyConfirmSeconds")


class EdgeConfig(_Model):
    outlet_id: str = Field(alias="outletId")
    config_version: str = Field(alias="configVersion")
    settings: EdgeSettings
    cameras: tuple[CameraConfig, ...] = ()
