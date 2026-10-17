"""return prayer-anchored breaks to fixed clock times

Revision ID: 20261017_000061
Revises: 20260923_000060

Breaks no longer follow the Dhuhr / Asr adhan. Every break anchored to a prayer
(employee work profiles and all schedule overrides) gets fixed times again:
the Dhuhr break starts at 13:00 and the Asr break at 16:45 (the company default
before the prayer change), each keeping its configured length. Admins edit them
on the Breaks page afterwards.
Downgrade is a no-op: which fixed breaks used to be anchored is not recorded.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261017_000061"
down_revision: Union[str, None] = "20260923_000060"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FIXED_STARTS = {"dhuhr": 13 * 60, "asr": 16 * 60 + 45}


def _clock(total_minutes: int) -> str:
    total_minutes = min(total_minutes, 23 * 60 + 59)
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def _fix_rules(rules: list[dict]) -> list[dict] | None:
    changed = False
    result = []
    for rule in rules:
        start = _FIXED_STARTS.get(rule.get("anchor")) if isinstance(rule, dict) else None
        if start is not None:
            changed = True
            minutes = int(rule.get("minutes") or 0) or (30 if rule["anchor"] == "dhuhr" else 15)
            fixed = {key: value for key, value in rule.items() if key != "anchor"}
            fixed["start_time"] = _clock(start)
            fixed["end_time"] = _clock(start + minutes)
            fixed["minutes"] = minutes
            result.append(fixed)
        else:
            result.append(rule)
    return result if changed else None


def upgrade() -> None:
    bind = op.get_bind()
    for table in ("employee_work_profiles", "work_schedule_overrides"):
        rows = bind.execute(
            sa.text(f"SELECT id, break_rules FROM {table} WHERE break_rules IS NOT NULL")
        ).all()
        for row_id, rules in rows:
            if isinstance(rules, str):
                rules = json.loads(rules)
            if not isinstance(rules, list):
                continue
            converted = _fix_rules(rules)
            if converted is not None:
                bind.execute(
                    sa.text(f"UPDATE {table} SET break_rules = CAST(:rules AS JSON) WHERE id = :id"),
                    {"rules": json.dumps(converted), "id": row_id},
                )


def downgrade() -> None:
    pass
