"""initial schema

Revision ID: 20260710_000001
Revises:
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260710_000001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False)


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "companies",
        uuid_pk(),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        *timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(op.f("ix_companies_name"), "companies", ["name"], unique=False)

    op.create_table(
        "admin_users",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        *timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "email", name="uq_admin_users_company_email"),
    )
    op.create_index(op.f("ix_admin_users_company_id"), "admin_users", ["company_id"], unique=False)
    op.create_index(op.f("ix_admin_users_email"), "admin_users", ["email"], unique=False)

    op.create_table(
        "employees",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("employee_code", sa.String(length=80), nullable=False),
        sa.Column("department", sa.String(length=255), nullable=True),
        sa.Column("timezone", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        *timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "email", name="uq_employees_company_email"),
        sa.UniqueConstraint("company_id", "employee_code", name="uq_employees_company_code"),
    )
    op.create_index(op.f("ix_employees_company_id"), "employees", ["company_id"], unique=False)
    op.create_index(op.f("ix_employees_email"), "employees", ["email"], unique=False)
    op.create_index(op.f("ix_employees_employee_code"), "employees", ["employee_code"], unique=False)

    op.create_table(
        "devices",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_name", sa.String(length=255), nullable=False),
        sa.Column("installation_id", sa.String(length=255), nullable=False),
        sa.Column("operating_system", sa.String(length=255), nullable=False),
        sa.Column("agent_version", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("registered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "installation_id", name="uq_devices_company_installation"),
    )
    op.create_index(op.f("ix_devices_company_id"), "devices", ["company_id"], unique=False)
    op.create_index(op.f("ix_devices_employee_id"), "devices", ["employee_id"], unique=False)

    op.create_table(
        "tracking_settings",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("screenshot_enabled", sa.Boolean(), nullable=False),
        sa.Column("screenshot_interval_minutes", sa.Integer(), nullable=False),
        sa.Column("idle_threshold_minutes", sa.Integer(), nullable=False),
        sa.Column("capture_during_idle", sa.Boolean(), nullable=False),
        sa.Column("offline_threshold_minutes", sa.Integer(), nullable=False),
        sa.Column("screenshot_retention_days", sa.Integer(), nullable=False),
        *timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", name="uq_tracking_settings_company"),
    )
    op.create_index(
        op.f("ix_tracking_settings_company_id"),
        "tracking_settings",
        ["company_id"],
        unique=False,
    )

    op.create_table(
        "work_sessions",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("active_seconds", sa.Integer(), nullable=False),
        sa.Column("idle_seconds", sa.Integer(), nullable=False),
        *timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_work_sessions_company_id"), "work_sessions", ["company_id"], unique=False)
    op.create_index(op.f("ix_work_sessions_device_id"), "work_sessions", ["device_id"], unique=False)
    op.create_index(op.f("ix_work_sessions_employee_id"), "work_sessions", ["employee_id"], unique=False)
    op.create_index(op.f("ix_work_sessions_started_at"), "work_sessions", ["started_at"], unique=False)
    op.create_index(op.f("ix_work_sessions_status"), "work_sessions", ["status"], unique=False)

    op.create_table(
        "activity_events",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("event_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["work_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "idempotency_key", name="uq_activity_events_idempotency"),
    )
    op.create_index(op.f("ix_activity_events_company_id"), "activity_events", ["company_id"], unique=False)
    op.create_index(op.f("ix_activity_events_device_id"), "activity_events", ["device_id"], unique=False)
    op.create_index(op.f("ix_activity_events_employee_id"), "activity_events", ["employee_id"], unique=False)
    op.create_index(op.f("ix_activity_events_event_timestamp"), "activity_events", ["event_timestamp"], unique=False)
    op.create_index(op.f("ix_activity_events_event_type"), "activity_events", ["event_type"], unique=False)
    op.create_index(op.f("ix_activity_events_session_id"), "activity_events", ["session_id"], unique=False)

    op.create_table(
        "screenshots",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("storage_path", sa.String(length=1024), nullable=False),
        sa.Column("thumbnail_path", sa.String(length=1024), nullable=True),
        sa.Column("mime_type", sa.String(length=80), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("checksum", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["work_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_screenshots_checksum"), "screenshots", ["checksum"], unique=False)
    op.create_index(op.f("ix_screenshots_company_id"), "screenshots", ["company_id"], unique=False)
    op.create_index(op.f("ix_screenshots_captured_at"), "screenshots", ["captured_at"], unique=False)
    op.create_index(op.f("ix_screenshots_device_id"), "screenshots", ["device_id"], unique=False)
    op.create_index(op.f("ix_screenshots_employee_id"), "screenshots", ["employee_id"], unique=False)
    op.create_index(op.f("ix_screenshots_session_id"), "screenshots", ["session_id"], unique=False)

    op.create_table(
        "enrollment_codes",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("code_hint", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_enrollment_codes_code_hash"), "enrollment_codes", ["code_hash"], unique=False)
    op.create_index(op.f("ix_enrollment_codes_company_id"), "enrollment_codes", ["company_id"], unique=False)
    op.create_index(op.f("ix_enrollment_codes_employee_id"), "enrollment_codes", ["employee_id"], unique=False)

    op.create_table(
        "admin_refresh_tokens",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("admin_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_admin_refresh_tokens_admin_user_id"), "admin_refresh_tokens", ["admin_user_id"], unique=False)
    op.create_index(op.f("ix_admin_refresh_tokens_company_id"), "admin_refresh_tokens", ["company_id"], unique=False)
    op.create_index(op.f("ix_admin_refresh_tokens_token_hash"), "admin_refresh_tokens", ["token_hash"], unique=False)

    op.create_table(
        "device_tokens",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_device_tokens_company_id"), "device_tokens", ["company_id"], unique=False)
    op.create_index(op.f("ix_device_tokens_device_id"), "device_tokens", ["device_id"], unique=False)
    op.create_index(op.f("ix_device_tokens_token_hash"), "device_tokens", ["token_hash"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_device_tokens_token_hash"), table_name="device_tokens")
    op.drop_index(op.f("ix_device_tokens_device_id"), table_name="device_tokens")
    op.drop_index(op.f("ix_device_tokens_company_id"), table_name="device_tokens")
    op.drop_table("device_tokens")
    op.drop_index(op.f("ix_admin_refresh_tokens_token_hash"), table_name="admin_refresh_tokens")
    op.drop_index(op.f("ix_admin_refresh_tokens_company_id"), table_name="admin_refresh_tokens")
    op.drop_index(op.f("ix_admin_refresh_tokens_admin_user_id"), table_name="admin_refresh_tokens")
    op.drop_table("admin_refresh_tokens")
    op.drop_index(op.f("ix_enrollment_codes_employee_id"), table_name="enrollment_codes")
    op.drop_index(op.f("ix_enrollment_codes_company_id"), table_name="enrollment_codes")
    op.drop_index(op.f("ix_enrollment_codes_code_hash"), table_name="enrollment_codes")
    op.drop_table("enrollment_codes")
    op.drop_index(op.f("ix_screenshots_session_id"), table_name="screenshots")
    op.drop_index(op.f("ix_screenshots_employee_id"), table_name="screenshots")
    op.drop_index(op.f("ix_screenshots_device_id"), table_name="screenshots")
    op.drop_index(op.f("ix_screenshots_captured_at"), table_name="screenshots")
    op.drop_index(op.f("ix_screenshots_company_id"), table_name="screenshots")
    op.drop_index(op.f("ix_screenshots_checksum"), table_name="screenshots")
    op.drop_table("screenshots")
    op.drop_index(op.f("ix_activity_events_session_id"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_event_type"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_event_timestamp"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_employee_id"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_device_id"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_company_id"), table_name="activity_events")
    op.drop_table("activity_events")
    op.drop_index(op.f("ix_work_sessions_status"), table_name="work_sessions")
    op.drop_index(op.f("ix_work_sessions_started_at"), table_name="work_sessions")
    op.drop_index(op.f("ix_work_sessions_employee_id"), table_name="work_sessions")
    op.drop_index(op.f("ix_work_sessions_device_id"), table_name="work_sessions")
    op.drop_index(op.f("ix_work_sessions_company_id"), table_name="work_sessions")
    op.drop_table("work_sessions")
    op.drop_index(op.f("ix_tracking_settings_company_id"), table_name="tracking_settings")
    op.drop_table("tracking_settings")
    op.drop_index(op.f("ix_devices_employee_id"), table_name="devices")
    op.drop_index(op.f("ix_devices_company_id"), table_name="devices")
    op.drop_table("devices")
    op.drop_index(op.f("ix_employees_employee_code"), table_name="employees")
    op.drop_index(op.f("ix_employees_email"), table_name="employees")
    op.drop_index(op.f("ix_employees_company_id"), table_name="employees")
    op.drop_table("employees")
    op.drop_index(op.f("ix_admin_users_email"), table_name="admin_users")
    op.drop_index(op.f("ix_admin_users_company_id"), table_name="admin_users")
    op.drop_table("admin_users")
    op.drop_index(op.f("ix_companies_name"), table_name="companies")
    op.drop_table("companies")
