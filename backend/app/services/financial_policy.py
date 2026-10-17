"""Switching the phase-1 financial policies on and off.

The phase-1 milestone introduces three payable behaviors that change how much an
employee is paid:

* paid scheduled breaks counted inside the shift,
* the first minutes of lateness as a paid allowance,
* a same-day break bank (working through a scheduled break saves those minutes,
  which automatically cover later idle time that day).

HR switches them on and off from the dashboard. Every on-stretch is stored as a
``FinancialPolicyPeriod`` covering employee-local days ``starts_on`` through
``ends_on`` (inclusive; open while still on). A day's accounting depends only on
whether it falls inside a period, so each period stands on its own:

* switching on applies from today; earlier days are never back-filled;
* switching off takes effect from tomorrow, so today and every earlier day of
  the period keep the minutes already covered; nothing is rolled back;
* switching on again later starts a new period (or reopens one that ended
  today or yesterday, since that leaves no off day in between).

This module is deliberately dependency-light (no import of attendance/payroll)
so both layers can gate behavior on it without a circular import.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.payroll import CompanyPayrollSettings, FinancialPolicyPeriod

# The paid late allowance is capped at the first 15 eligible minutes of lateness.
LATE_ALLOWANCE_CAP_SECONDS = 15 * 60

PolicyPeriods = tuple[tuple[date, date | None], ...]

_CACHE_KEY = "_financial_policy_periods_cache"


def company_financial_policy_periods(db: Session, company_id: UUID) -> PolicyPeriods:
    """Return the company's (starts_on, ends_on) periods, memoized per request.

    Mirrors ``_company_tracking_settings``: cached on ``db.info`` so a payroll
    sheet that recomputes every employee's current day reads it at most once per
    company per request.
    """
    cache = db.info.setdefault(_CACHE_KEY, {})
    if company_id not in cache:
        cache[company_id] = tuple(
            (row.starts_on, row.ends_on)
            for row in db.scalars(
                select(FinancialPolicyPeriod)
                .where(FinancialPolicyPeriod.company_id == company_id)
                .order_by(FinancialPolicyPeriod.starts_on)
            ).all()
        )
    return cache[company_id]


def financial_policy_active(periods: PolicyPeriods, work_date: date) -> bool:
    """Whether the financial policies apply to ``work_date``.

    ``work_date`` is already the employee-local calendar day used throughout
    attendance, so the comparison is a plain local-date comparison.
    """
    return any(
        starts_on <= work_date and (ends_on is None or work_date <= ends_on)
        for starts_on, ends_on in periods
    )


def company_today(db: Session, company_id: UUID, now: datetime | None = None) -> date:
    """Today's date in the company's payroll timezone."""
    zone_name = db.scalar(
        select(CompanyPayrollSettings.timezone).where(
            CompanyPayrollSettings.company_id == company_id
        )
    )
    try:
        zone = ZoneInfo(zone_name or "Africa/Cairo")
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("Africa/Cairo")
    return (now or datetime.now(UTC)).astimezone(zone).date()


def _open_period(db: Session, company_id: UUID) -> FinancialPolicyPeriod | None:
    return db.scalar(
        select(FinancialPolicyPeriod).where(
            FinancialPolicyPeriod.company_id == company_id,
            FinancialPolicyPeriod.ends_on.is_(None),
        )
    )


def financial_policy_status(db: Session, company_id: UUID) -> dict:
    periods = db.scalars(
        select(FinancialPolicyPeriod)
        .where(FinancialPolicyPeriod.company_id == company_id)
        .order_by(FinancialPolicyPeriod.starts_on.desc())
    ).all()
    current = next((row for row in periods if row.ends_on is None), None)
    return {
        "enabled": current is not None,
        "active_since": current.starts_on.isoformat() if current else None,
        "periods": [
            {
                "starts_on": row.starts_on.isoformat(),
                "ends_on": row.ends_on.isoformat() if row.ends_on else None,
            }
            for row in periods
        ],
    }


def set_financial_policy_enabled(
    db: Session,
    company_id: UUID,
    enabled: bool,
    *,
    admin_user_id: UUID | None,
    today: date,
) -> bool:
    """Switch the policies on (from today) or off (from tomorrow).

    Returns whether anything changed. Flushes but does not commit.
    """
    current = _open_period(db, company_id)
    if enabled:
        if current is not None:
            return False
        latest = db.scalar(
            select(FinancialPolicyPeriod)
            .where(FinancialPolicyPeriod.company_id == company_id)
            .order_by(FinancialPolicyPeriod.ends_on.desc())
            .limit(1)
        )
        if (
            latest is not None
            and latest.ends_on is not None
            and latest.ends_on >= today - timedelta(days=1)
        ):
            # No off day in between: carry on with the same period.
            latest.ends_on = None
            latest.ended_by_admin_user_id = None
        else:
            db.add(
                FinancialPolicyPeriod(
                    company_id=company_id,
                    starts_on=today,
                    started_by_admin_user_id=admin_user_id,
                )
            )
    else:
        if current is None:
            return False
        # Today stays covered: switching off never rolls back a day in progress.
        current.ends_on = max(today, current.starts_on)
        current.ended_by_admin_user_id = admin_user_id
    db.flush()
    db.info.get(_CACHE_KEY, {}).pop(company_id, None)
    return True
