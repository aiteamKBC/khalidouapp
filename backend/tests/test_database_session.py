from app.database import session


def test_pool_checkout_timeout_is_bounded() -> None:
    assert session._bound_pool_timeout(30) == 5
    assert session._bound_pool_timeout(3) == 3
    assert session._bound_pool_timeout(0) == 1


def test_database_connection_capacity_is_bounded() -> None:
    assert session._effective_pool_limits(10, 20) == (10, 2)
    assert session._effective_pool_limits(50, 50) == (10, 2)
    assert session._effective_pool_limits(4, 20) == (4, 8)
    assert session._effective_pool_limits(0, -1) == (1, 0)


def test_postgres_transactions_receive_an_idle_timeout() -> None:
    statements: list[str] = []

    class FakeConnection:
        def exec_driver_sql(self, statement: str) -> None:
            statements.append(statement)

    session._set_postgres_transaction_timeout(FakeConnection())

    assert statements == [
        "select set_config('idle_in_transaction_session_timeout', "
        "'60000ms', true), set_config('lock_timeout', '5000ms', true), "
        "set_config('statement_timeout', '30000ms', true)"
    ]
