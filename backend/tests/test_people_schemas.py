import pytest
from pydantic import ValidationError

from app.schemas.admin import PersonInvitationCreate


def invitation_payload(**overrides):
    return {
        "name": "Valid Employee",
        "email": "employee@example.com",
        "kind": "employee",
        "team_ids": [],
        **overrides,
    }


def test_person_invitation_rejects_blank_name() -> None:
    with pytest.raises(ValidationError):
        PersonInvitationCreate(**invitation_payload(name="   "))


def test_person_invitation_rejects_invalid_email() -> None:
    with pytest.raises(ValidationError):
        PersonInvitationCreate(**invitation_payload(email="not-an-email"))


def test_person_invitation_normalizes_name_whitespace() -> None:
    payload = PersonInvitationCreate(
        **invitation_payload(name="  Ahmed   Hassan  ")
    )

    assert payload.name == "Ahmed Hassan"
