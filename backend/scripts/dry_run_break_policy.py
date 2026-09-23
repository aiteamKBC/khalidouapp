"""Read-only dry run for the phase-1 financial-policy rollout.

Reports what activating the phase-1 financial policies (paid scheduled breaks,
paid late allowance, break bank) would change, WITHOUT writing anything:

* which companies have set ``financial_policy_effective_date`` (and which have
  not, so the new behavior is still inactive there);
* per employee-work-profile, whether the scheduled breaks are currently unpaid.
  An explicitly unpaid break is treated as an intentional override: it is
  PRESERVED and only flagged here for a human to review break-by-break. This
  tool never flips it to paid, so a deliberate unpaid break is never silently
  changed by the rollout. The configured break times and durations are kept.
* the combined idle effect (the 15-minute detection threshold plus the retained
  15-minute daily paid automatic-idle grace) so the owner can reconsider it.

No database writes, no attendance recomputation, no migrations. Run against a
copy/read replica for review before scheduling any prospective profile update.
"""

from __future__ import annotations

import argparse
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import get_sessionmaker
from app.models import Company, EmployeeWorkProfile
from app.models.payroll import CompanyPayrollSettings
from app.models.tracking_settings import TrackingSettings
from app.services.attendance import DAILY_PAID_IDLE_GRACE_SECONDS


def _break_summary(break_rules: list[dict] | None) -> dict[str, Any]:
    rules = break_rules or []
    unpaid = [r for r in rules if not r.get("paid")]
    return {
        "break_count": len(rules),
        "unpaid_break_names": [str(r.get("name") or "Break") for r in unpaid],
        "breaks": [
            {
                "name": str(r.get("name") or "Break"),
                "start_time": r.get("start_time"),
                "end_time": r.get("end_time"),
                "paid": bool(r.get("paid")),
            }
            for r in rules
        ],
    }


def dry_run(db: Session) -> dict[str, Any]:
    companies = {c.id: c for c in db.scalars(select(Company)).all()}
    effective_by_company = {
        row.company_id: row.financial_policy_effective_date
        for row in db.scalars(select(CompanyPayrollSettings)).all()
    }
    idle_threshold_by_company = {
        row.company_id: row.idle_threshold_minutes
        for row in db.scalars(select(TrackingSettings)).all()
    }

    company_reports: list[dict[str, Any]] = []
    profiles = db.scalars(select(EmployeeWorkProfile)).all()
    profiles_by_company: dict[Any, list[EmployeeWorkProfile]] = {}
    for profile in profiles:
        profiles_by_company.setdefault(profile.company_id, []).append(profile)

    total_profiles_needing_update = 0
    for company_id, company in companies.items():
        effective = effective_by_company.get(company_id)
        threshold = idle_threshold_by_company.get(company_id)
        company_profiles = profiles_by_company.get(company_id, [])
        needing_update = [
            {
                "employee_id": str(p.employee_id),
                **_break_summary(p.break_rules),
            }
            for p in company_profiles
            if any(not r.get("paid") for r in (p.break_rules or []))
        ]
        total_profiles_needing_update += len(needing_update)
        company_reports.append(
            {
                "company_id": str(company_id),
                "company_name": company.name,
                "financial_policy_effective_date": (
                    effective.isoformat() if effective else None
                ),
                "policy_active": effective is not None,
                "idle_detection_threshold_minutes": threshold,
                "daily_paid_idle_grace_minutes": DAILY_PAID_IDLE_GRACE_SECONDS // 60,
                "profiles_total": len(company_profiles),
                "profiles_with_unpaid_breaks": needing_update,
            }
        )

    return {
        "summary": {
            "companies": len(companies),
            "companies_with_effective_date": sum(
                1 for v in effective_by_company.values() if v is not None
            ),
            "profiles_with_unpaid_breaks": total_profiles_needing_update,
            "note": (
                "This dry run made no changes. Explicitly unpaid scheduled "
                "breaks are preserved and only flagged for review — the rollout "
                "never auto-flips them. Set financial_policy_effective_date per "
                "company, and flip any listed unpaid break to paid only if a "
                "reviewer decides it was not an intentional override; earlier "
                "days and frozen payroll are never recomputed."
            ),
        },
        "companies": company_reports,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pretty", action="store_true", help="Indent the JSON output.")
    args = parser.parse_args()
    session_factory = get_sessionmaker()
    with session_factory() as db:
        report = dry_run(db)
    print(json.dumps(report, indent=2 if args.pretty else None, default=str))


if __name__ == "__main__":
    main()
