import io
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api.v1 import agent, employee_portal, screenshots
from app.core.config import settings
from app.core.exceptions import ApiError


@pytest.mark.parametrize(
    ("endpoint", "lookup_name"),
    [
        (screenshots.get_screenshot_file, "get_accessible_screenshot_or_404"),
        (employee_portal.screenshot_file, "_employee_screenshot_or_404"),
    ],
)
def test_screenshot_file_endpoints_reject_storage_paths_outside_root(
    endpoint,
    lookup_name,
    monkeypatch,
    tmp_path,
):
    screenshot = SimpleNamespace(storage_path="../outside.jpg", mime_type="image/jpeg")
    module = screenshots if endpoint is screenshots.get_screenshot_file else employee_portal
    monkeypatch.setattr(module, lookup_name, lambda *_args: screenshot)
    monkeypatch.setattr(settings, "screenshot_storage_path", tmp_path)

    with pytest.raises(ApiError) as error:
        endpoint(uuid4(), SimpleNamespace(), SimpleNamespace())

    assert error.value.status_code == 404
    assert error.value.code == "SCREENSHOT_FILE_NOT_FOUND"


def test_agent_screenshot_upload_reads_at_most_configured_limit_plus_one(
    monkeypatch,
):
    monkeypatch.setattr(settings, "screenshot_max_file_size_mb", 1)
    observed: dict[str, int] = {}

    class BoundedUpload:
        content_type = "image/jpeg"

        class BoundedFile(io.BytesIO):
            def read(self, size: int = -1) -> bytes:
                observed["read_size"] = size
                return b"x" * size

        file = BoundedFile()

    def fake_upload(*_args, **kwargs):
        observed["content_size"] = len(kwargs["content"])
        return {"accepted": True}

    monkeypatch.setattr(agent, "upload_screenshot_content", fake_upload)
    result = agent.screenshot_upload(
        uuid4(),
        BoundedUpload(),
        SimpleNamespace(device=SimpleNamespace()),
        SimpleNamespace(),
    )

    expected_size = 1024 * 1024 + 1
    assert observed == {"read_size": expected_size, "content_size": expected_size}
    assert result["data"] == {"accepted": True}
