"""add teams

Revision ID: 20260710_000003
Revises: 20260710_000002
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260710_000003"
down_revision: str | None = "20260710_000002"
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
        "teams",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        *timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "name", name="uq_teams_company_name"),
    )
    op.create_index(op.f("ix_teams_company_id"), "teams", ["company_id"], unique=False)
    op.create_index(op.f("ix_teams_status"), "teams", ["status"], unique=False)

    op.create_table(
        "team_members",
        uuid_pk(),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        *timestamps(),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "employee_id", name="uq_team_members_team_employee"),
    )
    op.create_index(op.f("ix_team_members_employee_id"), "team_members", ["employee_id"], unique=False)
    op.create_index(op.f("ix_team_members_status"), "team_members", ["status"], unique=False)
    op.create_index(op.f("ix_team_members_team_id"), "team_members", ["team_id"], unique=False)

    op.create_table(
        "team_owners",
        uuid_pk(),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("admin_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        *timestamps(),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "admin_user_id", name="uq_team_owners_team_admin"),
    )
    op.create_index(op.f("ix_team_owners_admin_user_id"), "team_owners", ["admin_user_id"], unique=False)
    op.create_index(op.f("ix_team_owners_team_id"), "team_owners", ["team_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_team_owners_team_id"), table_name="team_owners")
    op.drop_index(op.f("ix_team_owners_admin_user_id"), table_name="team_owners")
    op.drop_table("team_owners")
    op.drop_index(op.f("ix_team_members_team_id"), table_name="team_members")
    op.drop_index(op.f("ix_team_members_status"), table_name="team_members")
    op.drop_index(op.f("ix_team_members_employee_id"), table_name="team_members")
    op.drop_table("team_members")
    op.drop_index(op.f("ix_teams_status"), table_name="teams")
    op.drop_index(op.f("ix_teams_company_id"), table_name="teams")
    op.drop_table("teams")
