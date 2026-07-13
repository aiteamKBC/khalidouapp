from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class EmployeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    employee_code: str | None = Field(default=None, max_length=80)
    department: str | None = Field(default=None, max_length=255)
    timezone: str = Field(default="UTC", max_length=80)
    weekly_capacity_minutes: int = Field(default=2400, ge=60, le=10080)


class EmployeeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    employee_code: str | None = Field(default=None, max_length=80)
    department: str | None = Field(default=None, max_length=255)
    timezone: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, max_length=50)
    weekly_capacity_minutes: int | None = Field(default=None, ge=60, le=10080)


class EnrollmentCodeCreate(BaseModel):
    expires_in_days: int = Field(default=14, ge=1, le=90)


class DeviceUpdate(BaseModel):
    status: str | None = Field(default=None, max_length=50)


class TrackingSettingsUpdate(BaseModel):
    screenshot_enabled: bool | None = None
    screenshot_interval_minutes: int | None = Field(default=None, ge=1, le=240)
    screenshots_per_interval: int | None = Field(default=None, ge=1, le=2)
    idle_threshold_minutes: int | None = Field(default=None, ge=1, le=120)
    capture_during_idle: bool | None = None
    offline_threshold_minutes: int | None = Field(default=None, ge=1, le=60)
    screenshot_retention_days: int | None = Field(default=None, ge=1, le=3650)


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    status: str = Field(default="active", max_length=50)


class TeamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, max_length=50)


class TeamMemberCreate(BaseModel):
    employee_id: UUID
    status: str = Field(default="active", max_length=50)


class TeamOwnerCreate(BaseModel):
    admin_user_id: UUID


class ProjectCreate(BaseModel):
    team_id: UUID
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    status: str = Field(default="active", max_length=50)


class ProjectUpdate(BaseModel):
    team_id: UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, max_length=50)


class TaskCreate(BaseModel):
    project_id: UUID
    assignee_employee_id: UUID | None = None
    collaborator_employee_ids: list[UUID] = Field(default_factory=list)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    status: str = Field(default="active", max_length=50)
    stage: Literal["backlog", "assigned", "in_progress"] = "backlog"
    start_date: date | None = None
    deadline: date | None = None
    estimated_minutes: int | None = Field(default=None, ge=1, le=100000)
    labels: list[str] = Field(default_factory=list, max_length=20)
    recurrence_rule: str | None = Field(default=None, max_length=80)
    priority: str = Field(default="medium", pattern="^(low|medium|high|urgent)$")


class TaskUpdate(BaseModel):
    project_id: UUID | None = None
    assignee_employee_id: UUID | None = None
    collaborator_employee_ids: list[UUID] | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, max_length=50)
    stage: Literal[
        "backlog",
        "assigned",
        "in_progress",
        "ready_for_review",
        "completed",
        "blocked",
        "rejected",
        "cancelled",
    ] | None = None
    position: int | None = Field(default=None, ge=0)
    start_date: date | None = None
    deadline: date | None = None
    estimated_minutes: int | None = Field(default=None, ge=1, le=100000)
    labels: list[str] | None = Field(default=None, max_length=20)
    recurrence_rule: str | None = Field(default=None, max_length=80)
    priority: str | None = Field(default=None, pattern="^(low|medium|high|urgent)$")
    blocked_reason: str | None = Field(default=None, max_length=1000)
    block_resolution_note: str | None = Field(default=None, max_length=1000)
    review_note: str | None = Field(default=None, max_length=1000)
    completion_note: str | None = Field(default=None, max_length=1000)


class TaskApprovalRequest(BaseModel):
    target_stage: Literal["assigned"] = "assigned"


class TaskDecisionRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class TaskReviewReturnRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)
    target_stage: Literal["backlog", "assigned", "in_progress", "blocked"] = "in_progress"


class TaskCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class TaskDependencyCreate(BaseModel):
    depends_on_task_id: UUID


class ChecklistItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    assignee_employee_id: UUID | None = None


class ChecklistItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    completed: bool | None = None
    assignee_employee_id: UUID | None = None
    position: int | None = Field(default=None, ge=0)


class AdminUserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=255)
    role: Literal["general_admin", "team_owner"] = "team_owner"
    status: str = Field(default="active", max_length=50)


class AdminUserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=255)
    role: Literal["general_admin", "team_owner"] | None = None
    status: str | None = Field(default=None, max_length=50)


class PersonInvitationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    kind: Literal["employee", "team_manager", "general_admin"]
    team_ids: list[UUID] = Field(default_factory=list)
    department: str | None = Field(default=None, max_length=255)
    timezone: str = Field(default="Africa/Cairo", max_length=80)
    track_as_employee: bool = False


class AdminAccessUpdate(BaseModel):
    role: Literal["general_admin", "team_owner"] | None = None
    permission_mode: Literal["role", "custom"] | None = None
    data_scope: Literal["company", "assigned_teams"] | None = None
    permission_overrides: dict[str, bool] | None = None
    team_lead_team_ids: list[UUID] | None = None
    track_as_employee: bool | None = None


class TimeAdjustmentReview(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")
    approved_minutes: int | None = Field(default=None, ge=1, le=720)
    admin_note: str | None = Field(default=None, max_length=1000)
