from os import environ

from sqlalchemy import select

from app.core.security import hash_password
from app.database.session import get_sessionmaker
from app.models import AdminUser, Company, Employee, TrackingSettings


def env(name: str, default: str | None = None) -> str:
    value = environ.get(name, default)
    if value is None or value == "":
        raise RuntimeError(f"{name} is required for seeding.")
    return value


def main() -> None:
    company_name = env("SEED_COMPANY_NAME")
    admin_name = env("SEED_ADMIN_NAME")
    admin_email = env("SEED_ADMIN_EMAIL").lower()
    admin_password = env("SEED_ADMIN_PASSWORD")
    employee_name = env("SEED_EMPLOYEE_NAME")
    employee_email = env("SEED_EMPLOYEE_EMAIL").lower()
    employee_password = env("SEED_EMPLOYEE_PASSWORD")

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
            has_super_admin = session.scalar(
                select(AdminUser.id).where(
                    AdminUser.company_id == company.id,
                    AdminUser.is_super_admin.is_(True),
                )
            )
            admin = AdminUser(
                company_id=company.id,
                name=admin_name,
                email=admin_email,
                password_hash=hash_password(admin_password),
                role="general_admin",
                is_super_admin=has_super_admin is None,
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
                job_title="Developer",
                timezone="Africa/Cairo",
                status="active",
                portal_password_hash=hash_password(employee_password),
            )
            session.add(employee)
            session.flush()
        elif not employee.portal_password_hash:
            employee.portal_password_hash = hash_password(employee_password)
            session.add(employee)

        session.commit()
        print("Seed complete.")
        print(f"Company ID: {company.id}")
        print(f"Admin email: {admin_email}")
        print(f"Employee email: {employee_email}")
    finally:
        session.close()


if __name__ == "__main__":
    main()
