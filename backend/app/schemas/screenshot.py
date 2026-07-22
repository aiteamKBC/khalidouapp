from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ScreenshotInitiateRequest(BaseModel):
    screenshot_id: UUID
    session_id: UUID | None = None
    captured_at: datetime
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    file_size: int = Field(gt=0)
    mime_type: str = Field(pattern="^image/(jpeg|webp)$")
    checksum: str = Field(min_length=64, max_length=128)
    display_id: str | None = Field(default=None, max_length=100)
    display_name: str | None = Field(default=None, max_length=255)
    display_count: int = Field(default=1, ge=1, le=16)
    power_source: str = Field(default="unknown", pattern="^(ac|battery|unknown)$")


class ScreenshotCompleteRequest(BaseModel):
    checksum: str = Field(min_length=64, max_length=128)
    file_size: int = Field(gt=0)


class ScreenshotSkipRequest(BaseModel):
    event_id: UUID
    session_id: UUID | None = None
    occurred_at: datetime
    reason: str = Field(min_length=2, max_length=80)
    power_source: str = Field(default="unknown", pattern="^(ac|battery|unknown)$")
    tracking_status: str | None = Field(default=None, max_length=40)
