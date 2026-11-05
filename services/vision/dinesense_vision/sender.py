"""Moves events from the outbox to the API."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

from .api_client import EdgeApi, EdgeApiError
from .events import iso
from .outbox import Outbox

log = logging.getLogger(__name__)


class Sender:
    def __init__(self, api: EdgeApi, outbox: Outbox, clock: Callable[[], float] = time.time) -> None:
        self.api = api
        self.outbox = outbox
        self.clock = clock
        self.last_error: str | None = None

    def flush_once(self, limit: int = 100) -> int:
        """Sends one batch; returns how many events left the outbox."""
        events = self.outbox.due(limit)
        if not events:
            return 0
        ids = [e["eventId"] for e in events]
        try:
            result = self.api.post_events(events, iso(self.clock()))
        except EdgeApiError as e:
            self.last_error = str(e)
            # Never drop on a failed request: transient errors retry; a 4xx is logged loudly (bad credentials or
            # a contract bug) and retried with backoff until the operator fixes it or the events go stale.
            (log.warning if e.transient else log.error)("sending %d events failed: %s", len(ids), e)
            self.outbox.defer(ids)
            return 0
        self.last_error = None
        finished = result.accepted + result.duplicates + [r.get("eventId", "") for r in result.rejected]
        for r in result.rejected:
            log.info("event %s rejected by the API: %s", r.get("eventId"), r.get("reason"))
        self.outbox.done(finished)
        self.outbox.defer(result.retry)
        return len(finished)
