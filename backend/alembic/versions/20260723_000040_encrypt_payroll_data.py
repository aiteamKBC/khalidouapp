"""encrypt payroll data at rest

Revision ID: 20260723_000040
Revises: 20260723_000039
Create Date: 2026-07-23 00:00:40.000000
"""

import json
from collections.abc import Sequence
from decimal import Decimal

import sqlalchemy as sa
from alembic import op

revision: str = "20260723_000040"
down_revision: str | None = "20260723_000039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


DECIMAL_COLUMNS: dict[str, dict[str, int]] = {
    "employee_work_profiles": {"salary_amount": 2},
    "payroll_entries": {
        "salary_amount": 2,
        "hourly_rate": 4,
        "lateness_deduction_amount": 2,
        "idle_deduction_amount": 2,
        "custom_overtime_amount": 2,
        "unpaid_break_deduction_amount": 2,
        "bonus_amount": 2,
        "additional_deduction_amount": 2,
        "base_salary": 2,
        "overtime_amount": 2,
        "total_deductions": 2,
        "total_bonuses": 2,
        "final_salary": 2,
    },
    "payroll_adjustments": {"amount": 2},
}


def _rows(table: str, column: str):
    return op.get_bind().execute(sa.text(f'SELECT id, "{column}" FROM "{table}"')).all()


def _write(table: str, column: str, row_id, value: str) -> None:
    op.get_bind().execute(
        sa.text(f'UPDATE "{table}" SET "{column}" = :value WHERE id = :id'),
        {"value": value, "id": row_id},
    )


def upgrade() -> None:
    # Import lazily so metadata-only Alembic commands (heads/history/current)
    # do not bootstrap the whole application settings object. The production
    # encryption key is still validated before this migration mutates data.
    from app.core.field_encryption import encrypt_decimal, encrypt_json

    for table, columns in DECIMAL_COLUMNS.items():
        for column in columns:
            op.alter_column(table, column, server_default=None)
            op.alter_column(
                table,
                column,
                type_=sa.Text(),
                postgresql_using=f'"{column}"::text',
            )
            for row_id, raw_value in _rows(table, column):
                if raw_value is not None:
                    _write(table, column, row_id, encrypt_decimal(Decimal(str(raw_value))))

    op.alter_column(
        "payroll_entries",
        "calculation_snapshot",
        type_=sa.Text(),
        postgresql_using="calculation_snapshot::text",
    )
    for row_id, raw_value in _rows("payroll_entries", "calculation_snapshot"):
        if raw_value is not None:
            value = json.loads(raw_value) if isinstance(raw_value, str) else raw_value
            _write("payroll_entries", "calculation_snapshot", row_id, encrypt_json(value))


def downgrade() -> None:
    from app.core.field_encryption import decrypt_decimal, decrypt_json

    for row_id, raw_value in _rows("payroll_entries", "calculation_snapshot"):
        if raw_value is not None:
            _write(
                "payroll_entries",
                "calculation_snapshot",
                row_id,
                json.dumps(decrypt_json(raw_value)),
            )
    op.alter_column(
        "payroll_entries",
        "calculation_snapshot",
        type_=sa.JSON(),
        postgresql_using="calculation_snapshot::json",
    )

    for table, columns in DECIMAL_COLUMNS.items():
        for column, scale in columns.items():
            for row_id, raw_value in _rows(table, column):
                if raw_value is not None:
                    _write(table, column, row_id, format(decrypt_decimal(raw_value), "f"))
            op.alter_column(
                table,
                column,
                type_=sa.Numeric(14, scale),
                postgresql_using=f'"{column}"::numeric',
            )
