from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.services.employee_invitations import employee_onboarding_status


def accepted_invitation():
    now = datetime.now(UTC)
    return SimpleNamespace(
        accepted_at=now,
        revoked_at=None,
        expires_at=now + timedelta(days=1),
    )


def test_accepted_employee_is_app_pending_before_first_desktop_link():
    employee = SimpleNamespace(status="active")

    assert (
        employee_onboarding_status(
            employee,
            accepted_invitation(),
            desktop_app_linked=False,
        )
        == "app_pending"
    )


def test_accepted_employee_becomes_active_after_desktop_link():
    employee = SimpleNamespace(status="active")

    assert (
        employee_onboarding_status(
            employee,
            accepted_invitation(),
            desktop_app_linked=True,
        )
        == "active"
    )


def test_existing_active_employee_without_invitation_stays_active():
    employee = SimpleNamespace(status="active")

    assert (
        employee_onboarding_status(
            employee,
            None,
            desktop_app_linked=False,
        )
        == "active"
    )
