from pathlib import Path
from uuid import uuid4

from app.core.config import settings


class LocalScreenshotStorage:
    """Store private screenshot files below the configured local root."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or settings.screenshot_storage_path).resolve()

    def _resolve_path(self, relative_path: str) -> Path:
        path = (self.root / relative_path).resolve()
        try:
            path.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("Storage path must remain inside the screenshot storage root.") from exc
        if path == self.root:
            raise ValueError("Storage path must identify a file below the screenshot storage root.")
        return path

    def save(self, relative_path: str, content: bytes) -> Path:
        path = self._resolve_path(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        try:
            temporary_path.write_bytes(content)
            temporary_path.replace(path)
        finally:
            temporary_path.unlink(missing_ok=True)
        return path

    def delete(self, relative_path: str) -> bool:
        path = self._resolve_path(relative_path)
        if not path.is_file():
            return False
        path.unlink()
        return True
