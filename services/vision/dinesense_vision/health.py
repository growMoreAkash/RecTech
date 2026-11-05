"""Per-camera health statistics → camera.health events."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any, Literal

from .events import camera_health

Status = Literal["ok", "degraded", "down"]
DOWN_AFTER_SECONDS = 15.0


@dataclass
class CameraStats:
    target_fps: float
    frames: deque[float] = field(default_factory=lambda: deque(maxlen=200))
    latency_ms: float = 0.0
    last_frame_at: float | None = None

    def frame(self, at: float, latency_ms: float) -> None:
        self.frames.append(at)
        self.last_frame_at = at
        # Smoothed processing latency (detector + tracking per frame).
        self.latency_ms = latency_ms if not self.latency_ms else 0.8 * self.latency_ms + 0.2 * latency_ms

    def fps(self, now: float, window: float = 10.0) -> float:
        recent = [t for t in self.frames if t >= now - window]
        if len(recent) < 2:
            return 0.0
        return (len(recent) - 1) / max(1e-6, recent[-1] - recent[0])

    def status(self, now: float, error: str | None) -> Status:
        if self.last_frame_at is None or now - self.last_frame_at > DOWN_AFTER_SECONDS:
            return "down"
        if error or self.fps(now) < 0.5 * self.target_fps:
            return "degraded"
        return "ok"

    def event(self, camera_id: str, now: float, reconnects: int, error: str | None) -> dict[str, Any]:
        return camera_health(
            camera_id=camera_id,
            at=now,
            status=self.status(now, error),
            fps=self.fps(now),
            latency_ms=self.latency_ms,
            last_frame_at=self.last_frame_at,
            reconnects=reconnects,
            error=error,
        )
