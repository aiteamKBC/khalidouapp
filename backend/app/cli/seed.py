from datetime import UTC, datetime, timedelta
from os import environ
from secrets import token_urlsafe

from sqlalchemy import select

from app.core.security import hash_password
from app.database.session import get_sessionmaker
from app.models import AdminUser, Company, Employee, EnrollmentCode, TrackingSettings
from app.models.mixins import utc_now


def env(name: str, default: str | None = None) -> str:
    value = environ.get(name, default)
    if value is None or value == "":
        raise RuntimeError(f"{name} is required for seeding.")
    return value


def generate_enrollment_code() -> str:
    return "KH-" + token_urlsafe(9).replace("-", "").replace("_", "").upper()[:12]


def main() -> None:
    company_name = env("SEED_COMPANY_NAME")
    admin_name = env("SEED_ADMIN_NAME")
    admin_email = env("SEED_ADMIN_EMAIL").lower()
    admin_password = env("SEED_ADMIN_PASSWORD")
    employee_name = env("SEED_EMPLOYEE_NAME")
    employee_email = env("SEED_EMPLOYEE_EMAIL").lower()

    session = get_sessionmaker()()
    try:
        company = session.scalar(select(Company).where(Company.name == company_name))
        if company is None:
            company = Company(name=company_name, status="active")
            session.add(company)
            session.flush()

        settings = session.scalar(
            select(TrackingSettings).where(TrackingSettings.company_id == company.id)
        )
        if settings is None:
            settings = TrackingSettings(company_id=company.id)
            session.add(settings)

        admin = session.scalar(
            select(AdminUser).where(
                AdminUser.company_id == company.id,
                AdminUser.email == admin_email,
            )
        )
        if admin is None:
            admin = AdminUser(
                company_id=company.id,
                name=admin_name,
                email=admin_email,
                password_hash=hash_password(admin_password),
                role="general_admin",
                status="active",
            )
            session.add(admin)

        employee = session.scalar(
            select(Employee).where(
                Employee.company_id == company.id,
                Employee.email == employee_email,
            )
        )
        if employee is None:
            employee = Employee(
                company_id=company.id,
                name=employee_name,
                email=employee_email,
                employee_code="TEST-001",
                department="Development",
                timezone="Africa/Cairo",
                status="active",
            )
            session.add(employee)
            session.flush()

        enrollment_code = generate_enrollment_code()
        session.add(
            EnrollmentCode(
                company_id=company.id,
                employee_id=employee.id,
                code_hash=hash_password(enrollment_code),
                code_hint=f"{enrollment_code[:5]}...",
                status="active",
                expires_at=datetime.now(UTC) + timedelta(days=14),
                created_at=utc_now(),
            )
        )

        session.commit()
        print("Seed complete.")
        print(f"Company ID: {company.id}")
        print(f"Admin email: {admin_email}")
        print(f"Employee email: {employee_email}")
        print(f"Development enrollment code: {enrollment_code}")
    finally:
        session.close()


if __name__ == "__main__":
    main()
