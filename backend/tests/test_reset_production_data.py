from scripts import reset_production_data


def test_pg_dump_uses_direct_neon_endpoint(monkeypatch):
    monkeypatch.setattr(
        reset_production_data.settings,
        "database_url",
        (
            "postgresql://user:password@"
            "ep-example-pooler.c-4.us-east-1.aws.neon.tech/neondb"
            "?sslmode=require&channel_binding=require"
        ),
    )

    database_url = reset_production_data._pg_dump_database_url()

    assert database_url.host == "ep-example.c-4.us-east-1.aws.neon.tech"
    assert database_url.query["sslmode"] == "require"
    assert database_url.query["channel_binding"] == "require"


def test_pg_dump_leaves_non_neon_endpoint_unchanged(monkeypatch):
    monkeypatch.setattr(
        reset_production_data.settings,
        "database_url",
        "postgresql://user:password@database.internal/app",
    )

    database_url = reset_production_data._pg_dump_database_url()

    assert database_url.host == "database.internal"
