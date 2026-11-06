"""Synthetic dining-room footage with ground-truth labels, for dev mode and the eval harness.

There is no real footage in the repo (and none may be stored without consent), so `ds-vision synth` draws a
top-down-ish room: tables, guests who walk in (standing), sit (seated), get visited by a waiter (standing at the
table) and leave. People are saturated colour blobs that `SyntheticDetector` finds; sensor noise, missed
detections and false positives are injected so the debounce logic is exercised. Output:
  <name>.mp4            the video
  <name>.labels.csv     table_id,start_s,end_s,state   (ground-truth occupied intervals)
  <name>.zones.json     {"zones": [{"tableId", "polygon"}], "door": polygon} — the calibration a manager would draw
  <name>.arrivals.csv   time_s,size   (ground-truth parties coming through the door)
  <name>.dirty.csv      table_id,start_s,end_s   (tableware left on the table after the party left, until cleared)
"""

from __future__ import annotations

import csv
import json
import random
from dataclasses import dataclass, replace
from pathlib import Path

import cv2
import numpy as np

from .detect.base import Frame

W, H = 640, 360
DOOR = (30.0, 330.0)
FLOOR = (96, 100, 104)
TABLE = (70, 85, 105)
WALK_S = 4.0
#: Members of a party come through the door this far apart (seconds).
STAGGER_S = 0.8
#: Entrance zone (normalised) around DOOR, as a manager would draw it on the entrance camera.
DOOR_ZONE = [[0.0, 0.72], [0.22, 0.72], [0.22, 1.0], [0.0, 1.0]]
SEATED = (26, 30)  # w, h  → aspect 1.15 (seated)
STANDING = (16, 48)  # aspect 3.0 (standing)


