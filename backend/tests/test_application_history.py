from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from app.api.v1.activity import build_application_history
from app.models import ActivityEvent


def activity_event(
    *,
    started_at: datetime,
    application_name: str,
    process_name: str,
    duration_seconds: int,
    site_domain: str | None = None,
) -> ActivityEvent:
    return ActivityEvent(
        id=uuid4(),
        company_id=uuid4(),
        employee_id=uuid4(),
        device_id=uuid4(),
        session_id=uuid4(),
        event_type="foreground_activity",
        event_timestamp=started_at,
        idempotency_key=str(uuid4()),
        payload={
            "application_name": application_name,
            "process_name": process_name,
            "site_domain": site_domain,
            "ended_at": (started_at + timedelta(seconds=duration_seconds)).isoformat(),
            "duration_seconds": duration_seconds,
        },
    )


def test_application_history_merges_adjacent_segments_and_summarizes_domains():
    first = activity_event(
        started_at=datetime(2026, 7, 26, 10, 0, tzinfo=UTC),
        application_name="Google Chrome",
        process_name="chrome",
        site_domain="www.example.com",
        duration_seconds=60,
    )
    second = activity_event(
        started_at=datetime(2026, 7, 26, 10, 1, tzinfo=UTC),
        application_name="Google Chrome",
        process_name="chrome",
        site_domain="example.com",
        duration_seconds=60,
    )
    third = activity_event(
        started_at=datetime(2026, 7, 26, 10, 2, tzinfo=UTC),
        application_name="Visual Studio Code",
        process_name="code",
        duration_seconds=30,
    )

    result = build_application_history(
        [first, second, third],
        selected_day=date(2026, 7, 26),
        timezone_name="UTC",
    )

    assert result["total_seconds"] == 150
    assert result["application_count"] == 2
    assert result["website_count"] == 1
    assert result["applications"][0] == {
        "name": "Google Chrome",
        "duration_seconds": 120,
    }
    assert result["websites"] == [{"domain": "example.com", "duration_seconds": 120}]
    assert len(result["items"]) == 2
    assert result["items"][1]["application_name"] == "Google Chrome"
    assert result["items"][1]["duration_seconds"] == 120


def test_application_history_rejects_full_urls_in_domain_field():
    event = activity_event(
        started_at=datetime(2026, 7, 26, 12, 0, tzinfo=UTC),
        application_name="Google Chrome",
        process_name="chrome",
        site_domain="https://example.com/private?token=secret",
        duration_seconds=30,
    )

    result = build_application_history(
        [event],
        selected_day=date(2026, 7, 26),
        timezone_name="UTC",
    )

    assert result["website_count"] == 0
    assert result["websites"] == []
    assert result["items"][0]["site_domain"] is None
