from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="ADMIN")  # ADMIN | USER
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    agents: Mapped[list["Agent"]] = relationship(back_populates="owner")


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    prompt: Mapped[str] = mapped_column(Text)
    specialty: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(40), index=True, default="draft")
    schedule: Mapped[str] = mapped_column(String(40), default="always_on")
    autonomy: Mapped[str] = mapped_column(String(40), default="supervised")
    model_id: Mapped[str] = mapped_column(String(120), default="local-sim")
    tools_json: Mapped[str] = mapped_column(Text, default="[]")
    permissions_json: Mapped[str] = mapped_column(Text, default="[]")
    goals_json: Mapped[str] = mapped_column(Text, default="[]")
    constraints_json: Mapped[str] = mapped_column(Text, default="[]")
    source_code: Mapped[str] = mapped_column(Text, default="")
    test_code: Mapped[str] = mapped_column(Text, default="")
    sandbox_report_json: Mapped[str] = mapped_column(Text, default="{}")
    guardian_report_json: Mapped[str] = mapped_column(Text, default="{}")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(320), nullable=True)
    last_tick_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    emergency_stopped: Mapped[bool] = mapped_column(Boolean, default=False)

    owner: Mapped[User] = relationship(back_populates="agents")
    tasks: Mapped[list["AgentTask"]] = relationship(back_populates="agent", cascade="all, delete-orphan")


class AgentTask(Base):
    __tablename__ = "agent_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    kind: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(40), default="completed")
    summary: Mapped[str] = mapped_column(Text, default="")
    detail_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    agent: Mapped[Agent] = relationship(back_populates="tasks")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (UniqueConstraint("id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_email: Mapped[str] = mapped_column(String(320), index=True)
    action: Mapped[str] = mapped_column(String(80))
    resource: Mapped[str] = mapped_column(String(120))
    outcome: Mapped[str] = mapped_column(String(32))
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
