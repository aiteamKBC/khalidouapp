from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class SessionStartRequest(BaseModel):
    started_at: datetime | None = None
    task_id: UUID | None = None


class HeartbeatRequest(BaseModel):
    event_id: UUID
    timestamp: datetime
    status: str = Field(pattern="^(active|idle|locked|offline|sleeping)$")
    idle_seconds: int = Field(ge=0)
    active_seconds: int | None = Field(default=None, ge=0)
    agent_version: str = Field(min_length=1, max_length=50)


class ActivityEventRequest(BaseModel):
    event_id: UUID
    event_type: str = Field(min_length=1, max_length=80)
    event_timestamp: datetime
    payload: dict[str, Any] | None = None


class SessionEndRequest(BaseModel):
    event_id: UUID | None = None
    ended_at: datetime | None = None
    active_seconds: int | None = Field(default=None, ge=0)
    idle_seconds: int | None = Field(default=None, ge=0)
    reason: str | None = Field(default=None, max_length=120)


class SessionTaskUpdateRequest(BaseModel):
    task_id: UUID | None = None
