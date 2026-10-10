import re
from typing import Any

BLOCKED_CAPABILITIES = [
    "exec_shell",
    "spend_money",
    "self_modify_core",
    "deploy_without_approval",
    "exfiltrate_secrets",
    "network_unrestricted",
    "create_unbounded_agents",
]

ALLOWED_TOOLS = {
    "business_context",
    "draft_composer",
    "owner_notifier",
    "proposal_queue",
    "marketing_calendar_sim",
    "social_draft_sim",
    "task_checklist_sim",
}

UNSAFE_PATTERN = re.compile(
    r"\b(rm\s+-rf|eval\(|exec\(|subprocess|child_process|os\.system|socket\.|requests\.(get|post)|urllib|"
    r"API_KEY|SECRET|password\s*=|deploy_without_approval)\b",
    re.I,
)


def run_guardian(
    *,
    prompt: str,
    source_code: str,
    test_code: str,
    tools: list[str],
    autonomy: str,
    language: str = "es",
) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    es = language == "es"

    findings.append({
        "severity": "info",
        "code": "HUMAN_GATE",
        "message": "Guardian exige aprobación humana antes de activar el agente." if es
        else "Guardian requires human approval before activating the agent.",
    })

    for tool in tools:
        if tool not in ALLOWED_TOOLS:
            findings.append({
                "severity": "block",
                "code": "TOOL_NOT_ALLOWLISTED",
                "message": (f"Herramienta no autorizada: {tool}" if es else f"Tool not allowlisted: {tool}"),
            })

    for capability in BLOCKED_CAPABILITIES:
        pattern = re.compile(capability.replace("_", r"[_\s-]*"), re.I)
        if pattern.search(prompt) and re.search(r"permit|allow|habilita|permite|sin aprob", prompt, re.I):
            findings.append({
                "severity": "block",
                "code": f"BLOCK_{capability.upper()}",
                "message": (f"El prompt pide capacidad bloqueada: {capability}" if es
                            else f"Prompt requests blocked capability: {capability}"),
            })

    blob = f"{prompt}\n{source_code}\n{test_code}"
    if UNSAFE_PATTERN.search(blob):
        findings.append({
            "severity": "block",
            "code": "UNSAFE_CODE_PATTERN",
            "message": "Guardian bloqueó patrones inseguros." if es else "Guardian blocked unsafe patterns.",
        })

    if autonomy != "supervised":
        findings.append({
            "severity": "block",
            "code": "AUTONOMY_LIMIT",
            "message": "Solo agentes supervisados en Fase 1." if es else "Only supervised agents in Phase 1.",
        })

    blocked = any(item["severity"] == "block" for item in findings)
    if not blocked:
        findings.append({
            "severity": "info",
            "code": "SANDBOX_ONLY",
            "message": "El agente solo puede proponer; no despliega ni gasta sin tu OK." if es
            else "The agent may only propose; it cannot deploy or spend without your OK.",
        })

    return {
        "requiresHumanApproval": True,
        "blockedCapabilities": BLOCKED_CAPABILITIES,
        "findings": findings,
        "passed": not blocked,
    }
