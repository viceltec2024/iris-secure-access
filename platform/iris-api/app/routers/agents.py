from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..guardian import ALLOWED_TOOLS
from ..models import User
from ..schemas import AgentOut, DesignIn, TaskOut, ToolsUpdateIn
from .. import services

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("/meta/tools")
def list_allowed_tools(_user: User = Depends(current_user)):
    return {"tools": sorted(ALLOWED_TOOLS)}


@router.get("", response_model=list[AgentOut])
def list_agents(db: Session = Depends(get_db), user: User = Depends(current_user)):
    agents = services.tick_approved(db, user)
    return [AgentOut(**services.agent_to_dict(agent)) for agent in agents]


@router.post("/design", response_model=AgentOut)
def design(body: DesignIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    agent = services.design_agent(db, user, prompt=body.prompt, schedule=body.schedule, model_id=body.model_id)
    return AgentOut(**services.agent_to_dict(agent))


@router.get("/{agent_id}", response_model=AgentOut)
def get_agent(agent_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    agent = services.get_owned_agent(db, user, agent_id)
    return AgentOut(**services.agent_to_dict(agent))


@router.patch("/{agent_id}/tools", response_model=AgentOut)
def patch_tools(agent_id: str, body: ToolsUpdateIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    agent = services.update_tools(db, user, agent_id, tools=body.tools, model_id=body.model_id, schedule=body.schedule)
    return AgentOut(**services.agent_to_dict(agent))


@router.post("/{agent_id}/approve", response_model=AgentOut)
def approve(agent_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return AgentOut(**services.agent_to_dict(services.approve_agent(db, user, agent_id)))


@router.post("/{agent_id}/reject", response_model=AgentOut)
def reject(agent_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return AgentOut(**services.agent_to_dict(services.reject_agent(db, user, agent_id)))


@router.post("/{agent_id}/pause", response_model=AgentOut)
def pause(agent_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return AgentOut(**services.agent_to_dict(services.pause_agent(db, user, agent_id)))


@router.post("/{agent_id}/emergency-stop", response_model=AgentOut)
def stop(agent_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return AgentOut(**services.agent_to_dict(services.emergency_stop(db, user, agent_id)))


@router.delete("/{agent_id}")
def delete(agent_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    services.delete_agent(db, user, agent_id)
    return {"ok": True}


@router.get("/{agent_id}/tasks", response_model=list[TaskOut])
def tasks(agent_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    services.get_owned_agent(db, user, agent_id)
    return services.list_tasks(db, user, agent_id=agent_id)
