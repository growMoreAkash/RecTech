"""Frame sources: RTSP cameras (auto-reconnect) and, in dev mode, looping video files."""

from .base import FrameSource, open_source
from .file import FileSource, iter_video
from .rtsp import RtspSource

__all__ = ["FileSource", "FrameSource", "RtspSource", "iter_video", "open_source"]
