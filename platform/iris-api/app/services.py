import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .creator import design_agent_payload, regenerate_after_tools_edit, utcnow
from .models import Agent, AgentTask, AuditEvent, User


def dumps(value) -> str:
    return json.dumps(value, default=str)


def loads_list(value: str) -> list:
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def loads_dict(value: str) -> dict:
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def agent_to_dict(agent: Agent) -> dict:
    return {
        "id": agent.id,
        "name": agent.name,
        "prompt": agent.prompt,
        "specialty": agent.specialty,
        "status": agent.status,
        "schedule": agent.schedule,
        "autonomy": agent.autonomy,
        "model_id": agent.model_id,
        "tools": loads_list(agent.tools_json),
        "permissions": loads_list(agent.permissions_json),
        "goals": loads_list(agent.goals_json),
        "constraints": loads_list(agent.constraints_json),
        "source_code": agent.source_code,
        "test_code": agent.test_code,
        "sandbox": loads_dict(agent.sandbox_report_json),
        "guardian": loads_dict(agent.guardian_report_json),
        "version": agent.version,
        "created_at": agent.created_at,
        "updated_at": agent.updated_at,
        "approved_at": agent.approved_at,
        "approved_by": agent.approved_by,
        "last_tick_at": agent.last_tick_at,
        "emergency_stopped": agent.emergency_stopped,
    }


def write_audit(db: Session, actor_email: str, action: str, resource: str, outcome: str, metadata: dict | None = None) -> None:
    db.add(AuditEvent(
        actor_email=actor_email,
        action=action,
        resource=resource,
        outcome=outcome,
        metadata_json=dumps(metadata or {}),
    ))


def add_task(db: Session, agent_id: str, kind: str, summary: str, detail: dict | None = None, status: str = "completed") -> AgentTask:
    task = AgentTask(agent_id=agent_id, kind=kind, status=status, summary=summary, detail_json=dumps(detail or {}))
    db.add(task)
    return task


def persist_designed(db: Session, owner: User, payload: dict) -> Agent:
    agent = Agent(
        id=payload["id"],
        owner_id=owner.id,
        name=payload["name"],
        prompt=payload["prompt"],
        specialty=payload["specialty"],
        status=payload["status"],
        schedule=payload["schedule"],
        autonomy=payload["autonomy"],
        model_id=payload["model_id"],
        tools_json=dumps(payload["tools"]),
        permissions_json=dumps(payload["permissions"]),
        goals_json=dumps(payload["goals"]),
        constraints_json=dumps(payload["constraints"]),
        source_code=payload["source_code"],
        test_code=payload["test_code"],
        sandbox_report_json=dumps(payload["sandbox"]),
        guardian_report_json=dumps(payload["guardian"]),
        version=payload["version"],
        created_at=payload["created_at"],
        updated_at=payload["updated_at"],
    )
    db.add(agent)
    add_task(db, agent.id, "design", f"Diseñado {agent.name}", {"status": agent.status})
    add_task(db, agent.id, "sandbox", "Pruebas aisladas", payload["sandbox"])
    write_audit(db, owner.email, "AGENT_DESIGNED", agent.id, "SUCCESS", {"status": agent.status, "specialty": agent.specialty})
    db.commit()
    db.refresh(agent)
    return agent


def get_owned_agent(db: Session, owner: User, agent_id: str) -> Agent:
    agent = db.get(Agent, agent_id)
    if not agent or (agent.owner_id != owner.id and owner.role != "ADMIN"):
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


def design_agent(db: Session, owner: User, prompt: str, schedule: str, model_id: str) -> Agent:
    try:
        payload = design_agent_payload(prompt=prompt, schedule=schedule, model_id=model_id)
    except ValueError as exc:
        write_audit(db, owner.email, "AGENT_DESIGN_DENIED", "creator", "DENIED", {"error": str(exc)})
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return persist_designed(db, owner, payload)


def update_tools(db: Session, owner: User, agent_id: str, tools: list[str], model_id: str | None, schedule: str | None) -> Agent:
    agent = get_owned_agent(db, owner, agent_id)
    if agent.status in {"approved"}:
        raise HTTPException(status_code=400, detail="Pause the agent before editing tools")
    current = agent_to_dict(agent)
    try:
        updated = regenerate_after_tools_edit(current, tools=tools, model_id=model_id, schedule=schedule)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    agent.tools_json = dumps(updated["tools"])
    agent.model_id = updated["model_id"]
    agent.schedule = updated["schedule"]
    agent.source_code = updated["source_code"]
    agent.test_code = updated["test_code"]
    agent.sandbox_report_json = dumps(updated["sandbox"])
    agent.guardian_report_json = dumps(updated["guardian"])
    agent.status = updated["status"]
    agent.version = updated["version"]
    agent.updated_at = updated["updated_at"]
    agent.approved_at = None
    agent.approved_by = None
    add_task(db, agent.id, "tools_updated", "Herramientas actualizadas y sandbox reejecutado", {"tools": updated["tools"]})
    write_audit(db, owner.email, "AGENT_TOOLS_UPDATED", agent.id, "SUCCESS", {"tools": updated["tools"], "status": agent.status})
    db.commit()
    db.refresh(agent)
    return agent


