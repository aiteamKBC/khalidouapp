"""activate legacy Team Leader self-created tasks

Revision ID: 20260726_000047
Revises: 20260725_000046
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260726_000047"
down_revision: Union[str, None] = "20260725_000046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SELF_REQUESTS = """
    SELECT request.id AS request_id, task.id AS task_id
    FROM task_workflow_requests AS request
    JOIN tasks AS task
      ON task.id = request.task_id
    JOIN projects AS project
      ON project.id = task.project_id
    JOIN team_owners AS team_owner
      ON team_owner.team_id = project.team_id
    JOIN admin_users AS admin_user
      ON admin_user.id = team_owner.admin_user_id
     AND admin_user.employee_id = task.assignee_employee_id
    WHERE request.status = 'pending'
      AND request.request_type = 'task_creation'
      AND task.status = 'active'
      AND task.stage IN ('new_requests', 'assigned')
      AND task.created_by_employee_id = task.assignee_employee_id
      AND project.status = 'active'
      AND admin_user.role = 'team_owner'
      AND admin_user.status = 'active'
"""


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE tasks AS task
        SET stage = 'assigned',
            reviewed_by_admin_user_id = NULL,
            reviewed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        FROM ({SELF_REQUESTS}) AS self_request
        WHERE task.id = self_request.task_id
        """
    )
    op.execute(
        f"""
        UPDATE task_notifications AS notification
        SET notification_type = 'task_activated',
            title = 'Team Leader task activated',
            message = 'This Team Leader task was activated automatically and does not need creation approval.',
            updated_at = CURRENT_TIMESTAMP
        FROM ({SELF_REQUESTS}) AS self_request
        WHERE notification.workflow_request_id = self_request.request_id
        """
    )
    op.execute(
        f"""
        UPDATE task_workflow_requests AS request
        SET status = 'approved',
            decision_note = 'Activated automatically for a Team Leader.',
            reviewed_by_admin_user_id = NULL,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        FROM ({SELF_REQUESTS}) AS self_request
        WHERE request.id = self_request.request_id
        """
    )


def downgrade() -> None:
    # This is a one-way data correction. Reverting it would recreate invalid
    # self-approval requests for tasks that may already have started.
    pass
