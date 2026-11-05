"""One camera's processing: detect → posture → track → zones → occupancy / staff presence → edge events.

The same pipeline runs live (worker.py) and in `ds-vision eval`, so accuracy numbers describe production
behaviour.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .detect import Detection, Detector
from .detect.base import Frame
from .events import table_event
from .models import CameraConfig, EdgeSettings
from .occupancy import CountChanged, OccupancyTracker, Occupied, Vacated
from .posture import AspectRatioPosture, PostureEstimator
from .staff import StaffPresence
from .track import IouTracker
from .zones import zone_of


@dataclass
class FrameResult:
    events: list[dict[str, Any]] = field(default_factory=list)
    detections: list[Detection] = field(default_factory=list)
    #: table id → number of seated people seen in its zone on this frame
    counts: dict[str, int] = field(default_factory=dict)


class CameraPipeline:
    def __init__(
        self,
        camera: CameraConfig,
        settings: EdgeSettings,
        detector: Detector,
        posture: PostureEstimator | None = None,
        min_confidence: float = 0.35,
    ) -> None:
        self.camera = camera
        self.detector = detector
        self.posture = posture or AspectRatioPosture()
        self.min_confidence = min_confidence
        self.tracker = IouTracker()
        self.tables = {
            z.table_id: OccupancyTracker(settings.occupancy_confirm_seconds, settings.vacancy_confirm_seconds)
            for z in camera.zones
        }
        self.staff = {z.table_id: StaffPresence(settings.staff_present_seconds) for z in camera.zones}

    def occupied(self) -> dict[str, bool]:
        return {t: occ.occupied for t, occ in self.tables.items()}

    def process(self, frame: Frame, now: float) -> FrameResult:
        h, w = frame.shape[:2]
        detections = [d for d in self.detector.detect(frame) if d.confidence >= self.min_confidence]
        tracks = self.tracker.update(detections, now)
        seated: dict[str, list[float]] = {t: [] for t in self.tables}
        standing: dict[str, list[tuple[int, float]]] = {t: [] for t in self.tables}
        for tr in tracks:
            table = zone_of(tr.detection, self.camera.zones, w, h)
            if table is None:
                continue
            if self.posture.posture(tr.detection) == "seated":
                seated[table].append(tr.detection.confidence)
            else:
                standing[table].append((tr.id, tr.detection.confidence))

        result = FrameResult(detections=detections, counts={t: len(c) for t, c in seated.items()})
        cam = self.camera.id
        for table, occ in self.tables.items():
            confs = seated[table]
            was_occupied = occ.occupied
            for ch in occ.update(now, len(confs), sum(confs) / len(confs) if confs else 0.0):
                if isinstance(ch, Occupied):
                    result.events.append(
                        table_event(
                            "table.occupied",
                            camera_id=cam,
                            table_id=table,
                            at=ch.at,
                            confidence=ch.confidence,
                            payload={"guestCount": ch.guest_count, "dwellSeconds": round(ch.dwell_seconds, 1)},
                        )
                    )
                elif isinstance(ch, Vacated):
                    result.events.append(
                        table_event(
                            "table.vacated",
                            camera_id=cam,
                            table_id=table,
                            at=ch.at,
                            confidence=ch.confidence,
                            payload={"emptySeconds": round(ch.empty_seconds, 1)},
                        )
                    )
                elif isinstance(ch, CountChanged):
                    result.events.append(
                        table_event(
                            "table.guest_count_changed",
                            camera_id=cam,
                            table_id=table,
                            at=ch.at,
                            confidence=ch.confidence,
                            payload={"guestCount": ch.guest_count, "previous": ch.previous},
                        )
                    )
            if was_occupied and not occ.occupied:
                self.staff[table].reset()
            for sp in self.staff[table].update(now, standing[table], occ.occupied):
                result.events.append(
                    table_event(
                        "table.staff_present",
                        camera_id=cam,
                        table_id=table,
                        at=sp.at,
                        confidence=sp.confidence,
                        payload={"seconds": round(sp.seconds, 1), "trackId": sp.track_id},
                    )
                )
        return result
