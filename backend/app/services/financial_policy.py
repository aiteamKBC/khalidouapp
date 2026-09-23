"""Effective-dated activation of the phase-1 financial policies.

The phase-1 milestone introduces three payable behaviors that change how much an
employee is paid:

* paid scheduled breaks counted inside the shift,
* the first minutes of lateness as a paid allowance,
* a same-day break bank (working through a scheduled break earns a delayed
  break that can be claimed against later eligible idle).

These are applied **prospectively**: a company sets a single effective date (in
its payroll timezone / the employee-local day) and the new accounting only
applies to work on or after that date. Earlier days — including any that feed a
frozen payroll run — are computed exactly as before. The date lives on
``CompanyPayrollSettings.financial_policy_effective_date``; ``None`` means the
new policies are inactive for that company.

This module is deliberately dependency-light (no import of attendance/payroll)
so both layers can gate behavior on it without a circular import.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.payroll import CompanyPayrollSettings

# The paid late allowance is capped at the first 15 eligible minutes of lateness.
LATE_ALLOWANCE_CAP_SECONDS = 15 * 60


def company_financial_policy_effective_date(db: Session, company_id: UUID) -> date | None:
    """Return the company's financial-policy effective date, memoized per request.

    Mirrors ``_company_tracking_settings``: cached on ``db.info`` so a payroll
    sheet that recomputes every employee's current day reads it at most once per
    company per request.
    """
    cache = db.info.setdefault("_financial_policy_effective_date_cache", {})
    if company_id not in cache:
        cache[company_id] = db.scalar(
            select(CompanyPayrollSettings.financial_policy_effective_date).where(
                CompanyPayrollSettings.company_id == company_id
            )
        )
    return cache[company_id]


def financial_policy_active(effective_date: date | None, work_date: date) -> bool:
    """Whether the new financial policies apply to ``work_date``.

    ``work_date`` is already the employee-local calendar day used throughout
    attendance, so the comparison is a plain local-date comparison.
    """
    return effective_date is not None and work_date >= effective_date
