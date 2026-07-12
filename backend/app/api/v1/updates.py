from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.core.config import settings
from app.core.exceptions import ApiError


router = APIRouter(prefix="/updates", tags=["updates"])

WINDOWS_UPDATE_ARTIFACTS = {
    "latest.yml": "text/yaml; charset=utf-8",
    "KhaliduoSetup.exe": "application/vnd.microsoft.portable-executable",
    "KhaliduoSetup.exe.blockmap": "application/octet-stream",
}


@router.get("/windows/{artifact_name}")
def download_windows_update_artifact(artifact_name: str):
    media_type = WINDOWS_UPDATE_ARTIFACTS.get(artifact_name)
    if media_type is None:
        raise ApiError("UPDATE_ARTIFACT_NOT_FOUND", "The requested update file does not exist.", 404)

    update_directory = settings.desktop_update_directory.resolve()
    artifact_path: Path = update_directory / artifact_name
    if not artifact_path.is_file():
        raise ApiError("UPDATE_NOT_AVAILABLE", "A Khaliduo update is not available yet.", 404)

    cache_control = "no-store" if artifact_name == "latest.yml" else "public, max-age=86400, immutable"
    return FileResponse(
        artifact_path,
        media_type=media_type,
        headers={
            "Cache-Control": cache_control,
            "X-Content-Type-Options": "nosniff",
        },
    )
