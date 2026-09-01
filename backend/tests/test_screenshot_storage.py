from io import BytesIO

import pytest

from PIL import Image

from app.core.exceptions import ApiError
from app.services.screenshots import (
    build_thumbnail,
    validate_screenshot_dimensions,
    validate_screenshot_image,
)
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


def test_screenshot_image_validation_accepts_matching_jpeg():
    source = BytesIO()
    Image.new("RGB", (1280, 720), color=(30, 60, 90)).save(source, format="JPEG")

    validate_screenshot_image(
        source.getvalue(),
        expected_mime_type="image/jpeg",
        expected_width=1280,
        expected_height=720,
    )


@pytest.mark.parametrize(
    ("content", "mime_type", "width", "height", "code"),
    [
        (b"not-an-image", "image/jpeg", 1280, 720, "INVALID_SCREENSHOT_IMAGE"),
        (None, "image/webp", 1280, 720, "SCREENSHOT_MIME_MISMATCH"),
        (None, "image/jpeg", 1920, 1080, "SCREENSHOT_DIMENSION_MISMATCH"),
    ],
)
def test_screenshot_image_validation_rejects_invalid_or_mismatched_content(
    content,
    mime_type,
    width,
    height,
    code,
):
    if content is None:
        source = BytesIO()
        Image.new("RGB", (1280, 720), color=(30, 60, 90)).save(source, format="JPEG")
        content = source.getvalue()

    with pytest.raises(ApiError) as error:
        validate_screenshot_image(
            content,
            expected_mime_type=mime_type,
            expected_width=width,
            expected_height=height,
        )

    assert error.value.code == code


def test_screenshot_dimensions_reject_decompression_bomb_sized_metadata(monkeypatch):
    monkeypatch.setattr("app.services.screenshots.settings.screenshot_max_pixels", 1_000_000)

    with pytest.raises(ApiError) as error:
        validate_screenshot_dimensions(2000, 2000)

    assert error.value.status_code == 413
    assert error.value.code == "SCREENSHOT_DIMENSIONS_TOO_LARGE"


def test_local_screenshot_storage_saves_and_deletes_private_file(tmp_path):
    storage = LocalScreenshotStorage(tmp_path)

    saved_path = storage.save("company/employee/shot.jpg", b"screenshot-content")

    assert saved_path == (tmp_path / "company/employee/shot.jpg").resolve()
    assert storage.resolve("company/employee/shot.jpg") == saved_path
    assert saved_path.read_bytes() == b"screenshot-content"
    assert storage.delete("company/employee/shot.jpg") is True
    assert saved_path.exists() is False
    assert storage.delete("company/employee/shot.jpg") is False


@pytest.mark.parametrize("relative_path", ["../outside.jpg", "company/../../outside.jpg"])
def test_local_screenshot_storage_rejects_paths_outside_root(tmp_path, relative_path):
    storage = LocalScreenshotStorage(tmp_path)

    with pytest.raises(ValueError, match="inside the screenshot storage root"):
        storage.resolve(relative_path)
    with pytest.raises(ValueError, match="inside the screenshot storage root"):
        storage.save(relative_path, b"not-allowed")
    with pytest.raises(ValueError, match="inside the screenshot storage root"):
        storage.delete(relative_path)
