import json
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

from .config import get_settings


def run_isolated_tests(*, source_code: str, test_code: str) -> dict:
    """Run generated tests in a disposable directory via a short-lived subprocess.

    No network flags are passed; the child only imports the generated module.
    This is NOT a full container sandbox — Docker isolation arrives in a later phase.
    """
    settings = get_settings()
    checks: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="iris-sandbox-") as tmp:
        root = Path(tmp)
        (root / "agent_module.py").write_text(source_code, encoding="utf-8")
        (root / "test_agent.py").write_text(test_code, encoding="utf-8")
        runner = root / "runner.py"
        runner.write_text(
            textwrap.dedent(
                """
                import json
                import traceback
                import agent_module
                import test_agent

                results = []
                for name in ("test_agent_is_supervised", "test_propose_requires_approval", "test_tick_heartbeat"):
                    fn = getattr(test_agent, name, None)
                    try:
                        if not callable(fn):
                            raise AssertionError("missing test")
                        fn()
                        results.append({"id": name, "label": name, "ok": True, "detail": "passed"})
                    except Exception as exc:  # noqa: BLE001 — sandbox captures all failures
                        results.append({
                            "id": name,
                            "label": name,
                            "ok": False,
                            "detail": f"{type(exc).__name__}: {exc}",
                        })
                print(json.dumps({"checks": results, "module_tools": sorted(agent_module.AGENT.get("tools") or [])}))
                """
            ).strip(),
            encoding="utf-8",
        )
        try:
            completed = subprocess.run(
                [sys.executable, str(runner)],
                cwd=str(root),
                capture_output=True,
                text=True,
                timeout=settings.sandbox_timeout_seconds,
                check=False,
                env={
                    "PATH": "/usr/bin:/bin",
                    "PYTHONPATH": str(root),
                    "PYTHONDONTWRITEBYTECODE": "1",
                },
            )
        except subprocess.TimeoutExpired:
            return {
                "ranAt": _now(),
                "passed": False,
                "mode": "subprocess_isolated",
                "checks": [{
                    "id": "timeout",
                    "label": "Sandbox timeout",
                    "ok": False,
                    "detail": f"Exceeded {settings.sandbox_timeout_seconds}s",
                }],
                "stdout": "",
                "stderr": "timeout",
            }

        payload = {}
        if completed.stdout.strip():
            try:
                payload = json.loads(completed.stdout.strip().splitlines()[-1])
            except json.JSONDecodeError:
                payload = {}
        checks = list(payload.get("checks") or [])
        if completed.returncode != 0 and not checks:
            checks = [{
                "id": "runner",
                "label": "Sandbox runner",
                "ok": False,
                "detail": (completed.stderr or completed.stdout or "runner failed")[:400],
            }]
        passed = bool(checks) and all(item.get("ok") for item in checks) and completed.returncode == 0
        return {
            "ranAt": _now(),
            "passed": passed,
            "mode": "subprocess_isolated",
            "checks": checks,
            "stdout": completed.stdout[-1000:],
            "stderr": completed.stderr[-1000:],
        }


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
