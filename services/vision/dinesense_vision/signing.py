"""Edge request signing — the same spec as packages/shared/src/edge/signing.ts.

signature = hex(HMAC-SHA256(secret, f"{timestamp}.{METHOD}.{path}.{hex(sha256(body))}"))
The device secret itself is never sent; only the device id, timestamp and signature travel in headers.
"""

from __future__ import annotations

import hashlib
import hmac
import time

HEADER_DEVICE = "x-ds-device"
HEADER_TIMESTAMP = "x-ds-timestamp"
HEADER_SIGNATURE = "x-ds-signature"


def edge_signature(secret: str, timestamp: str, method: str, path: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    message = f"{timestamp}.{method.upper()}.{path}.{body_hash}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def signed_headers(
    device_id: str, secret: str, method: str, path: str, body: bytes, now: float | None = None
) -> dict[str, str]:
    ts = str(int(time.time() if now is None else now))
    return {
        HEADER_DEVICE: device_id,
        HEADER_TIMESTAMP: ts,
        HEADER_SIGNATURE: edge_signature(secret, ts, method, path, body),
    }
