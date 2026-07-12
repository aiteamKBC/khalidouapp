from app.database.base import Base
from app import models  # noqa: F401


def test_initial_schema_tables_are_registered() -> None:
    expected_tables = {
        "companies",
        "admin_users",
        "employees",
        "devices",
        "work_sessions",
        "activity_events",
        "screenshots",
        "tracking_settings",
        "enrollment_codes",
        "projects",
        "tasks",
        "task_workflow_requests",
        "admin_refresh_tokens",
        "admin_password_reset_tokens",
        "device_tokens",
        "teams",
        "team_members",
        "team_owners",
    }

    assert expected_tables.issubset(set(Base.metadata.tables))
    assert "requires_review" not in Base.metadata.tables["tasks"].c
    pending_indexes = {
        index.name: index for index in Base.metadata.tables["task_workflow_requests"].indexes
    }
    assert pending_indexes["uq_task_workflow_requests_pending_task"].unique is True
