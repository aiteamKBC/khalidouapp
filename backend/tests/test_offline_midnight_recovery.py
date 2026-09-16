"""Bug 3 (backend side of the coordinated contract): when the desktop agent
recovers offline work that crossed midnight, it submits the recovery HEARTBEAT
bounded to the last instant of the previous local day (so the backend does not
take its rollover branch and discard the work), and the END at the exact day
boundary (next local midnight) so the integer wall-clock cap credits ALL of the
recorded seconds — a genuine 3600 stays 3600, not 3599.

The diagnostic reproducer (docs/desktop-audit-backend-repro.py) shows that a
next-day *heartbeat* makes the backend roll the session over and discard the
work. This regression proves the fixed client contract credits every recorded
second to the correct (previous) day.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.models import WorkSession
from app.schemas.session import HeartbeatRequest, SessionEndRequest, SessionStartRequest
from app.services.session_tracking import end_session, record_heartbeat, start_or_get_session

# Reuse the in-memory tracking fixture (employee timezone = UTC).
from tests.test_session_tracking import tracking_context  # noqa: F401


def _at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def test_previous_day_bounded_recovery_credits_the_prior_workday(tracking_context):
    db, device = tracking_context
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(
            started_at=_at("2026-09-09T23:00:00"),
            offline_recovery=True,
            offline_recovery_id=uuid4(),
        ),
    )
    session_id = UUID(started["session"]["id"])

    # The recovery heartbeat stays at the last instant of the session's own local
    # day (23:59:59.999) so the backend does NOT roll it over and discard it.
    result = record_heartbeat(
        db,
        device=device,
        session_id=session_id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=_at("2026-09-09T23:59:59.999000"),
            status="active",
            active_seconds=3600,
            idle_seconds=0,
            agent_version="test",
        ),
    )
    # The END is submitted at the exact day boundary (next local midnight).
    # end_session has no rollover branch, so this credits the full 3600 seconds
    # (elapsed 23:00:00 -> 24:00:00) rather than the 3599 a 23:59:59.999 end caps to.
    end_session(
        db,
        device=device,
        session_id=session_id,
        payload=SessionEndRequest(
            event_id=uuid4(),
            ended_at=_at("2026-09-10T00:00:00"),
            active_seconds=3600,
            idle_seconds=0,
            reason="Recovered from offline device storage",
        ),
    )

    original = db.get(WorkSession, session_id)
    # No rollover on the heartbeat, and EVERY recorded second is credited to the
    # session — which still belongs to 2026-09-09 (workday membership is keyed on
    # started_at, not ended_at).
    assert result.get("restarted") is not True
    assert original.active_seconds == 3600
    assert original.started_at.astimezone(UTC).date().isoformat() == "2026-09-09"
    assert original.ended_at is not None
