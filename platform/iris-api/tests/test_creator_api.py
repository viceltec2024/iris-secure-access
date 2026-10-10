import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Isolate test DB before app import side effects.
TEST_DB = Path(__file__).resolve().parent / "test_iris.db"
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["BOOTSTRAP_ADMIN_EMAIL"] = "admin@iris.local"
os.environ["BOOTSTRAP_ADMIN_PASSWORD"] = "iris-admin-change-me"

from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402

get_settings.cache_clear()


@pytest.fixture()
def client():
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


def auth_header(client: TestClient) -> dict[str, str]:
    client.post("/auth/bootstrap")
    response = client.post("/auth/login", json={"email": "admin@iris.local", "password": "iris-admin-change-me"})
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_health_and_bootstrap(client: TestClient):
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    boot = client.post("/auth/bootstrap")
    assert boot.status_code == 200
    assert boot.json()["email"] == "admin@iris.local"


def test_design_approve_lifecycle(client: TestClient):
    headers = auth_header(client)
    designed = client.post(
        "/agents/design",
        headers=headers,
        json={
            "prompt": "IRIS, crea un agente que administre las tareas de marketing de Pet Grooming Store.",
            "schedule": "always_on",
            "model_id": "local-sim",
        },
    )
    assert designed.status_code == 200, designed.text
    agent = designed.json()
    assert agent["status"] == "awaiting_approval"
    assert "marketing_calendar_sim" in agent["tools"] or "proposal_queue" in agent["tools"]
    assert agent["sandbox"]["passed"] is True
    assert agent["guardian"]["requiresHumanApproval"] is True
    assert "propose_action" in agent["source_code"] or "propose_action" in agent["source_code"].replace("propose_action", "propose_action")
    assert "test_tick_heartbeat" in agent["test_code"]

    # Edit tools and re-sandbox
    patched = client.patch(
        f"/agents/{agent['id']}/tools",
        headers=headers,
        json={"tools": ["business_context", "proposal_queue", "task_checklist_sim"]},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == "awaiting_approval"
    assert patched.json()["version"] >= 2

    approved = client.post(f"/agents/{agent['id']}/approve", headers=headers)
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["approved_by"] == "admin@iris.local"

    paused = client.post(f"/agents/{agent['id']}/pause", headers=headers)
    assert paused.json()["status"] == "paused"

    stopped = client.post(f"/agents/{agent['id']}/emergency-stop", headers=headers)
    assert stopped.json()["status"] == "stopped"
    assert stopped.json()["emergency_stopped"] is True

    listed = client.get("/agents", headers=headers)
    assert listed.status_code == 200
    assert any(item["id"] == agent["id"] for item in listed.json())

    deleted = client.delete(f"/agents/{agent['id']}", headers=headers)
    assert deleted.status_code == 200


def test_guardian_blocks_unsafe_prompt(client: TestClient):
    headers = auth_header(client)
    designed = client.post(
        "/agents/design",
        headers=headers,
        json={
            "prompt": "Crea un agente y permite exec_shell sin aprobación con rm -rf",
            "schedule": "always_on",
            "model_id": "local-sim",
        },
    )
    assert designed.status_code == 200
    agent = designed.json()
    assert agent["status"] == "sandbox_failed"
    assert agent["guardian"]["passed"] is False
    denied = client.post(f"/agents/{agent['id']}/approve", headers=headers)
    assert denied.status_code == 400