def approve_agent(db: Session, owner: User, agent_id: str) -> Agent:
    agent = get_owned_agent(db, owner, agent_id)
    if agent.status not in {"awaiting_approval", "paused"}:
        raise HTTPException(status_code=400, detail="Agent is not awaiting approval")
    guardian = loads_dict(agent.guardian_report_json)
    sandbox = loads_dict(agent.sandbox_report_json)
    if not guardian.get("passed") or not sandbox.get("passed"):
        raise HTTPException(status_code=400, detail="Guardian or sandbox blocked deployment")
    now = utcnow()
    agent.status = "approved"
    agent.approved_at = now
    agent.approved_by = owner.email
    agent.updated_at = now
    agent.last_tick_at = now
    agent.emergency_stopped = False
    add_task(db, agent.id, "approved", f"Aprobado por {owner.email}")
    write_audit(db, owner.email, "AGENT_APPROVED", agent.id, "SUCCESS", {"schedule": agent.schedule})
    db.commit()
    db.refresh(agent)
    return agent


def reject_agent(db: Session, owner: User, agent_id: str) -> Agent:
    agent = get_owned_agent(db, owner, agent_id)
    if agent.status != "awaiting_approval":
        raise HTTPException(status_code=400, detail="Agent is not awaiting approval")
    agent.status = "rejected"
    agent.updated_at = utcnow()
    add_task(db, agent.id, "rejected", f"Rechazado por {owner.email}")
    write_audit(db, owner.email, "AGENT_REJECTED", agent.id, "SUCCESS", {})
    db.commit()
    db.refresh(agent)
    return agent


def pause_agent(db: Session, owner: User, agent_id: str) -> Agent:
    agent = get_owned_agent(db, owner, agent_id)
    if agent.status != "approved":
        raise HTTPException(status_code=400, detail="Only approved agents can be paused")
    agent.status = "paused"
    agent.updated_at = utcnow()
    add_task(db, agent.id, "paused", "Agente pausado")
    write_audit(db, owner.email, "AGENT_PAUSED", agent.id, "SUCCESS", {})
    db.commit()
    db.refresh(agent)
    return agent


def emergency_stop(db: Session, owner: User, agent_id: str) -> Agent:
    agent = get_owned_agent(db, owner, agent_id)
    agent.status = "stopped"
    agent.emergency_stopped = True
    agent.updated_at = utcnow()
    add_task(db, agent.id, "emergency_stop", "Detención de emergencia")
    write_audit(db, owner.email, "AGENT_EMERGENCY_STOP", agent.id, "SUCCESS", {})
    db.commit()
    db.refresh(agent)
    return agent


def delete_agent(db: Session, owner: User, agent_id: str) -> None:
    agent = get_owned_agent(db, owner, agent_id)
    write_audit(db, owner.email, "AGENT_DELETED", agent.id, "SUCCESS", {"name": agent.name})
    db.delete(agent)
    db.commit()


def tick_approved(db: Session, owner: User) -> list[Agent]:
    agents = list(db.scalars(select(Agent).where(Agent.owner_id == owner.id, Agent.status == "approved")))
    now = utcnow()
    for agent in agents:
        if agent.schedule == "on_demand":
            continue
        agent.last_tick_at = now
        agent.updated_at = now
    if agents:
        db.commit()
        for agent in agents:
            db.refresh(agent)
    return list(db.scalars(select(Agent).where(Agent.owner_id == owner.id).order_by(Agent.created_at.desc())))


def list_tasks(db: Session, owner: User, agent_id: str | None = None, limit: int = 50) -> list[AgentTask]:
    query = select(AgentTask).join(Agent).where(Agent.owner_id == owner.id)
    if agent_id:
        query = query.where(AgentTask.agent_id == agent_id)
    return list(db.scalars(query.order_by(AgentTask.created_at.desc()).limit(min(limit, 200))))


def list_audit(db: Session, owner: User, limit: int = 50) -> list[AuditEvent]:
    query = select(AuditEvent)
    if owner.role != "ADMIN":
        query = query.where(AuditEvent.actor_email == owner.email)
    return list(db.scalars(query.order_by(AuditEvent.created_at.desc()).limit(min(limit, 200))))
