from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.core.config import settings
from app.core.exceptions import ApiError


router = APIRouter(prefix="/downloads", tags=["downloads"])


@router.get("/windows")
def download_windows_installer():
    installer_path = settings.desktop_installer_path.resolve()
    if not installer_path.is_file():
        raise ApiError(
            "INSTALLER_NOT_AVAILABLE",
            "The Khaliduo Windows installer is not available yet.",
            503,
        )

    return FileResponse(
        installer_path,
        media_type="application/vnd.microsoft.portable-executable",
        filename="KhaliduoSetup.exe",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
