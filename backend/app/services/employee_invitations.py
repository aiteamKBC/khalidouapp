import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_token
from app.models import Employee, EmployeeInvitation


def invitation_status(invitation: EmployeeInvitation, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    expires_at = invitation.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if invitation.accepted_at is not None:
        return "accepted"
    if invitation.revoked_at is not None:
        return "revoked"
    if expires_at <= now:
        return "expired"
    return "pending"


def serialize_employee_invitation(invitation: EmployeeInvitation) -> dict:
    status = invitation_status(invitation)
    return {
        "id": str(invitation.id),
        "status": status,
        "expires_at": invitation.expires_at.isoformat(),
        "accepted_at": (invitation.accepted_at.isoformat() if invitation.accepted_at else None),
        "revoked_at": invitation.revoked_at.isoformat() if invitation.revoked_at else None,
        "created_at": invitation.created_at.isoformat(),
    }


def issue_employee_invitation(
    db: Session,
    employee: Employee,
    *,
    revoke_existing: bool = True,
) -> tuple[EmployeeInvitation, str]:
    """Create an invite, optionally revoking outstanding links first."""
    now = datetime.now(UTC)
    if revoke_existing:
        db.execute(
            update(EmployeeInvitation)
            .where(
                EmployeeInvitation.employee_id == employee.id,
                EmployeeInvitation.accepted_at.is_(None),
                EmployeeInvitation.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
    raw_token = secrets.token_urlsafe(48)
    invitation = EmployeeInvitation(
        company_id=employee.company_id,
        employee_id=employee.id,
        token_hash=hash_token(raw_token),
        expires_at=now + timedelta(hours=settings.employee_invitation_expire_hours),
    )
    db.add(invitation)
    db.flush()
    return invitation, raw_token


def revoke_other_pending_invitations(db: Session, employee_id, *, keep_invitation_id) -> None:
    db.execute(
        update(EmployeeInvitation)
        .where(
            EmployeeInvitation.employee_id == employee_id,
            EmployeeInvitation.id != keep_invitation_id,
            EmployeeInvitation.accepted_at.is_(None),
            EmployeeInvitation.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )


def find_employee_invitation(
    db: Session, raw_token: str, *, for_update: bool = False
) -> EmployeeInvitation | None:
    statement = select(EmployeeInvitation).where(
        EmployeeInvitation.token_hash == hash_token(raw_token)
    )
    if for_update:
        statement = statement.with_for_update()
    return db.scalar(statement)


def latest_employee_invitations(
    db: Session,
    employee_ids: list,
) -> dict:
    if not employee_ids:
        return {}
    rows = db.scalars(
        select(EmployeeInvitation)
        .where(EmployeeInvitation.employee_id.in_(employee_ids))
        .order_by(EmployeeInvitation.created_at.desc())
    ).all()
    latest: dict = {}
    for row in rows:
        latest.setdefault(row.employee_id, row)
    return latest
