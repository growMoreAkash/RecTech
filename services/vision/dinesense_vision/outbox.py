"""Durable SQLite outbox: events survive restarts and network outages and are replayed in order.

The API acknowledges each event as accepted, duplicate, rejected (all removed here) or retry (kept). Events older
than the API's acceptance window are dropped locally, since stale observations must not move tables.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

MAX_EVENT_AGE_SECONDS = 15 * 60  # mirrors EDGE_MAX_EVENT_AGE_SECONDS in packages/shared


class Outbox:
    def __init__(
        self, path: Path | str = ":memory:", max_rows: int = 50_000, clock: Callable[[], float] = time.time
    ) -> None:
        if isinstance(path, Path):
            path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS outbox (
                 seq INTEGER PRIMARY KEY AUTOINCREMENT,
                 event_id TEXT NOT NULL UNIQUE,
                 body TEXT NOT NULL,
                 created_at REAL NOT NULL,
                 attempts INTEGER NOT NULL DEFAULT 0,
                 next_at REAL NOT NULL DEFAULT 0)"""
        )
        self._lock = threading.Lock()
        self._max_rows = max_rows
        self._clock = clock

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def put(self, events: Iterable[dict[str, Any]]) -> None:
        rows = [(e["eventId"], json.dumps(e, separators=(",", ":")), self._clock()) for e in events]
        if not rows:
            return
        with self._lock:
            self._db.executemany("INSERT OR IGNORE INTO outbox(event_id, body, created_at) VALUES (?,?,?)", rows)
            # Bounded: if the API is unreachable for very long, the oldest events go first.
            self._db.execute("DELETE FROM outbox WHERE seq <= (SELECT MAX(seq) FROM outbox) - ?", (self._max_rows,))

    def depth(self) -> int:
        with self._lock:
            (n,) = self._db.execute("SELECT COUNT(*) FROM outbox").fetchone()
        return int(n)

    def due(self, limit: int = 100) -> list[dict[str, Any]]:
        now = self._clock()
        with self._lock:
            self._db.execute("DELETE FROM outbox WHERE created_at < ?", (now - MAX_EVENT_AGE_SECONDS,))
            rows = self._db.execute(
                "SELECT body FROM outbox WHERE next_at <= ? ORDER BY seq LIMIT ?", (now, limit)
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    def done(self, event_ids: Iterable[str]) -> None:
        with self._lock:
            self._db.executemany("DELETE FROM outbox WHERE event_id = ?", [(i,) for i in event_ids])

    def defer(self, event_ids: Iterable[str]) -> None:
        """Exponential backoff per event: 2, 4, 8 … 60 s."""
        now = self._clock()
        with self._lock:
            for i in event_ids:
                self._db.execute(
                    "UPDATE outbox SET attempts = attempts + 1, "
                    "next_at = ? + MIN(60, 1 << MIN(attempts + 1, 6)) WHERE event_id = ?",
                    (now, i),
                )
