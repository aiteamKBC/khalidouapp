from app.services.email import _is_blocked_recipient


def test_reserved_email_domains_are_always_blocked() -> None:
    assert _is_blocked_recipient("a@example.com") is True
    assert _is_blocked_recipient("worker@example.org") is True
    assert _is_blocked_recipient("person@company.test") is True


def test_authorized_real_email_is_not_reserved() -> None:
    assert _is_blocked_recipient("kkhaledaashraf16@gmail.com") is False
