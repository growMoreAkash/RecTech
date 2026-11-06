from __future__ import annotations

from typing import Protocol
from urllib.parse import unquote, urlsplit

from ..detect.base import Frame


class FrameSource(Protocol):
    reconnects: int
    error: str | None

    def read(self) -> Frame | None:
        """The newest frame not returned before, or None if there is none yet."""
        ...

    def close(self) -> None: ...


def open_source(url: str, dev_mode: bool) -> FrameSource:
    from .file import FileSource
    from .rtsp import RtspSource

    if url.startswith("file://"):
        if not dev_mode:
            raise ValueError("file:// cameras are only allowed with DS_DEV_MODE=true")
        return FileSource(unquote(urlsplit(url).path), loop=True)
    return RtspSource(url)