@dataclass(frozen=True)
class Table:
    id: str
    x: int
    y: int
    w: int = 90
    h: int = 50

    def seats(self, n: int) -> list[tuple[float, float]]:
        """Centres of seated guests: alternate above and below the table."""
        cols = max(1, (n + 1) // 2)
        out: list[tuple[float, float]] = []
        for i in range(n):
            col, row = i // 2, i % 2
            cx = self.x + self.w * (col + 1) / (cols + 1)
            cy = self.y - 14 if row == 0 else self.y + self.h + 16
            out.append((cx, cy))
        return out

    def polygon(self) -> list[list[float]]:
        m = 34
        x1, y1, x2, y2 = self.x - m, self.y - m, self.x + self.w + m, self.y + self.h + m
        return [[round(x / W, 4), round(y / H, 4)] for x, y in ((x1, y1), (x2, y1), (x2, y2), (x1, y2))]


TABLES = (Table("T1", 80, 90), Table("T2", 275, 90), Table("T3", 470, 90), Table("T4", 275, 240))


@dataclass(frozen=True)
class Party:
    table: Table
    size: int
    arrive: float  # starts walking in
    leave: float  # stands up and walks out
    hue: int
    waiter_at: float  # waiter stands at the table from here for `waiter_for` seconds
    waiter_for: float
    #: Cups and plates stay on the table this long after the party left (busser clears them).
    clear_after: float = 0.0

    @property
    def seated_from(self) -> float:
        return self.arrive + WALK_S

    @property
    def seated_to(self) -> float:
        return self.leave


def plan(seconds: float, rng: random.Random) -> list[Party]:
    parties: list[Party] = []
    for t in TABLES:
        clock = rng.uniform(5, 60)
        while True:
            stay = rng.uniform(150, 300)
            if clock + WALK_S + stay + WALK_S > seconds - 5:
                break
            seated = clock + WALK_S
            parties.append(
                Party(
                    table=t,
                    size=rng.randint(1, 4),
                    arrive=clock,
                    leave=seated + stay,
                    hue=rng.randrange(0, 170, 10),
                    waiter_at=seated + rng.uniform(40, 90),
                    waiter_for=rng.uniform(12, 25),
                )
            )
            clock = seated + stay + WALK_S + rng.uniform(40, 150)
    return parties


def _blob(img: Frame, cx: float, cy: float, size: tuple[int, int], hue: int) -> None:
    w, h = size
    color = cv2.cvtColor(np.array([[[hue, 230, 210]]], np.uint8), cv2.COLOR_HSV2BGR)[0][0].tolist()
    cv2.ellipse(img, (int(cx), int(cy)), (w // 2, h // 2), 0, 0, 360, color, -1)


CUP = (255, 255, 255)


def _tableware(img: Frame, tb: Table, n: int) -> None:
    """Small white squares on the table top: cups, plates, glasses."""
    for i in range(n):
        x = int(tb.x + tb.w * (i + 1) / (n + 1)) - 4
        y = int(tb.y + tb.h / 2) - 4 + (i % 2) * 10 - 5
        cv2.rectangle(img, (x, y), (x + 8, y + 8), CUP, -1)


def _lerp(a: tuple[float, float], b: tuple[float, float], f: float) -> tuple[float, float]:
    return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f


def render(t: float, parties: list[Party], rng: random.Random, noise: bool = True) -> Frame:
    img: Frame = np.full((H, W, 3), FLOOR, dtype=np.uint8)
    for tb in TABLES:
        cv2.rectangle(img, (tb.x, tb.y), (tb.x + tb.w, tb.y + tb.h), TABLE, -1)
    for p in parties:
        # Tableware from a minute into the meal until the busser clears it after they leave.
        if p.seated_from + 60 <= t < p.leave + p.clear_after:
            _tableware(img, p.table, 1 + p.size % 3)
        seats = p.table.seats(p.size)
        for k, seat in enumerate(seats):
            # Standing people are drawn so their lower-body point lands where the seated one would be.
            stand_at = (seat[0], seat[1] - (STANDING[1] - SEATED[1]) * 0.35)
            start = p.arrive + k * STAGGER_S
            if p.arrive <= t < start:
                continue  # still outside, behind the others
            # Everyone walks at the same pace, so the party stays spread out in single file.
            if start <= t < start + WALK_S:
                pos = _lerp(DOOR, stand_at, (t - start) / WALK_S)
                _blob(img, *pos, STANDING, (p.hue + 7 * k) % 180)
            elif start + WALK_S <= t < p.seated_to:
                if noise and rng.random() < 0.03:
                    continue  # missed detection
                _blob(img, *seat, SEATED, (p.hue + 7 * k) % 180)
            elif p.leave <= t < p.leave + WALK_S:
                pos = _lerp(stand_at, DOOR, (t - p.leave) / WALK_S)
                _blob(img, *pos, STANDING, (p.hue + 7 * k) % 180)
        if p.waiter_at <= t < min(p.waiter_at + p.waiter_for, p.seated_to):
            tb = p.table
            _blob(img, tb.x + tb.w + 18, tb.y + tb.h / 2 - 6, STANDING, 120)
    if noise:
        if rng.random() < 0.01:  # a one-frame false positive somewhere
            _blob(img, rng.uniform(20, W - 20), rng.uniform(20, H - 20), SEATED, rng.randrange(0, 180))
        img = cv2.add(img, rng.choice((0, 1, 2)) * np.ones_like(img))
    return img


def generate(out_dir: Path, name: str = "dining-room", seconds: float = 900, fps: int = 5, seed: int = 7) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)  # noqa: S311 — reproducible footage, not security
    parties = plan(seconds, rng)
    # Separate generator so adding tableware does not change the people in existing footage.
    crng = random.Random(seed + 1000)  # noqa: S311

    def cleared(p: Party) -> Party:
        # Always cleared before the next party at that table arrives.
        nxt = min((q.arrive for q in parties if q.table == p.table and q.arrive > p.leave), default=seconds)
        return replace(p, clear_after=min(crng.uniform(30, 240), max(5.0, nxt - p.leave - 5)))

    parties = [cleared(p) for p in parties]
    video = out_dir / f"{name}.mp4"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"mp4v"), fps, (W, H))
    try:
        for i in range(int(seconds * fps)):
            writer.write(render(i / fps, parties, rng))
    finally:
        writer.release()
    with (out_dir / f"{name}.labels.csv").open("w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["table_id", "start_s", "end_s", "state"])
        for p in sorted(parties, key=lambda p: (p.table.id, p.arrive)):
            wr.writerow([p.table.id, f"{p.seated_from:.1f}", f"{p.seated_to:.1f}", "occupied"])
    zones = {"zones": [{"tableId": t.id, "polygon": t.polygon()} for t in TABLES], "door": DOOR_ZONE}
    with (out_dir / f"{name}.arrivals.csv").open("w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["time_s", "size"])
        for p in sorted(parties, key=lambda p: p.arrive):
            wr.writerow([f"{p.arrive:.1f}", p.size])
    with (out_dir / f"{name}.dirty.csv").open("w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["table_id", "start_s", "end_s"])
        for p in sorted(parties, key=lambda p: (p.table.id, p.leave)):
            wr.writerow([p.table.id, f"{p.leave:.1f}", f"{p.leave + p.clear_after:.1f}"])
    (out_dir / f"{name}.zones.json").write_text(json.dumps(zones, indent=2) + "\n")
    return video
