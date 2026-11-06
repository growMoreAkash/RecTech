"""YOLOX person detector on ONNX Runtime (CPU, or CUDA when available).

Model: Megvii YOLOX (Apache-2.0) COCO weights exported to ONNX, downloaded by `ds-vision fetch-model`.
Class 0 (person) drives occupancy; the COCO tableware classes (cup, bowl, bottle, wine glass, fork, knife, spoon)
feed the dirty-table check.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import numpy.typing as npt

from .base import TABLEWARE, Detection, Frame

MODELS: dict[str, tuple[str, str]] = {
    # name: (url, sha256)
    "yolox_nano": (
        "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx",
        "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d",
    ),
    "yolox_s": (
        "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx",
        "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063",
    ),
}

FloatArray = npt.NDArray[np.float32]


def letterbox(frame: Frame, size: tuple[int, int]) -> tuple[FloatArray, float]:
    """Resizes keeping the aspect ratio, pads with 114 (as YOLOX was trained); returns NCHW float input."""
    h, w = size
    ratio = min(h / frame.shape[0], w / frame.shape[1])
    resized = cv2.resize(
        frame, (int(frame.shape[1] * ratio), int(frame.shape[0] * ratio)), interpolation=cv2.INTER_LINEAR
    )
    padded = np.full((h, w, 3), 114, dtype=np.uint8)
    padded[: resized.shape[0], : resized.shape[1]] = resized
    return np.ascontiguousarray(padded.transpose(2, 0, 1)[None], dtype=np.float32), ratio


def decode(output: FloatArray, size: tuple[int, int], strides: tuple[int, ...] = (8, 16, 32)) -> FloatArray:
    """Turns raw YOLOX head output (1, N, 85) into (N, 85) with boxes as cx, cy, w, h in input pixels."""
    h, w = size
    grids: list[FloatArray] = []
    expanded: list[FloatArray] = []
    for s in strides:
        gh, gw = h // s, w // s
        xv, yv = np.meshgrid(np.arange(gw), np.arange(gh))
        grids.append(np.stack((xv, yv), 2).reshape(-1, 2).astype(np.float32))
        expanded.append(np.full((gh * gw, 1), s, dtype=np.float32))
    grid = np.concatenate(grids)
    stride = np.concatenate(expanded)
    out: FloatArray = output[0].astype(np.float32).copy()
    out[:, :2] = (out[:, :2] + grid) * stride
    out[:, 2:4] = np.exp(out[:, 2:4]) * stride
    return out


def persons(decoded: FloatArray, ratio: float, min_confidence: float, nms_iou: float = 0.45) -> list[Detection]:
    scores = decoded[:, 4] * decoded[:, 5]  # objectness × person class score
    keep = scores >= min_confidence
    if not keep.any():
        return []
    boxes = decoded[keep, :4] / ratio
    scores = scores[keep]
    xywh = [[float(cx - bw / 2), float(cy - bh / 2), float(bw), float(bh)] for cx, cy, bw, bh in boxes]
    idx = cv2.dnn.NMSBoxes(xywh, scores.tolist(), min_confidence, nms_iou)
    out = []
    for i in np.array(idx).reshape(-1):
        x, y, bw, bh = xywh[int(i)]
        out.append(Detection(x, y, x + bw, y + bh, float(scores[int(i)])))
    return out


def tableware(decoded: FloatArray, ratio: float, min_confidence: float, nms_iou: float = 0.45) -> list[Detection]:
    """Boxes whose best COCO class is a tableware class (column 5 + class id)."""
    if decoded.shape[1] < 85:
        return []
    cls = decoded[:, 5:85].argmax(axis=1)
    scores = decoded[:, 4] * decoded[np.arange(len(decoded)), 5 + cls]
    keep = np.isin(cls, list(TABLEWARE)) & (scores >= min_confidence)
    if not keep.any():
        return []
    boxes, scores, cls = decoded[keep, :4] / ratio, scores[keep], cls[keep]
    xywh = [[float(cx - bw / 2), float(cy - bh / 2), float(bw), float(bh)] for cx, cy, bw, bh in boxes]
    idx = cv2.dnn.NMSBoxes(xywh, scores.tolist(), min_confidence, nms_iou)
    out = []
    for i in np.array(idx).reshape(-1):
        x, y, bw, bh = xywh[int(i)]
        out.append(Detection(x, y, x + bw, y + bh, float(scores[int(i)]), TABLEWARE[int(cls[int(i)])]))
    return out


class YoloxDetector:
    def __init__(self, model_path: Path, min_confidence: float = 0.35) -> None:
        import onnxruntime as ort

        if not model_path.exists():
            raise FileNotFoundError(f"{model_path} not found — run `ds-vision fetch-model`")
        providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
        self._session = ort.InferenceSession(str(model_path), providers=providers)
        inp = self._session.get_inputs()[0]
        self._input = inp.name
        self._size = (int(inp.shape[2]), int(inp.shape[3]))
        self._min_confidence = min_confidence

    def detect(self, frame: Frame) -> list[Detection]:
        blob, ratio = letterbox(frame, self._size)
        (raw,) = self._session.run(None, {self._input: blob})
        decoded = decode(np.asarray(raw), self._size)
        return persons(decoded, ratio, self._min_confidence) + tableware(decoded, ratio, self._min_confidence)
