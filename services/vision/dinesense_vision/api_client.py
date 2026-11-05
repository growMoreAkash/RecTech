"""Signed HTTP client for the API's /edge endpoints."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx

from . import __version__
from .models import EdgeConfig
from .signing import signed_headers


class EdgeApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"{status}: {message}")
        self.status = status

    @property
    def transient(self) -> bool:
        """Network problems, 5xx and rate limits are retried; 4xx (bad credentials, bad request) are not."""
        return self.status == 0 or self.status >= 500 or self.status in (408, 429)


@dataclass
class BatchResult:
    accepted: list[str] = field(default_factory=list)
    duplicates: list[str] = field(default_factory=list)
    rejected: list[dict[str, str]] = field(default_factory=list)
    retry: list[str] = field(default_factory=list)


class EdgeApi:
    def __init__(
        self,
        api_url: str,
        device_id: str,
        secret: str,
        *,
        timeout: float = 10,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._base = api_url.rstrip("/")
        self._prefix = urlsplit(self._base).path
        self.device_id = device_id
        self._secret = secret
        self._http = httpx.Client(
            timeout=timeout,
            transport=transport,
            headers={"user-agent": f"dinesense-vision/{__version__}"},
        )

    def close(self) -> None:
        self._http.close()

    def _request(self, method: str, path: str, body: bytes = b"", content_type: str | None = None) -> Any:
        headers = signed_headers(self.device_id, self._secret, method, self._prefix + path, body)
        if content_type:
            headers["content-type"] = content_type
        try:
            res = self._http.request(method, self._base + path, content=body or None, headers=headers)
        except httpx.HTTPError as e:
            raise EdgeApiError(0, f"{type(e).__name__}: {e}") from e
        if res.status_code >= 400:
            try:
                message = res.json()["error"]["message"]
            except (ValueError, KeyError, TypeError):
                message = res.text[:200]
            raise EdgeApiError(res.status_code, str(message))
        return res.json() if res.content else None

    def get_config(self) -> EdgeConfig:
        return EdgeConfig.model_validate(self._request("GET", "/edge/config"))

    def post_events(self, events: list[dict[str, Any]], sent_at: str) -> BatchResult:
        # Compact, stable JSON: the signature covers these exact bytes.
        body = json.dumps(
            {"deviceId": self.device_id, "sentAt": sent_at, "events": events}, separators=(",", ":")
        ).encode()
        data = self._request("POST", "/edge/events", body, "application/json")
        return BatchResult(
            accepted=list(data.get("accepted", [])),
            duplicates=list(data.get("duplicates", [])),
            rejected=list(data.get("rejected", [])),
            retry=list(data.get("retry", [])),
        )

    def post_snapshot(self, camera_id: str, jpeg: bytes) -> None:
        self._request("POST", f"/edge/cameras/{camera_id}/snapshot", jpeg, "image/jpeg")
