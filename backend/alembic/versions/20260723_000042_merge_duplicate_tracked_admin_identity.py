"""merge the duplicate tracked identity for the workspace owner

Revision ID: 20260723_000042
Revises: 20260723_000041
Create Date: 2026-07-23 00:00:42.000000

The owner account was linked to a newly-created Employee row while the
desktop device, sessions, screenshots, and attendance evidence remained on
the original Employee row. This guarded data repair keeps the linked row as
the canonical identity and moves all tracking evidence onto it.
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260723_000042"
down_revision: str | None = "20260723_000041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


CANONICAL_EMPLOYEE_ID = UUID("ed852d2e-531e-403f-b7e2-6f5c2425401f")
TRACKED_EMPLOYEE_ID = UUID("8b13ba7f-fd6c-46c6-985c-ec20fed19fca")


def _delete_conflicts_and_repoint(
    connection,
    table: str,
    conflict_columns: tuple[str, ...],
) -> None:
    matching = " AND ".join(f"canonical.{column} = tracked.{column}" for column in conflict_columns)
    connection.execute(
        sa.text(
            f"""
            DELETE FROM {table} AS canonical
            USING {table} AS tracked
            WHERE canonical.employee_id = :canonical_id
              AND tracked.employee_id = :tracked_id
              AND {matching}
            """
        ),
        {
            "canonical_id": CANONICAL_EMPLOYEE_ID,
            "tracked_id": TRACKED_EMPLOYEE_ID,
        },
    )
    connection.execute(
        sa.text(
            f"""
            UPDATE {table}
            SET employee_id = :canonical_id
            WHERE employee_id = :tracked_id
            """
        ),
        {
            "canonical_id": CANONICAL_EMPLOYEE_ID,
            "tracked_id": TRACKED_EMPLOYEE_ID,
        },
    )


def _repoint(connection, table: str, column: str = "employee_id") -> None:
    connection.execute(
        sa.text(
            f"""
            UPDATE {table}
            SET {column} = :canonical_id
            WHERE {column} = :tracked_id
            """
        ),
        {
            "canonical_id": CANONICAL_EMPLOYEE_ID,
            "tracked_id": TRACKED_EMPLOYEE_ID,
        },
    )


def upgrade() -> None:
    connection = op.get_bind()
    employees = connection.execute(
        sa.text(
            """
            SELECT id, company_id, name, email, job_title, timezone, status,
                   weekly_capacity_minutes, portal_password_hash,
                   portal_last_login_at, portal_last_login_ip,
                   portal_last_user_agent, avatar_url, start_date,
                   annual_leave_days
            FROM employees
            WHERE id IN (:canonical_id, :tracked_id)
            FOR UPDATE
            """
        ),
        {
            "canonical_id": CANONICAL_EMPLOYEE_ID,
            "tracked_id": TRACKED_EMPLOYEE_ID,
        },
    ).mappings()
    by_id = {row["id"]: row for row in employees}
    canonical = by_id.get(CANONICAL_EMPLOYEE_ID)
    tracked = by_id.get(TRACKED_EMPLOYEE_ID)

    # Fresh installations do not contain this production-only historical
    # duplicate, so the migration is intentionally a no-op there.
    if canonical is None and tracked is None:
        return
    if canonical is None or tracked is None:
        raise RuntimeError("Only one side of the duplicate employee identity exists.")
    if canonical["company_id"] != tracked["company_id"]:
        raise RuntimeError("Duplicate employee identities do not belong to the same company.")

    canonical_sessions = connection.execute(
        sa.text("SELECT count(*) FROM work_sessions WHERE employee_id = :employee_id"),
        {"employee_id": CANONICAL_EMPLOYEE_ID},
    ).scalar_one()
    tracked_sessions = connection.execute(
        sa.text("SELECT count(*) FROM work_sessions WHERE employee_id = :employee_id"),
        {"employee_id": TRACKED_EMPLOYEE_ID},
    ).scalar_one()
    linked_admins = connection.execute(
        sa.text(
            """
            SELECT
                count(*) FILTER (WHERE employee_id = :canonical_id) AS canonical_links,
                count(*) FILTER (WHERE employee_id = :tracked_id) AS tracked_links
            FROM admin_users
            WHERE employee_id IN (:canonical_id, :tracked_id)
            """
        ),
        {
            "canonical_id": CANONICAL_EMPLOYEE_ID,
            "tracked_id": TRACKED_EMPLOYEE_ID,
        },
    ).mappings().one()
    if (
        canonical_sessions != 0
        or tracked_sessions == 0
        or linked_admins["canonical_links"] != 1
        or linked_admins["tracked_links"] != 0
    ):
        raise RuntimeError("Duplicate employee identity no longer matches the safe merge guard.")

    # The linked profile already contains the admin-edited shift, break, salary,
    # and payroll configuration, so discard only the stale tracked profile.
    connection.execute(
        sa.text("DELETE FROM employee_work_profiles WHERE employee_id = :tracked_id"),
        {"tracked_id": TRACKED_EMPLOYEE_ID},
    )

    # Remove cached future rows. They are schedule placeholders rather than
    # attendance evidence and will be calculated when their day arrives.
    connection.execute(
        sa.text(
            """
            DELETE FROM daily_attendance
            WHERE employee_id IN (:canonical_id, :tracked_id)
              AND work_date > CURRENT_DATE
              AND actual_first_activity_at IS NULL
              AND approved_manual_seconds = 0
              AND recorded_overtime_seconds = 0
            """
        ),
        {
            "canonical_id": CANONICAL_EMPLOYEE_ID,
            "tracked_id": TRACKED_EMPLOYEE_ID,
        },
    )

    # Resolve natural-key conflicts first, then move all remaining records.
    for table, columns in (
        ("attendance_corrections", ("company_id", "work_date")),
        ("daily_attendance", ("company_id", "work_date")),
        ("leave_balances", ("year",)),
        ("pause_balances", ("work_date",)),
        ("payroll_entries", ("payroll_run_id",)),
        ("task_collaborators", ("task_id",)),
        ("team_members", ("team_id",)),
    ):
        _delete_conflicts_and_repoint(connection, table, columns)

    for table, column in (
        ("activity_events", "employee_id"),
        ("devices", "employee_id"),
        ("employee_invitations", "employee_id"),
        ("enrollment_codes", "employee_id"),
        ("leave_requests", "employee_id"),
        ("overtime_records", "employee_id"),
        ("pause_sessions", "employee_id"),
        ("screenshots", "employee_id"),
        ("screenshot_capture_events", "employee_id"),
        ("task_activities", "employee_id"),
        ("task_attachments", "uploader_employee_id"),
        ("task_checklist_items", "assignee_employee_id"),
        ("task_comments", "employee_id"),
        ("task_notifications", "employee_id"),
        ("task_workflow_requests", "requested_by_employee_id"),
        ("tasks", "assignee_employee_id"),
        ("tasks", "created_by_employee_id"),
        ("tasks", "blocked_by_employee_id"),
        ("time_adjustment_requests", "employee_id"),
        ("work_schedule_overrides", "employee_id"),
        ("work_sessions", "employee_id"),
    ):
        _repoint(connection, table, column)

    connection.execute(
        sa.text("DELETE FROM employees WHERE id = :tracked_id"),
        {"tracked_id": TRACKED_EMPLOYEE_ID},
    )
    connection.execute(
        sa.text(
            """
            UPDATE employees
            SET portal_last_login_at = GREATEST(portal_last_login_at, :portal_last_login_at),
                portal_last_login_ip = COALESCE(
                    :portal_last_login_ip,
                    portal_last_login_ip
                ),
                portal_last_user_agent = COALESCE(
                    :portal_last_user_agent,
                    portal_last_user_agent
                ),
                archived_at = NULL,
                status_before_archive = NULL
            WHERE id = :canonical_id
            """
        ),
        {
            "canonical_id": CANONICAL_EMPLOYEE_ID,
            "portal_last_login_at": tracked["portal_last_login_at"],
            "portal_last_login_ip": tracked["portal_last_login_ip"],
            "portal_last_user_agent": tracked["portal_last_user_agent"],
        },
    )


def downgrade() -> None:
    # Historical tracking evidence cannot be split back into two trustworthy
    # identities. Recreating the empty duplicate would reintroduce the defect.
    pass
