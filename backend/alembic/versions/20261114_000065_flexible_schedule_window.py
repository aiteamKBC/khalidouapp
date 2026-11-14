"""Optional allowed window for flexible-schedule employees."""
from alembic import op
import sqlalchemy as sa

revision = "20261114_000065"
down_revision = "20261026_000064"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "employee_work_profiles",
        sa.Column("flexible_window_start", sa.Time(), nullable=True),
    )
    op.add_column(
        "employee_work_profiles",
        sa.Column("flexible_window_end", sa.Time(), nullable=True),
    )


def downgrade():
    op.drop_column("employee_work_profiles", "flexible_window_end")
    op.drop_column("employee_work_profiles", "flexible_window_start")
