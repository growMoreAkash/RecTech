"""ds-vision: run | synth | eval | snapshot | record | fetch-model"""

from __future__ import annotations

import argparse
import hashlib
import logging
import sys
import time
from pathlib import Path

import httpx

from . import __version__
from .detect import Detector
from .detect.base import Frame
from .sources import FrameSource


def _cmd_run(args: argparse.Namespace) -> int:
    from .config import Settings
    from .service import EdgeService

    overrides: dict[str, object] = {}
    if args.dev:
        overrides["dev_mode"] = True
    if args.detector:
        overrides["detector"] = args.detector
    settings = Settings(**overrides)  # type: ignore[arg-type]
    if not settings.device_id or not settings.device_secret.get_secret_value():
        print("Set DS_DEVICE_ID and DS_DEVICE_SECRET (dashboard → Cameras → Register edge device).", file=sys.stderr)
        return 2
    EdgeService(settings).run()
    return 0


def _cmd_synth(args: argparse.Namespace) -> int:
    from .synth import generate

    video = generate(Path(args.out), args.name, args.seconds, args.fps, args.seed)
    print(f"wrote {video} (+ .labels.csv, .zones.json)")
    return 0


def _detector(name: str, model: str, min_conf: float) -> Detector:
    if name == "synthetic":
        from .detect.synthetic import SyntheticDetector

        return SyntheticDetector()
    from .detect.yolox import YoloxDetector

    return YoloxDetector(Path(model), min_conf)


def _cmd_eval(args: argparse.Namespace) -> int:
    from .evaluate import evaluate, load_arrivals, load_dirty, load_door, load_labels, load_zones
    from .models import EdgeSettings
    from .sources import iter_video

    settings = EdgeSettings(
        occupancyConfirmSeconds=args.confirm,
        vacancyConfirmSeconds=args.vacancy,
        staffPresentSeconds=args.staff,
        dirtyConfirmSeconds=args.dirty_confirm,
    )
    started = time.monotonic()
    report = evaluate(
        iter_video(args.video, args.fps),
        load_labels(Path(args.labels)),
        load_zones(Path(args.zones)),
        _detector(args.detector, args.model, args.min_confidence),
        settings,
        door=load_door(Path(args.zones)),
        arrivals=load_arrivals(Path(args.arrivals)) if args.arrivals else None,
        dirty=load_dirty(Path(args.dirty)) if args.dirty else None,
    )
    print(report.text())
    print(f"(evaluated in {time.monotonic() - started:.1f}s)")
    return 0 if report.adjusted_accuracy >= args.target else 1


def _cmd_snapshot(args: argparse.Namespace) -> int:
    from .privacy import snapshot_jpeg
    from .sources import open_source
    from .sources.rtsp import RtspSource, wait_for_frame

    src = open_source(args.url, dev_mode=True)
    try:
        frame = wait_for_frame(src) if isinstance(src, RtspSource) else _first(src)
    finally:
        src.close()
    if frame is None:
        print("no frame received", file=sys.stderr)
        return 1
    found = _detector(args.detector, args.model, 0.35).detect(frame) if args.detector != "none" else []
    people = [d for d in found if d.label == "person"]
    Path(args.out).write_bytes(snapshot_jpeg(frame, people))
    print(f"wrote {args.out} (heads/faces pixelated)")
    return 0


def _first(src: FrameSource) -> Frame | None:
    for _ in range(200):
        frame = src.read()
        if frame is not None:
            return frame
        time.sleep(0.05)
    return None


