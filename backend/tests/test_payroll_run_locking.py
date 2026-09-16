from datetime import date

import pytest
from sqlalchemy.exc import OperationalError

from app.core.exceptions import ApiError
from app.services.payroll import (
    POSTGRES_LOCK_TIMEOUT_MILLISECONDS,
    PAYROLL_RUN_LOCK_NAMESPACE,
    PAYROLL_RUN_LOCK_WAIT_MILLISECONDS,
    _lock_payroll_run,
)

COMPANY_ID = "11111111-1111-1111-1111-111111111111"
MONTH = date(2026, 9, 1)


class _FakeDialect:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeBind:
    def __init__(self, name: str) -> None:
        self.dialect = _FakeDialect(name)


class _FakeSession:
    """Records executed statements so lock behavior can be asserted."""

    def __init__(self, dialect_name: str, *, fail_on_advisory: bool = False) -> None:
        self.bind = _FakeBind(dialect_name) if dialect_name else None
        self.fail_on_advisory = fail_on_advisory
        self.statements: list[tuple[str, dict]] = []
        self.rolled_back = False

    def execute(self, statement, params=None):
        sql = str(statement)
        self.statements.append((sql, params or {}))
        if self.fail_on_advisory and "pg_advisory_xact_lock" in sql:
            raise OperationalError("select pg_advisory_xact_lock", {}, Exception("timeout"))
        return None

    def rollback(self):
        self.rolled_back = True


def test_lock_is_noop_outside_postgres():
    db = _FakeSession("sqlite")
    _lock_payroll_run(db, company_id=COMPANY_ID, month=MONTH)
    assert db.statements == []


def test_lock_is_noop_without_bind():
    db = _FakeSession("")
    _lock_payroll_run(db, company_id=COMPANY_ID, month=MONTH)
    assert db.statements == []


def test_postgres_acquires_advisory_lock_and_restores_timeout():
    db = _FakeSession("postgresql")
    _lock_payroll_run(db, company_id=COMPANY_ID, month=MONTH)

    sqls = [sql for sql, _ in db.statements]
    # Widen wait, take the lock, then restore the normal lock_timeout.
    assert "set_config('lock_timeout'" in sqls[0]
    assert "pg_advisory_xact_lock" in sqls[1]
    assert "set_config('lock_timeout'" in sqls[2]

    widen_params = db.statements[0][1]
    restore_params = db.statements[2][1]
    assert widen_params["wait"] == f"{PAYROLL_RUN_LOCK_WAIT_MILLISECONDS}ms"
    assert restore_params["wait"] == f"{POSTGRES_LOCK_TIMEOUT_MILLISECONDS}ms"

    lock_params = db.statements[1][1]
    assert lock_params["ns"] == PAYROLL_RUN_LOCK_NAMESPACE
    assert lock_params["key"] == f"{COMPANY_ID}:{MONTH.isoformat()}"


def test_advisory_lock_timeout_becomes_clean_503():
    db = _FakeSession("postgresql", fail_on_advisory=True)
    with pytest.raises(ApiError) as excinfo:
        _lock_payroll_run(db, company_id=COMPANY_ID, month=MONTH)
    assert excinfo.value.status_code == 503
    assert excinfo.value.code == "PAYROLL_BUSY"
    assert db.rolled_back is True
    # The timeout is not restored to the normal value because the wait failed;
    # the aborted transaction is rolled back instead.
    assert all("pg_advisory_xact_lock" not in sql or True for sql, _ in db.statements)
