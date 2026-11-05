from __future__ import annotations

import random

import cv2
import numpy as np

from dinesense_vision.detect import Detection
from dinesense_vision.detect.synthetic import SyntheticDetector
from dinesense_vision.detect.yolox import decode, letterbox, persons
from dinesense_vision.privacy import blur_people, snapshot_jpeg
from dinesense_vision.synth import TABLES, plan, render


def test_letterbox_keeps_aspect_and_pads() -> None:
    frame = np.zeros((360, 640, 3), np.uint8)
    blob, ratio = letterbox(frame, (640, 640))
    assert blob.shape == (1, 3, 640, 640) and ratio == 1.0
    assert blob[0, 0, 500, 0] == 114


def test_yolox_decode_and_person_filter() -> None:
    size = (64, 64)
    n = (8 * 8) + (4 * 4) + (2 * 2)
    raw = np.zeros((1, n, 85), np.float32)
    # Anchor 9 of stride 8 → grid (1, 1); a person at the centre of that cell, 16×32 px.
    raw[0, 9, :4] = [0.5, 0.5, np.log(2), np.log(4)]
    raw[0, 9, 4], raw[0, 9, 5] = 0.9, 0.9
    # A confident non-person (class 2, car) is ignored.
    raw[0, 10, 4], raw[0, 10, 7] = 0.9, 0.9
    dec = decode(raw, size)
    (p,) = persons(dec, ratio=0.5, min_confidence=0.3)
    assert (p.x1, p.y1, p.x2, p.y2) == (8.0, -8.0, 40.0, 56.0)
    assert abs(p.confidence - 0.81) < 1e-6


def test_synthetic_detector_finds_seated_and_standing_people() -> None:
    rng = random.Random(1)
    parties = plan(600, rng)
    p = parties[0]
    frame = render(p.seated_from + 5, [p], rng, noise=False)
    dets = SyntheticDetector().detect(frame)
    assert len(dets) == p.size
    assert all(d.height / d.width < 2 for d in dets)
    walking = SyntheticDetector().detect(render(p.arrive + 1, [p], rng, noise=False))
    assert len(walking) >= 1 and all(d.height / d.width > 2 for d in walking)
    assert len(SyntheticDetector().detect(render(0, [], rng, noise=False))) == 0
    assert len(TABLES) == 4


def test_snapshot_pixelates_heads_and_is_a_small_jpeg() -> None:
    rng = np.random.default_rng(0)
    frame = rng.integers(0, 255, (720, 1920, 3), dtype=np.uint8)
    person = Detection(200, 100, 300, 400, 0.9)
    out = blur_people(frame, [person])
    head = out[100:200, 200:300].astype(int)
    assert (
        np.abs(np.diff(head, axis=1)).mean() < np.abs(np.diff(frame[100:200, 200:300].astype(int), axis=1)).mean() / 3
    )
    assert np.array_equal(out[300:400, 600:700], frame[300:400, 600:700])  # elsewhere untouched
    jpeg = snapshot_jpeg(frame, [person])
    assert jpeg[:2] == b"\xff\xd8"
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[1] == 1280
