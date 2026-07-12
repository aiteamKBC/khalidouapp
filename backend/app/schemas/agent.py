from pydantic import BaseModel, Field
from datetime import date
from uuid import UUID


class AgentDeviceInfo(BaseModel):
    installation_id: str = Field(min_length=8, max_length=255)
    device_name: str = Field(min_length=1, max_length=255)
    operating_system: str = Field(min_length=1, max_length=255)
    agent_version: str = Field(min_length=1, max_length=50)
    windows_username: str | None = Field(default=None, max_length=255)


class EnrollmentRequest(BaseModel):
    enrollment_code: str = Field(min_length=6, max_length=80)
    device: AgentDeviceInfo


class RefreshDeviceTokenRequest(BaseModel):
    rotate_reason: str | None = Field(default=None, max_length=120)


class AgentTimeAdjustmentRequestCreate(BaseModel):
    requested_date: date | None = None
    requested_minutes: int = Field(ge=1, le=720)
    reason: str = Field(min_length=3, max_length=1000)


class AgentTaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    project_id: UUID | None = None
    description: str | None = Field(default=None, max_length=1000)
    stage: str = Field(default="assigned", pattern="^assigned$")
    start_date: date | None = None
    deadline: date | None = None
    estimated_minutes: int | None = Field(default=None, ge=1, le=100000)
    priority: str = Field(default="medium", pattern="^(low|medium|high|urgent)$")


class AgentTaskUpdate(BaseModel):
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
