"""Table zones: normalised polygons drawn on a calibration snapshot in the dashboard."""

from __future__ import annotations

from collections.abc import Sequence

from .detect import Detection
from .models import Zone

Point = tuple[float, float]


def point_in_polygon(p: Point, polygon: Sequence[Point]) -> bool:
    """Even-odd ray casting."""
    x, y = p
    inside = False
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def anchor(d: Detection, frame_w: int, frame_h: int) -> Point:
    """Normalised lower-body point: where a person sits or stands relative to the table, robust to height."""
    return ((d.x1 + d.x2) / 2 / frame_w, (d.y1 + 0.85 * d.height) / frame_h)


def centre(d: Detection, frame_w: int, frame_h: int) -> Point:
    """Normalised box centre (tableware sits on the table, so its centre is what counts)."""
    return ((d.x1 + d.x2) / 2 / frame_w, (d.y1 + d.y2) / 2 / frame_h)


def zone_of(d: Detection, zones: Sequence[Zone], frame_w: int, frame_h: int) -> str | None:
    p = anchor(d, frame_w, frame_h)
    for z in zones:
        if point_in_polygon(p, z.polygon):
            return z.table_id
    return None
