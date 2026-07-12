from io import BytesIO

from PIL import Image

from app.services.screenshots import build_thumbnail


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
