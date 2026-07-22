from datetime import UTC, datetime, time
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.exceptions import ApiError
from app.database.base import Base
from app.models import (
    Company,
    Device,
    Employee,
    EmployeeWorkProfile,
    Screenshot,
    ScreenshotCaptureEvent,
    TrackingSettings,
)
from app.schemas.screenshot import ScreenshotInitiateRequest, ScreenshotSkipRequest
from app.services.screenshots import initiate_screenshot, record_screenshot_skip


@pytest.fixture()
def screenshot_context():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db: Session = sessionmaker(bind=engine, expire_on_commit=False)()
    company = Company(name="Screenshot Policy Company", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id,
        name="Screenshot Employee",
        email="screenshot@example.com",
        employee_code="SHOT-1",
        timezone="UTC",
        status="active",
    )
    db.add(employee)
    db.flush()
    db.add_all(
        [
            EmployeeWorkProfile(
                company_id=company.id,
                employee_id=employee.id,
                shift_start=time(9),
                shift_end=time(17),
                working_days=[0, 1, 2, 3, 4],
                break_rules=[],
            ),
            TrackingSettings(company_id=company.id, screenshot_enabled=True),
        ]
    )
    device = Device(
        company_id=company.id,
        employee_id=employee.id,
        device_name="Screenshot Device",
        installation_id="screenshot-device",
        operating_system="Windows 11",
        agent_version="1.0.0",
        status="active",
    )
    db.add(device)
    db.commit()
    try:
        yield db, device
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _payload(captured_at: datetime, power_source: str = "ac"):
    return ScreenshotInitiateRequest(
        screenshot_id=uuid4(),
        session_id=None,
        captured_at=captured_at,
        width=1920,
        height=1080,
        file_size=1000,
        mime_type="image/jpeg",
        checksum="a" * 64,
        display_count=1,
        power_source=power_source,
    )


def test_capture_does_not_require_timer_and_off_shift_is_categorized(screenshot_context):
    db, device = screenshot_context
    payload = _payload(datetime(2026, 7, 21, 20, 0, tzinfo=UTC))

    result = initiate_screenshot(db, device, payload)
    screenshot = db.get(Screenshot, payload.screenshot_id)

    assert result["duplicate"] is False
    assert screenshot is not None
    assert screenshot.session_id is None
    assert screenshot.project_id is None
    assert screenshot.task_id is None
    assert screenshot.work_category == "off_shift"
    assert screenshot.power_source == "ac"


def test_battery_capture_is_rejected_by_server(screenshot_context):
    db, device = screenshot_context
    with pytest.raises(ApiError, match="AC power"):
        initiate_screenshot(
            db,
            device,
            _payload(datetime(2026, 7, 21, 12, 0, tzinfo=UTC), "battery"),
        )


def test_skip_events_are_idempotent_and_auditable(screenshot_context):
    db, device = screenshot_context
    event_id = uuid4()
    payload = ScreenshotSkipRequest(
        event_id=event_id,
        occurred_at=datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
        reason="battery_power",
        power_source="battery",
        tracking_status="active",
    )

    first = record_screenshot_skip(db, device, payload)
    second = record_screenshot_skip(db, device, payload)

    assert first["duplicate"] is False
    assert second["duplicate"] is True
    assert (
        db.scalar(
            select(func.count())
            .select_from(ScreenshotCaptureEvent)
            .where(ScreenshotCaptureEvent.device_id == device.id)
        )
        == 1
    )
