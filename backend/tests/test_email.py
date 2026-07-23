from app.services.email import _is_blocked_recipient
from app.services.email_templates import (
    employee_invitation_email,
    request_review_email,
)


def test_reserved_email_domains_are_always_blocked() -> None:
    assert _is_blocked_recipient("a@example.com") is True
    assert _is_blocked_recipient("worker@example.org") is True
    assert _is_blocked_recipient("person@company.test") is True


def test_authorized_real_email_is_not_reserved() -> None:
    assert _is_blocked_recipient("kkhaledaashraf16@gmail.com") is False


def test_invitation_email_is_branded_html_and_escapes_user_data(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.email_templates.settings.email_logo_url",
        "https://assets.example.co/khaliduo-logo.png",
    )
    content = employee_invitation_email(
        name="<Khaled>",
        to="person@company.co",
        invitation_url="https://app.company.co/invite?token=abc&next=1",
        expires_in_hours=24,
    )

    assert content.text
    assert "<!doctype html>" in content.html
    assert "#2f1f72" in content.html
    assert "#ef0f60" in content.html
    assert "https://assets.example.co/khaliduo-logo.png" in content.html
    assert "&lt;Khaled&gt;" in content.html
    assert "token=abc&amp;next=1" in content.html


def test_request_review_email_explains_first_reviewer_rule() -> None:
    content = request_review_email(
        recipient_name="Manager",
        employee_name="Employee",
        request_label="Annual leave request",
        team_names=["AI", "Design"],
        details=[("Working days", 2)],
        review_url="https://app.company.co/holiday-requests",
    )

    assert "AI, Design" in content.html
    assert "first authorized reviewer" in content.html
    assert "Open request centre" in content.html
    assert "notification only" in content.html
    assert "Approve or reject securely inside the dashboard" in content.html
