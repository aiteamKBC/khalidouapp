"""anchor the standard breaks to the prayer times

Revision ID: 20260923_000060
Revises: 20260923_000059

Converts the standard two breaks on employee work profiles and permanent
company break defaults into prayer-anchored breaks: the 30-minute midday break
starts at the Dhuhr adhan and the 15-minute afternoon break at the Asr adhan,
recalculated every day. Only breaks that match that pattern are converted
(30 min starting 11:00-14:59, 15 min starting 14:00-17:59); any other custom
break keeps its fixed times. One-day exceptions are left untouched.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260923_000060"
down_revision: Union[str, None] = "20260923_000059"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Fixed times restored on downgrade (the previous company default).
_DOWNGRADE_TIMES = {"dhuhr": ("13:00", "13:30"), "asr": ("16:45", "17:00")}


def _start_hour(rule: dict) -> int | None:
    try:
        return int(str(rule.get("start_time"))[:2])
    except (TypeError, ValueError):
        return None


def _anchor_rules(rules: list[dict]) -> list[dict] | None:
    changed = False
    used: set[str] = set()
    result = []
    for rule in rules:
        hour = _start_hour(rule)
        minutes = int(rule.get("minutes") or 0)
        anchor = None
        if rule.get("anchor") not in (None, "fixed") or hour is None:
            anchor = None
        elif minutes == 30 and 11 <= hour <= 14 and "dhuhr" not in used:
            anchor = "dhuhr"
        elif minutes == 15 and 14 <= hour <= 17 and "asr" not in used:
            anchor = "asr"
        if anchor:
            used.add(anchor)
            changed = True
            result.append(
                {
                    "name": rule.get("name") or "Break",
                    "minutes": minutes,
                    "paid": bool(rule.get("paid")),
                    "anchor": anchor,
                }
            )
        else:
            result.append(rule)
    return result if changed else None


def _fix_rules(rules: list[dict]) -> list[dict] | None:
    changed = False
    result = []
    for rule in rules:
        times = _DOWNGRADE_TIMES.get(rule.get("anchor"))
        if times:
            changed = True
            fixed = {key: value for key, value in rule.items() if key != "anchor"}
            fixed["start_time"], fixed["end_time"] = times
            result.append(fixed)
        else:
            result.append(rule)
    return result if changed else None


def _rewrite(convert) -> None:
    bind = op.get_bind()
    targets = (
        ("employee_work_profiles", ""),
        ("work_schedule_overrides", " AND permanent IS TRUE AND scope = 'company'"),
    )
    for table, condition in targets:
        rows = bind.execute(
            sa.text(f"SELECT id, break_rules FROM {table} WHERE break_rules IS NOT NULL{condition}")
        ).all()
        for row_id, rules in rows:
            if isinstance(rules, str):
                rules = json.loads(rules)
            if not isinstance(rules, list):
                continue
            converted = convert(rules)
            if converted is not None:
                bind.execute(
                    sa.text(f"UPDATE {table} SET break_rules = CAST(:rules AS JSON) WHERE id = :id"),
                    {"rules": json.dumps(converted), "id": row_id},
                )


def upgrade() -> None:
    _rewrite(_anchor_rules)


def downgrade() -> None:
    _rewrite(_fix_rules)
