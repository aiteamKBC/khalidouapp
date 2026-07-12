"""add projects and tasks

Revision ID: 20260710_000007
Revises: 20260710_000006
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260710_000007"
down_revision: str | None = "20260710_000006"
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
        "projects",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        *timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "team_id", "name", name="uq_projects_team_name"),
    )
    op.create_index(op.f("ix_projects_company_id"), "projects", ["company_id"], unique=False)
    op.create_index(op.f("ix_projects_status"), "projects", ["status"], unique=False)
    op.create_index(op.f("ix_projects_team_id"), "projects", ["team_id"], unique=False)

    op.create_table(
        "tasks",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        *timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "project_id", "name", name="uq_tasks_project_name"),
    )
    op.create_index(op.f("ix_tasks_company_id"), "tasks", ["company_id"], unique=False)
    op.create_index(op.f("ix_tasks_project_id"), "tasks", ["project_id"], unique=False)
    op.create_index(op.f("ix_tasks_status"), "tasks", ["status"], unique=False)

    for table_name in ("work_sessions", "screenshots"):
        op.add_column(table_name, sa.Column("team_id", postgresql.UUID(as_uuid=True), nullable=True))
        op.add_column(table_name, sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
        op.add_column(table_name, sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(f"fk_{table_name}_team_id_teams", table_name, "teams", ["team_id"], ["id"])
        op.create_foreign_key(f"fk_{table_name}_project_id_projects", table_name, "projects", ["project_id"], ["id"])
        op.create_foreign_key(f"fk_{table_name}_task_id_tasks", table_name, "tasks", ["task_id"], ["id"])
        op.create_index(op.f(f"ix_{table_name}_team_id"), table_name, ["team_id"], unique=False)
        op.create_index(op.f(f"ix_{table_name}_project_id"), table_name, ["project_id"], unique=False)
        op.create_index(op.f(f"ix_{table_name}_task_id"), table_name, ["task_id"], unique=False)


def downgrade() -> None:
    for table_name in ("screenshots", "work_sessions"):
        op.drop_index(op.f(f"ix_{table_name}_task_id"), table_name=table_name)
        op.drop_index(op.f(f"ix_{table_name}_project_id"), table_name=table_name)
        op.drop_index(op.f(f"ix_{table_name}_team_id"), table_name=table_name)
        op.drop_constraint(f"fk_{table_name}_task_id_tasks", table_name, type_="foreignkey")
        op.drop_constraint(f"fk_{table_name}_project_id_projects", table_name, type_="foreignkey")
        op.drop_constraint(f"fk_{table_name}_team_id_teams", table_name, type_="foreignkey")
        op.drop_column(table_name, "task_id")
        op.drop_column(table_name, "project_id")
        op.drop_column(table_name, "team_id")

    op.drop_index(op.f("ix_tasks_status"), table_name="tasks")
    op.drop_index(op.f("ix_tasks_project_id"), table_name="tasks")
    op.drop_index(op.f("ix_tasks_company_id"), table_name="tasks")
    op.drop_table("tasks")

    op.drop_index(op.f("ix_projects_team_id"), table_name="projects")
    op.drop_index(op.f("ix_projects_status"), table_name="projects")
    op.drop_index(op.f("ix_projects_company_id"), table_name="projects")
    op.drop_table("projects")
