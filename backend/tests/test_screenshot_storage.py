from io import BytesIO

import pytest

from PIL import Image

from app.services.screenshots import build_thumbnail
from app.storage.local import LocalScreenshotStorage


def test_build_thumbnail_creates_small_jpeg_preview():
    source = BytesIO()
    Image.new("RGB", (1920, 1080), color=(30, 60, 90)).save(source, format="JPEG", quality=90)

    result = build_thumbnail(source.getvalue(), "company/employee/shot.jpg")

    assert result is not None
    path, content = result
    assert path == "company/employee/shot.thumb.jpg"
    assert len(content) < len(source.getvalue())
    with Image.open(BytesIO(content)) as preview:
        assert preview.format == "JPEG"
        assert preview.width <= 480
        assert preview.height <= 480


def test_build_thumbnail_rejects_invalid_image_content():
    assert build_thumbnail(b"not-an-image", "company/employee/shot.jpg") is None


def test_local_screenshot_storage_saves_and_deletes_private_file(tmp_path):
    storage = LocalScreenshotStorage(tmp_path)

    saved_path = storage.save("company/employee/shot.jpg", b"screenshot-content")

    assert saved_path == (tmp_path / "company/employee/shot.jpg").resolve()
    assert saved_path.read_bytes() == b"screenshot-content"
    assert storage.delete("company/employee/shot.jpg") is True
    assert saved_path.exists() is False
    assert storage.delete("company/employee/shot.jpg") is False


@pytest.mark.parametrize("relative_path", ["../outside.jpg", "company/../../outside.jpg"])
def test_local_screenshot_storage_rejects_paths_outside_root(tmp_path, relative_path):
    storage = LocalScreenshotStorage(tmp_path)

    with pytest.raises(ValueError, match="inside the screenshot storage root"):
        storage.save(relative_path, b"not-allowed")
    with pytest.raises(ValueError, match="inside the screenshot storage root"):
        storage.delete(relative_path)
