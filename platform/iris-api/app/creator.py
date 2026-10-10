import json
import re
import uuid
from datetime import datetime, timezone

from .config import get_settings
from .guardian import ALLOWED_TOOLS, run_guardian
from .sandbox import run_isolated_tests


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def extract_specialty(prompt: str) -> str:
    cleaned = re.sub(r"^(?:oye|hey|ok|okay|hola|escucha)\s+iris[,:]?\s+", "", prompt, flags=re.I)
    cleaned = re.sub(r"^iris[,:]?\s+", "", cleaned, flags=re.I).strip()
    store = re.search(r"(?:tienda|store|negocio|business|shop|librer[ií]a|marketing(?:\s+de)?)\s+([^.!?,]{3,80})", cleaned, re.I)
    if store:
        return title_case(store.group(1))
    specialized = re.search(r"(?:especializada? en|specialized in|para|que administre)\s+([^.!?,]{3,80})", cleaned, re.I)
    if specialized:
        return title_case(specialized.group(1))
    return "Agente personalizado"


def title_case(value: str) -> str:
    return " ".join(part[:1].upper() + part[1:] for part in value.split() if part)[:72]


def default_tools_for(specialty: str) -> list[str]:
    tools = ["business_context", "draft_composer", "owner_notifier", "proposal_queue"]
    text = specialty.lower()
    if "marketing" in text or "grooming" in text or "tienda" in text or "store" in text:
        tools.extend(["marketing_calendar_sim", "social_draft_sim"])
    tools.append("task_checklist_sim")
    return [tool for tool in tools if tool in ALLOWED_TOOLS]


def generate_source(agent_id: str, name: str, specialty: str, schedule: str, tools: list[str], goals: list[str]) -> str:
    return f'''"""IRIS Creator generated agent — supervised sandbox only."""
AGENT = {{
    "id": {json.dumps(agent_id)},
    "name": {json.dumps(name)},
    "specialty": {json.dumps(specialty)},
    "schedule": {json.dumps(schedule)},
    "autonomy": "supervised",
    "tools": {json.dumps(tools)},
    "goals": {json.dumps(goals)},
}}

SIMULATED_TOOLS = set(AGENT["tools"])


def propose_action(summary: str) -> dict:
    if "proposal_queue" not in SIMULATED_TOOLS:
        raise PermissionError("proposal_queue not authorized")
    return {{
        "type": "proposal",
        "requires_human_approval": True,
        "summary": str(summary)[:280],
    }}


def tick() -> dict:
    return {{"ok": True, "status": "heartbeat", "autonomy": "supervised", "tools": sorted(SIMULATED_TOOLS)}}
'''


def generate_tests(specialty: str) -> str:
    return f'''"""Isolated tests for generated IRIS agent ({specialty})."""
from agent_module import AGENT, propose_action, tick


def test_agent_is_supervised():
    assert AGENT["autonomy"] == "supervised"


def test_propose_requires_approval():
    result = propose_action("draft weekly marketing checklist")
    assert result["requires_human_approval"] is True


def test_tick_heartbeat():
    result = tick()
    assert result["ok"] is True
    assert result["status"] == "heartbeat"
'''


def design_agent_payload(*, prompt: str, schedule: str, model_id: str) -> dict:
    settings = get_settings()
    if model_id not in settings.model_allowlist:
        raise ValueError(f"Model not authorized: {model_id}")
    specialty = extract_specialty(prompt)
    agent_id = str(uuid.uuid4())
    name = f"IRIS · {specialty}"
    tools = default_tools_for(specialty)
    goals = [
        f"Administrar tareas rutinarias de {specialty}",
        "Proponer acciones claras al operador humano",
        "Mantener un registro auditable de cada propuesta",
    ]
    constraints = [
        "No gasta dinero ni firma pagos",
        "No ejecuta shell ni cambia el núcleo de IRIS",
        "No despliega cambios sin aprobación humana",
        "Solo usa herramientas allowlisted y simuladas en Fase 1",
    ]
    permissions = [
        "read_business_context",
        "draft_replies",
        "propose_actions",
        "notify_owner",
        "run_on_schedule" if schedule != "on_demand" else "notify_owner",
    ]
    permissions = list(dict.fromkeys(permissions))
    source = generate_source(agent_id, name, specialty, schedule, tools, goals)
    tests = generate_tests(specialty)
    guardian = run_guardian(prompt=prompt, source_code=source, test_code=tests, tools=tools, autonomy="supervised")
    sandbox = run_isolated_tests(source_code=source, test_code=tests)
    passed = bool(guardian["passed"] and sandbox["passed"])
    status = "awaiting_approval" if passed else "sandbox_failed"
    now = utcnow()
    return {
        "id": agent_id,
        "name": name,
        "prompt": prompt.strip(),
        "specialty": specialty,
        "status": status,
        "schedule": schedule,
        "autonomy": "supervised",
        "model_id": model_id,
        "tools": tools,
        "permissions": permissions,
        "goals": goals,
        "constraints": constraints,
        "source_code": source,
        "test_code": tests,
        "sandbox": sandbox,
        "guardian": guardian,
        "version": 1,
        "created_at": now,
        "updated_at": now,
        "approved_at": None,
        "approved_by": None,
        "last_tick_at": None,
        "emergency_stopped": False,
    }


def regenerate_after_tools_edit(agent: dict, tools: list[str], model_id: str | None = None, schedule: str | None = None) -> dict:
    settings = get_settings()
    next_model = model_id or agent["model_id"]
    if next_model not in settings.model_allowlist:
        raise ValueError(f"Model not authorized: {next_model}")
    next_schedule = schedule or agent["schedule"]
    next_tools = [tool for tool in tools if tool in ALLOWED_TOOLS]
    if not next_tools:
        raise ValueError("At least one allowlisted tool is required")
    source = generate_source(agent["id"], agent["name"], agent["specialty"], next_schedule, next_tools, agent["goals"])
    tests = generate_tests(agent["specialty"])
    guardian = run_guardian(
        prompt=agent["prompt"],
        source_code=source,
        test_code=tests,
        tools=next_tools,
        autonomy="supervised",
    )
    sandbox = run_isolated_tests(source_code=source, test_code=tests)
    passed = bool(guardian["passed"] and sandbox["passed"])
    agent = {
        **agent,
        "tools": next_tools,
        "model_id": next_model,
        "schedule": next_schedule,
        "source_code": source,
        "test_code": tests,
        "sandbox": sandbox,
        "guardian": guardian,
        "status": "awaiting_approval" if passed else "sandbox_failed",
        "version": int(agent.get("version") or 1) + 1,
        "updated_at": utcnow(),
        "approved_at": None,
        "approved_by": None,
    }
    return agent