def _cmd_record(args: argparse.Namespace) -> int:
    import cv2

    print(
        "Recording stays on this machine for labelling. Get consent/notice per your DPDP policy and delete it "
        "after use.",
        file=sys.stderr,
    )
    cap = cv2.VideoCapture(args.url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        print("cannot open stream", file=sys.stderr)
        return 1
    ok, frame = cap.read()
    if not ok:
        return 1
    h, w = frame.shape[:2]
    writer = cv2.VideoWriter(args.out, cv2.VideoWriter.fourcc(*"mp4v"), args.fps, (w, h))
    deadline, step, next_at = time.monotonic() + args.seconds, 1.0 / args.fps, 0.0
    try:
        while ok and time.monotonic() < deadline:
            if time.monotonic() >= next_at:
                writer.write(frame)
                next_at = time.monotonic() + step
            ok, frame = cap.read()
    finally:
        writer.release()
        cap.release()
    print(f"wrote {args.out}")
    return 0


def _cmd_fetch_model(args: argparse.Namespace) -> int:
    from .detect.yolox import MODELS

    url, sha = MODELS[args.name]
    dest = Path(args.dir) / f"{args.name}.onnx"
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"{args.name}: Megvii YOLOX, Apache-2.0 licence — {url}")
    h = hashlib.sha256()
    tmp = dest.with_suffix(".part")
    with httpx.stream("GET", url, follow_redirects=True, timeout=60) as res, tmp.open("wb") as f:
        res.raise_for_status()
        for chunk in res.iter_bytes(1 << 16):
            h.update(chunk)
            f.write(chunk)
    if h.hexdigest() != sha:
        tmp.unlink()
        print(f"checksum mismatch for {url}", file=sys.stderr)
        return 1
    tmp.replace(dest)
    print(f"wrote {dest}")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="ds-vision", description="DineSense edge vision service")
    p.add_argument("--version", action="version", version=__version__)
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="run the edge service (settings from DS_* env vars)")
    r.add_argument("--dev", action="store_true", help="allow file:// cameras (loop sample videos)")
    r.add_argument("--detector", choices=["yolox", "synthetic"])
    r.set_defaults(fn=_cmd_run)

    s = sub.add_parser("synth", help="generate synthetic footage + labels + zones")
    s.add_argument("--out", default="samples")
    s.add_argument("--name", default="dining-room")
    s.add_argument("--seconds", type=float, default=900)
    s.add_argument("--fps", type=int, default=5)
    s.add_argument("--seed", type=int, default=7)
    s.set_defaults(fn=_cmd_synth)

    det = argparse.ArgumentParser(add_help=False)
    det.add_argument("--detector", choices=["yolox", "synthetic"], default="yolox")
    det.add_argument("--model", default="models/yolox_s.onnx")
    det.add_argument("--min-confidence", type=float, default=0.35)

    e = sub.add_parser("eval", parents=[det], help="score the pipeline on a labelled video")
    e.add_argument("--video", required=True)
    e.add_argument("--labels", required=True, help="CSV: table_id,start_s,end_s,state")
    e.add_argument("--zones", required=True, help='JSON: {"zones": [{"tableId", "polygon"}]}')
    e.add_argument("--arrivals", help="CSV: time_s,size (party arrivals at the door, from synth)")
    e.add_argument("--dirty", help="CSV: table_id,start_s,end_s (tableware left on empty tables, from synth)")
    e.add_argument("--fps", type=float, default=3)
    e.add_argument("--confirm", type=float, default=30)
    e.add_argument("--vacancy", type=float, default=90)
    e.add_argument("--staff", type=float, default=10)
    e.add_argument("--dirty-confirm", type=float, default=20)
    e.add_argument("--target", type=float, default=0.95, help="exit 1 below this adjusted accuracy")
    e.set_defaults(fn=_cmd_eval)

    sn = sub.add_parser("snapshot", parents=[det], help="save one blurred calibration frame locally")
    sn.add_argument("--url", required=True)
    sn.add_argument("--out", default="snapshot.jpg")
    sn.set_defaults(fn=_cmd_snapshot)

    rec = sub.add_parser("record", help="record footage locally for labelling (never uploaded)")
    rec.add_argument("--url", required=True)
    rec.add_argument("--out", required=True)
    rec.add_argument("--seconds", type=float, default=300)
    rec.add_argument("--fps", type=float, default=5)
    rec.set_defaults(fn=_cmd_record)

    fm = sub.add_parser("fetch-model", help="download a YOLOX ONNX model (checksum verified)")
    fm.add_argument("--name", choices=["yolox_s", "yolox_nano"], default="yolox_s")
    fm.add_argument("--dir", default="models")
    fm.set_defaults(fn=_cmd_fetch_model)

    args = p.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    return int(args.fn(args))


if __name__ == "__main__":
    raise SystemExit(main())
