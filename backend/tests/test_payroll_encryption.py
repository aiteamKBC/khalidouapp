from decimal import Decimal

import pytest
import sqlalchemy as sa

from app.core.field_encryption import PREFIX, decrypt_text, encrypt_text
from app.database.encrypted_types import EncryptedDecimal, EncryptedJSON
from app.services.audit import redact_financial_audit_details


def test_authenticated_encryption_round_trip_and_tamper_detection():
    encrypted = encrypt_text("15000.00")

    assert encrypted.startswith(PREFIX)
    assert "15000.00" not in encrypted
    assert decrypt_text(encrypted) == "15000.00"

    replacement = "A" if encrypted[-1] != "A" else "B"
    with pytest.raises(RuntimeError, match="could not be decrypted"):
        decrypt_text(encrypted[:-1] + replacement)


def test_encrypted_sqlalchemy_types_never_store_plain_payroll_values():
    metadata = sa.MetaData()
    records = sa.Table(
        "encrypted_payroll_test",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("salary", EncryptedDecimal(), nullable=False),
        sa.Column("snapshot", EncryptedJSON(), nullable=False),
    )
    engine = sa.create_engine("sqlite:///:memory:")
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            records.insert().values(
                id=1,
                salary=Decimal("15000.25"),
                snapshot={"final_salary": 15000.25, "currency": "EGP"},
            )
        )
        raw_salary, raw_snapshot = connection.exec_driver_sql(
            "SELECT salary, snapshot FROM encrypted_payroll_test WHERE id = 1"
        ).one()
        salary, snapshot = connection.execute(
            sa.select(records.c.salary, records.c.snapshot).where(records.c.id == 1)
        ).one()

    assert raw_salary.startswith(PREFIX)
    assert raw_snapshot.startswith(PREFIX)
    assert "15000" not in raw_salary
    assert "15000" not in raw_snapshot
    assert salary == Decimal("15000.25")
    assert snapshot == {"currency": "EGP", "final_salary": 15000.25}


def test_financial_audit_details_keep_context_without_compensation_values():
    details = {
        "old": {"salary_amount": "15000.25", "currency": "EGP"},
        "new": {
            "hourly_rate": "62.50",
            "bonus_amount": "500",
            "status": "approved",
        },
    }

    redacted = redact_financial_audit_details(details)

    assert "15000.25" not in str(redacted)
    assert "62.50" not in str(redacted)
    assert "500" not in str(redacted)
    assert redacted["old"]["currency"] == "EGP"
    assert redacted["new"]["status"] == "approved"
    assert redacted["old"]["salary_amount"] == "[REDACTED_FINANCIAL_VALUE]"
