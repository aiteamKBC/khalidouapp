from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def test_download_windows_installer(tmp_path: Path) -> None:
    installer = tmp_path / "KhaliduoSetup.exe"
    installer.write_bytes(b"local-installer-test")
    previous_path = settings.desktop_installer_path
    settings.desktop_installer_path = installer

    try:
        response = TestClient(app).get("/api/v1/downloads/windows")
    finally:
        settings.desktop_installer_path = previous_path

    assert response.status_code == 200
    assert response.content == b"local-installer-test"
    assert response.headers["content-disposition"] == 'attachment; filename="KhaliduoSetup.exe"'
    assert response.headers["x-content-type-options"] == "nosniff"


def test_download_windows_installer_when_missing(tmp_path: Path) -> None:
    previous_path = settings.desktop_installer_path
    settings.desktop_installer_path = tmp_path / "missing.exe"

    try:
        response = TestClient(app).get("/api/v1/downloads/windows")
    finally:
        settings.desktop_installer_path = previous_path

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "INSTALLER_NOT_AVAILABLE"


def test_windows_update_feed_and_artifact(tmp_path: Path) -> None:
    (tmp_path / "latest.yml").write_text("version: 1.1.0\n", encoding="utf-8")
    (tmp_path / "KhaliduoSetup.exe.blockmap").write_bytes(b"blockmap-test")
    previous_directory = settings.desktop_update_directory
    settings.desktop_update_directory = tmp_path

    try:
        client = TestClient(app)
        metadata_response = client.get("/api/v1/updates/windows/latest.yml")
        blockmap_response = client.get("/api/v1/updates/windows/KhaliduoSetup.exe.blockmap")
    finally:
        settings.desktop_update_directory = previous_directory

    assert metadata_response.status_code == 200
    assert metadata_response.text.strip() == "version: 1.1.0"
    assert metadata_response.headers["cache-control"] == "no-store, max-age=0"
    assert metadata_response.headers["pragma"] == "no-cache"
    assert blockmap_response.status_code == 200
    assert blockmap_response.content == b"blockmap-test"
    assert blockmap_response.headers["cache-control"] == "no-store, max-age=0"
    assert blockmap_response.headers["pragma"] == "no-cache"


def test_windows_update_feed_rejects_unknown_files(tmp_path: Path) -> None:
    previous_directory = settings.desktop_update_directory
    settings.desktop_update_directory = tmp_path

    try:
        response = TestClient(app).get("/api/v1/updates/windows/secrets.txt")
    finally:
        settings.desktop_update_directory = previous_directory

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "UPDATE_ARTIFACT_NOT_FOUND"
