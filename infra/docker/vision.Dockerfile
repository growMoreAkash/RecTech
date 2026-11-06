# Edge vision service (runs on the restaurant's mini-PC, next to the cameras).
#   docker compose -f infra/docker-compose.yml --profile edge up -d vision
# CPU ONNX Runtime by default; for NVIDIA GPUs swap onnxruntime for onnxruntime-gpu and run with --gpus all.
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /usr/local/bin/uv
WORKDIR /app
COPY services/vision/pyproject.toml services/vision/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/vision/dinesense_vision ./dinesense_vision
RUN uv sync --frozen --no-dev && uv run ds-vision fetch-model --name yolox_s --dir /app/models
RUN useradd --system --uid 10001 vision && mkdir -p /app/data && chown vision /app/data
USER vision
ENV DS_MODEL_PATH=/app/models/yolox_s.onnx DS_DATA_DIR=/app/data
ENTRYPOINT ["uv", "run", "--no-sync", "ds-vision"]
CMD ["run"]
