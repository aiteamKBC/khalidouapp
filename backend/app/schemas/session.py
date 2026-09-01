from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class SessionStartRequest(BaseModel):
    started_at: datetime | None = None
    task_id: UUID | None = None
    offline_recovery: bool = False
    offline_recovery_id: UUID | None = None


class InputIntegrityObservation(BaseModel):
    sensor: Literal["windows_low_level_input"]
    sensor_available: bool
    observed_seconds: int = Field(ge=0, le=300)
    real_mouse_events: int = Field(ge=0, le=1_000_000)
    real_keyboard_events: int = Field(ge=0, le=1_000_000)
    injected_mouse_events: int = Field(ge=0, le=1_000_000)
    injected_keyboard_events: int = Field(ge=0, le=1_000_000)


class HeartbeatRequest(BaseModel):
    event_id: UUID
    timestamp: datetime
    status: str = Field(pattern="^(active|idle|locked|offline|sleeping)$")
    idle_seconds: int = Field(ge=0)
    active_seconds: int | None = Field(default=None, ge=0)
    agent_version: str = Field(min_length=1, max_length=50)
    mac_address: str | None = Field(default=None, max_length=32)
    timezone: str | None = Field(default=None, min_length=1, max_length=80)
    input_integrity: InputIntegrityObservation | None = None


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


class PauseStartRequest(BaseModel):
    requested_minutes: int = Field(ge=1, le=240)
    reason: str | None = Field(default=None, max_length=500)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=120)
