"""Seed the throwaway E2E database.

Runs against the local Docker Postgres only (the harness sets DATABASE_URL and
refuses anything else). Shifts are built around the moment the suite starts so
no test ever waits for a real clock time. Writes every id and credential the
fixtures need to the JSON file named by E2E_SEED_OUT.
"""

import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from os import environ
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.core.security import hash_password
from app.database.session import get_sessionmaker
from app.models import (
    AdminUser,
    Company,
    Employee,
    EmployeeWorkProfile,
    Team,
    TeamMember,
    TeamOwner,
    TrackingSettings,
)
from app.models.admin_permission_override import AdminPermissionOverride
from app.models.payroll import CompanyPayrollSettings, FinancialPolicyPeriod

TIMEZONE = "Africa/Cairo"
ADMIN_PASSWORD = "E2e-Admin-Password-1"
EMPLOYEE_PASSWORD = "E2e-Employee-Password-1"
ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]


def clock(value: datetime) -> time:
    return value.time().replace(second=0, microsecond=0)


def shift_around(now: datetime, minutes_ago: int) -> tuple[time, time]:
    """A same-day shift that started ``minutes_ago`` and runs well past the suite."""
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = max(midnight, now - timedelta(minutes=minutes_ago))
    end = min(midnight + timedelta(hours=23, minutes=59), now + timedelta(hours=6))
    return clock(start), clock(end)


def main() -> None:
    if "neon.tech" in settings.database_url or "127.0.0.1" not in settings.database_url:
        raise SystemExit("seed_e2e refuses to run against a non-local database.")

    now = datetime.now(ZoneInfo(TIMEZONE))
    session = get_sessionmaker()()
    try:
        company = Company(name="Khaliduo E2E", status="active")
        session.add(company)
        session.flush()

        session.add(
            TrackingSettings(
                company_id=company.id,
                screenshot_enabled=False,
                idle_threshold_minutes=1,
                offline_threshold_minutes=3,
            )
        )
        session.add(CompanyPayrollSettings(company_id=company.id, timezone=TIMEZONE))
        # Saved breaks / paid breaks / late allowance switched on since 1 January.
        session.add(FinancialPolicyPeriod(company_id=company.id, starts_on=date(now.year, 1, 1)))

        def admin(key: str, name: str, role: str, **extra) -> AdminUser:
            user = AdminUser(
                company_id=company.id,
                name=name,
                email=f"{key}@e2e.example.com",
                password_hash=hash_password(ADMIN_PASSWORD),
                role=role,
                status="active",
                **extra,
            )
            session.add(user)
            return user

        admins = {
            "super": admin("super", "Sara Super", "general_admin", is_super_admin=True),
            "hr": admin("hr", "Hana HR", "hr", data_scope="company"),
            "lead": admin("lead", "Laila Lead", "team_owner", data_scope="assigned_teams"),
            "custom": admin(
                "custom",
                "Cairo Custom",
                "general_admin",
                permission_mode="custom",
                data_scope="company",
            ),
        }
        session.flush()
        # Custom mode grants exactly the allowed overrides (no role baseline):
        # this admin may see people and timesheets, but not screenshots or audit.
        for key, allowed in (
            ("dashboard.view", True),
            ("people.view", True),
            ("timesheets.view", True),
            ("time_requests.view", True),
            ("screenshots.view", False),
            ("audit.view", False),
        ):
            session.add(
                AdminPermissionOverride(
                    company_id=company.id,
                    admin_user_id=admins["custom"].id,
                    permission_key=key,
                    allowed=allowed,
                )
            )

        teams = {
            "a": Team(company_id=company.id, name="Team Alpha", status="active"),
            "b": Team(company_id=company.id, name="Team Beta", status="active"),
        }
        session.add_all(teams.values())
        session.flush()
        session.add(TeamOwner(team_id=teams["a"].id, admin_user_id=admins["lead"].id))

        def employee(key: str, name: str, code: str, team: str, late_by: int) -> Employee:
            person = Employee(
                company_id=company.id,
                name=name,
                email=f"{key}@e2e.example.com",
                employee_code=code,
                job_title="Engineer",
                timezone=TIMEZONE,
                status="active",
                portal_password_hash=hash_password(EMPLOYEE_PASSWORD),
                start_date=date(now.year - 2, 1, 1),
            )
            session.add(person)
            session.flush()
            session.add(TeamMember(team_id=teams[team].id, employee_id=person.id, status="active"))
            shift_start, shift_end = shift_around(now, late_by)
            # A valid 30-minute placeholder break ending with the shift (the API
            # rejects breaks whose minutes do not match their start/end).
            lunch_start = (datetime.combine(now.date(), shift_end) - timedelta(minutes=30)).time()
            session.add(
                EmployeeWorkProfile(
                    company_id=company.id,
                    employee_id=person.id,
                    shift_start=shift_start,
                    shift_end=shift_end,
                    working_days=ALL_DAYS,
                    weekly_off_days=[],
                    required_daily_minutes=480,
                    # Placeholder break late in the shift; tests move it with the
                    # work-profile API when they need to be "inside" a break.
                    break_rules=[
                        {
                            "name": "Lunch",
                            "minutes": 30,
                            "paid": True,
                            "anchor": "fixed",
                            "start_time": lunch_start.strftime("%H:%M"),
                            "end_time": shift_end.strftime("%H:%M"),
                        }
                    ],
                    late_grace_minutes=0,
                    schedule_type="fixed",
                    weekly_early_leave_minutes=120,
                    salary_amount=Decimal("20000"),
                    salary_currency="EGP",
                    salary_type="monthly",
                    profile_completed_at=now,
                )
            )
            return person

        employees = {
            "day": employee("day", "Dina Day", "E2E-001", "a", 30),
            "late": employee("late", "Lamia Late", "E2E-002", "a", 25),
            "other": employee("other", "Omar Other", "E2E-003", "b", 30),
            "archive": employee("archive", "Adel Archive", "E2E-004", "a", 30),
        }
        session.commit()

        out = {
            "companyId": str(company.id),
            "timezone": TIMEZONE,
            "seededAt": now.isoformat(),
            "adminPassword": ADMIN_PASSWORD,
            "employeePassword": EMPLOYEE_PASSWORD,
            "admins": {k: {"id": str(v.id), "email": v.email, "name": v.name} for k, v in admins.items()},
            "teams": {k: {"id": str(v.id), "name": v.name} for k, v in teams.items()},
            "employees": {
                k: {"id": str(v.id), "email": v.email, "name": v.name, "code": v.employee_code}
                for k, v in employees.items()
            },
        }
        with open(environ["E2E_SEED_OUT"], "w", encoding="utf-8") as handle:
            json.dump(out, handle, indent=2)
        print(f"E2E seed complete: company {company.id}")
    finally:
        session.close()


if __name__ == "__main__":
    main()
