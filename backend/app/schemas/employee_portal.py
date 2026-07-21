from datetime import date
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class EmployeePortalLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=255)


class EmployeeInvitationAccept(BaseModel):
    password: str = Field(min_length=8, max_length=255)


class EmployeePortalHandoff(BaseModel):
    handoff_token: str = Field(min_length=20, max_length=4096)


class EmployeeProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    avatar_url: str | None = Field(default=None, max_length=2_000_000)


class EmployeePortalTimeRequestCreate(BaseModel):
    requested_date: date | None = None
    requested_minutes: int = Field(ge=1, le=720)
    reason: str = Field(min_length=3, max_length=1000)


class EmployeePortalLeaveRequestCreate(BaseModel):
    start_date: date
    end_date: date
    leave_type: str = Field(default="annual", pattern="^(annual|sick|unpaid)$")
    reason: str | None = Field(default=None, max_length=1000)


class EmployeePortalTaskCreate(BaseModel):
    project_id: UUID
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    stage: str = Field(default="assigned", pattern="^assigned$")
    start_date: date | None = None
    deadline: date | None = None
    estimated_minutes: int | None = Field(default=None, ge=1, le=100000)
    priority: str = Field(default="medium", pattern="^(low|medium|high|urgent)$")


class EmployeePortalTaskUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    stage: str | None = Field(
        default=None,
        pattern="^(assigned|in_progress|ready_for_review|blocked)$",
    )
    start_date: date | None = None
    deadline: date | None = None
    estimated_minutes: int | None = Field(default=None, ge=1, le=100000)
    note: str | None = Field(default=None, max_length=1000)
