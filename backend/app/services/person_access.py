from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import (
    AdminPasswordResetToken,
    AdminRefreshToken,
    AdminUser,
    Device,
    DeviceToken,
    Employee,
    EmployeeInvitation,
    EnrollmentCode,
    TeamMember,
    WorkSession,
)


def sync_linked_employee_password(admin: AdminUser) -> None:
    if admin.employee is not None:
        admin.employee.portal_password_hash = admin.password_hash


def ensure_tracked_employee(db: Session, admin: AdminUser) -> Employee:
    employee = db.get(Employee, admin.employee_id) if admin.employee_id else None
    if employee is None:
        employee = db.scalar(
            select(Employee).where(
                Employee.company_id == admin.company_id,
                Employee.email == admin.email.lower(),
            )
        )
    if employee is not None:
        linked_elsewhere = db.scalar(
            select(AdminUser.id).where(
                AdminUser.employee_id == employee.id,
                AdminUser.id != admin.id,
            )
        )
        if linked_elsewhere is not None:
            raise ApiError(
                "EMPLOYEE_ALREADY_LINKED",
                "This employee identity is already linked to another admin account.",
                409,
            )
    else:
        employee = Employee(
            company_id=admin.company_id,
            name=admin.name,
            email=admin.email.lower(),
            employee_code=f"EMP-{uuid4().hex[:8].upper()}",
            job_title="Management",
            timezone="UTC",
            status="active",
        )
        db.add(employee)
        db.flush()

    employee.name = admin.name
    employee.email = admin.email.lower()
    employee.portal_password_hash = admin.password_hash
    employee.status = "active"
    employee.archived_at = None
    employee.status_before_archive = None
    admin.employee_id = employee.id
    db.add_all([admin, employee])
    return employee


def ensure_employee_team_memberships(
    db: Session,
    employee: Employee,
    team_ids: list[UUID],
) -> None:
    for team_id in team_ids:
        membership = db.scalar(
            select(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.employee_id == employee.id,
            )
        )
        if membership is None:
            db.add(
                TeamMember(
                    team_id=team_id,
                    employee_id=employee.id,
                    status="active",
                )
            )
        else:
            membership.status = "active"
            db.add(membership)


def revoke_employee_runtime(db: Session, employee: Employee, now: datetime | None = None) -> None:
    now = now or datetime.now(UTC)
    device_ids = select(Device.id).where(Device.employee_id == employee.id)
    db.execute(
        update(Device)
        .where(Device.employee_id == employee.id)
        .values(status="revoked", revoked_at=now)
    )
    db.execute(
        update(DeviceToken)
        .where(DeviceToken.device_id.in_(device_ids), DeviceToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.execute(
        update(EmployeeInvitation)
        .where(
            EmployeeInvitation.employee_id == employee.id,
            EmployeeInvitation.accepted_at.is_(None),
            EmployeeInvitation.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    db.execute(
        update(EnrollmentCode)
        .where(
            EnrollmentCode.employee_id == employee.id,
            EnrollmentCode.status == "active",
        )
        .values(status="revoked")
    )
    db.execute(
        update(WorkSession)
        .where(
            WorkSession.employee_id == employee.id,
            WorkSession.ended_at.is_(None),
        )
        .values(status="ended", ended_at=now)
    )


def disable_employee_tracking(db: Session, employee: Employee) -> None:
    if employee.status != "archived":
        employee.status = "inactive"
    revoke_employee_runtime(db, employee)
    db.add(employee)


def archive_admin_identity(db: Session, admin: AdminUser, now: datetime) -> None:
    if admin.status != "archived":
        admin.status_before_archive = admin.status
    admin.status = "archived"
    admin.archived_at = now
    db.execute(
        update(AdminRefreshToken)
        .where(
            AdminRefreshToken.admin_user_id == admin.id,
            AdminRefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    db.execute(
        update(AdminPasswordResetToken)
        .where(
            AdminPasswordResetToken.admin_user_id == admin.id,
            AdminPasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    db.add(admin)


def archive_employee_identity(db: Session, employee: Employee, now: datetime) -> None:
    if employee.status != "archived":
        employee.status_before_archive = employee.status
    employee.status = "archived"
    employee.archived_at = now
    revoke_employee_runtime(db, employee, now)
    db.add(employee)


def archive_linked_person(
    db: Session,
    admin: AdminUser | None,
    employee: Employee | None,
) -> None:
    now = datetime.now(UTC)
    if admin is not None:
        archive_admin_identity(db, admin, now)
    if employee is not None:
        archive_employee_identity(db, employee, now)


def restore_linked_person(
    db: Session,
    admin: AdminUser | None,
    employee: Employee | None,
) -> None:
    if admin is not None and admin.status == "archived":
        admin.status = admin.status_before_archive or "active"
        admin.status_before_archive = None
        admin.archived_at = None
        db.add(admin)
    if employee is not None and employee.status == "archived":
        employee.status = employee.status_before_archive or "active"
        employee.status_before_archive = None
        employee.archived_at = None
        db.add(employee)


def person_state(admin: AdminUser | None, employee: Employee | None, person_type: str) -> dict:
    return {
        "person_type": person_type,
        "admin_user_id": str(admin.id) if admin else None,
        "employee_id": str(employee.id) if employee else None,
        "archived": bool(
            (admin is not None and admin.status == "archived")
            or (employee is not None and employee.status == "archived")
        ),
        "admin_status": admin.status if admin else None,
        "employee_status": employee.status if employee else None,
    }
