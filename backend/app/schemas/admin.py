from datetime import date, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class EmployeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    employee_code: str | None = Field(default=None, max_length=80)
    job_title: str | None = Field(default=None, max_length=255)
    timezone: str = Field(default="Africa/Cairo", max_length=80)
    weekly_capacity_minutes: int = Field(default=2400, ge=60, le=10080)


class EmployeeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    employee_code: str | None = Field(default=None, max_length=80)
    job_title: str | None = Field(default=None, max_length=255)
    timezone: str | None = Field(default=None, max_length=80)
    start_date: date | None = None
    status: Literal["active", "inactive"] | None = None
    weekly_capacity_minutes: int | None = Field(default=None, ge=60, le=10080)


class EmployeePasswordUpdate(BaseModel):
    password: str = Field(min_length=8, max_length=255)


class BreakRule(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    minutes: int = Field(ge=1, le=240)
    paid: bool = False
    start_time: time | None = None
    end_time: time | None = None


class DeductionBracket(BaseModel):
    after_minutes: int = Field(ge=0, le=1440)
    deduct_minutes: int = Field(ge=0, le=1440)
    note: str | None = Field(default=None, max_length=255)


class DeductionPolicy(BaseModel):
    mode: Literal["review", "per_minute", "brackets"] = "review"
    brackets: list[DeductionBracket] = Field(default_factory=list)
    require_admin_review: bool = True


class EmployeeWorkProfileUpdate(BaseModel):
    shift_start: time | None = None
    shift_end: time | None = None
    working_days: list[int] | None = None
    weekly_off_days: list[int] | None = None
    required_daily_minutes: int | None = Field(default=None, ge=60, le=1440)
    break_rules: list[BreakRule] | None = None
    late_grace_minutes: int | None = Field(default=None, ge=0, le=240)
    no_show_threshold_minutes: int | None = Field(default=None, ge=0, le=1440)
    schedule_type: Literal["fixed", "flexible"] | None = None
    weekly_early_leave_minutes: int | None = Field(default=None, ge=0, le=1440)
    deduction_policy: DeductionPolicy | None = None
    overtime_enabled: bool | None = None
    overtime_basis: Literal["beyond_daily_required", "outside_shift", "either"] | None = None
    overtime_rate_multiplier: float | None = Field(default=None, ge=0, le=10)
    salary_amount: float | None = Field(default=None, ge=0)
    salary_currency: Literal["EGP", "GBP", "USD", "EUR", "SAR", "AED"] | None = None
    salary_type: Literal["monthly", "hourly"] | None = None
    bank_account_number: str | None = None
    bank_employee_id: str | None = None

    @field_validator("bank_account_number", "bank_employee_id", mode="before")
    @classmethod
    def normalize_bank_identifier(cls, value: object) -> str | None:
        if value is None or value == "":
            return None
        normalized = str(value).strip()
        if not normalized.isdigit():
            raise ValueError("Bank identifiers must contain digits only.")
        return normalized

    @field_validator("bank_account_number")
    @classmethod
    def validate_bank_account_number(cls, value: str | None) -> str | None:
        if value is not None and len(value) not in {11, 13}:
            raise ValueError("Bank account number must be 11 or 13 digits.")
        return value

    @field_validator("bank_employee_id")
    @classmethod
    def validate_bank_employee_id(cls, value: str | None) -> str | None:
        if value is not None and len(value) != 10:
            raise ValueError("Bank employee ID must be exactly 10 digits.")
        return value


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

    @field_validator("idle_threshold_minutes")
    @classmethod
    def enforce_idle_threshold(cls, value: int | None) -> int | None:
        return 10 if value is not None else None


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
    role: Literal["team_manager", "team_lead", "senior", "member", "trainee"] = "member"


class TeamMemberUpdate(BaseModel):
    role: Literal["team_manager", "team_lead", "senior", "member", "trainee"] | None = None
    status: str | None = Field(default=None, max_length=50)


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
    stage: (
        Literal[
            "backlog",
            "assigned",
            "in_progress",
            "ready_for_review",
            "completed",
            "blocked",
            "rejected",
            "cancelled",
        ]
        | None
    ) = None
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
    job_title: str | None = Field(default=None, max_length=255)
    password: str = Field(min_length=8, max_length=255)
    role: Literal["general_admin", "team_owner", "hr"] = "team_owner"
    status: str = Field(default="active", max_length=50)


class AdminUserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    job_title: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=255)
    role: Literal["general_admin", "team_owner", "hr"] | None = None
    status: str | None = Field(default=None, max_length=50)


class PersonInvitationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    kind: Literal["employee", "team_manager", "general_admin", "hr"]
    team_ids: list[UUID] = Field(default_factory=list)
    job_title: str | None = Field(default=None, max_length=255)
    timezone: str = Field(default="Africa/Cairo", max_length=80)
    track_as_employee: bool = False
    start_date: date | None = None
    annual_leave_days: int = Field(default=21, ge=0, le=365)
    work_profile: EmployeeWorkProfileUpdate | None = None

    @field_validator("name")
    @classmethod
    def validate_person_name(cls, value: str) -> str:
        clean_name = " ".join(value.split())
        if not clean_name:
            raise ValueError("Name is required.")
        return clean_name


class AdminAccessUpdate(BaseModel):
    role: Literal["general_admin", "team_owner", "hr"] | None = None
    permission_mode: Literal["role", "custom"] | None = None
    data_scope: Literal["company", "assigned_teams"] | None = None
    permission_overrides: dict[str, bool] | None = None
    team_lead_team_ids: list[UUID] | None = None
    track_as_employee: bool | None = None


class PersonRoleUpdate(BaseModel):
    role: Literal["employee", "team_owner", "hr", "general_admin"]
    team_ids: list[UUID] = Field(default_factory=list)
    password: str | None = Field(default=None, min_length=8, max_length=255)


class TimeAdjustmentReview(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")
    approved_minutes: int | None = Field(default=None, ge=1, le=720)
    admin_note: str | None = Field(default=None, max_length=1000)


class TimeAdjustmentBulkReview(BaseModel):
    status: Literal["approved", "rejected"]
    request_ids: list[UUID] = Field(default_factory=list, max_length=200)
    all_filtered: bool = False
    employee_id: UUID | None = None
    team_id: UUID | None = None
    request_group: Literal["time", "early_leave"] = "time"
    admin_note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def require_exactly_one_scope(self):
        if self.all_filtered == bool(self.request_ids):
            raise ValueError("Choose request_ids or all_filtered, but not both.")
        return self


class LeaveRequestReview(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")
    review_note: str | None = Field(default=None, max_length=1000)


class LeaveBalanceUpdate(BaseModel):
    credit_days: float = Field(ge=0, le=365)


class ManualLeaveCreate(BaseModel):
    employee_id: UUID
    start_date: date
    end_date: date
    leave_type: str = Field(default="annual", pattern="^(annual|sick|unpaid)$")
    reason: str | None = Field(default=None, max_length=1000)
