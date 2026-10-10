from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

AgentStatus = Literal[
    "draft",
    "sandbox_passed",
    "sandbox_failed",
    "awaiting_approval",
    "approved",
    "rejected",
    "paused",
    "stopped",
]

Schedule = Literal["always_on", "business_hours", "on_demand"]


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    email: str
    role: str


class LoginIn(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=200)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email or len(email) < 5:
            raise ValueError("Invalid email")
        return email


class BootstrapOut(BaseModel):
    created: bool
    email: str
    message: str


class DesignIn(BaseModel):
    prompt: str = Field(min_length=8, max_length=500)
    schedule: Schedule = "always_on"
    model_id: str = "local-sim"


class ToolsUpdateIn(BaseModel):
    tools: list[str] = Field(min_length=1, max_length=20)
    model_id: str | None = None
    schedule: Schedule | None = None


class SandboxCheck(BaseModel):
    id: str
    label: str
    ok: bool
    detail: str


class GuardianFinding(BaseModel):
    severity: Literal["info", "warn", "block"]
    code: str
    message: str


class AgentOut(BaseModel):
    id: str
    name: str
    prompt: str
    specialty: str
    status: AgentStatus
    schedule: Schedule
    autonomy: str
    model_id: str
    tools: list[str]
    permissions: list[str]
    goals: list[str]
    constraints: list[str]
    source_code: str
    test_code: str
    sandbox: dict[str, Any]
    guardian: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime
    approved_at: datetime | None = None
    approved_by: str | None = None
    last_tick_at: datetime | None = None
    emergency_stopped: bool = False

    model_config = {"from_attributes": True}


class TaskOut(BaseModel):
    id: int
    agent_id: str
    kind: str
    status: str
    summary: str
    created_at: datetime


class AuditOut(BaseModel):
    id: int
    actor_email: str
    action: str
    resource: str
    outcome: str
    metadata_json: str
    created_at: datetime


class HealthOut(BaseModel):
    status: str
    module: str
    database: str
    allowed_models: list[str]
