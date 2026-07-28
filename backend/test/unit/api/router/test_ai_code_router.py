"""Unit tests for the managed code-interpreter proxy (`POST /ai/code`).

Monkeypatches `execute_code` so the endpoint's mapping is exercised without a
real Daytona sandbox.
"""

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

import topix.api.router.ai as ai_module

from topix.api.router.ai import meter_run, router
from topix.api.utils.security import get_current_user_uid


async def _no_meter() -> None:
    return None


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _uid():
        return "user-1"

    app.dependency_overrides[get_current_user_uid] = _uid
    app.dependency_overrides[meter_run] = _no_meter
    return TestClient(app)


def test_code_run_maps_the_execution_result(monkeypatch):
    """A successful run maps status/stdout/stderr/duration_ms through."""
    calls = {}

    async def _fake(code, language="python", api_key=None):
        calls["code"] = code
        calls["language"] = language
        return SimpleNamespace(status="success", stdout="42\n", stderr="", duration_ms=12)

    monkeypatch.setattr(ai_module, "execute_code", _fake)

    res = _client().post("/ai/code", json={"code": "print(6*7)", "language": "python"})
    assert res.status_code == 200
    data = res.json()["data"]
    assert data == {"status": "success", "stdout": "42\n", "stderr": "", "duration_ms": 12}
    assert calls == {"code": "print(6*7)", "language": "python"}


def test_code_relays_the_byok_daytona_key(monkeypatch):
    """An `X-Provider-Key` header is forwarded to `execute_code` (BYOK relay)."""
    seen = {}

    async def _fake(code, language="python", api_key=None):
        seen["api_key"] = api_key
        return SimpleNamespace(status="success", stdout="", stderr="", duration_ms=1)

    monkeypatch.setattr(ai_module, "execute_code", _fake)
    _client().post("/ai/code", json={"code": "1+1"}, headers={"X-Provider-Key": "dtn-user"})
    assert seen["api_key"] == "dtn-user"


def test_code_defaults_language_to_python(monkeypatch):
    """Omitting language runs python."""
    seen = {}

    async def _fake(code, language="python", api_key=None):
        seen["language"] = language
        return SimpleNamespace(status="success", stdout="", stderr="", duration_ms=1)

    monkeypatch.setattr(ai_module, "execute_code", _fake)
    _client().post("/ai/code", json={"code": "1+1"})
    assert seen["language"] == "python"


def test_code_error_result_is_passed_through(monkeypatch):
    """An error result (e.g. bad language / unconfigured Daytona) maps through as-is."""
    async def _fake(code, language="python", api_key=None):
        return SimpleNamespace(status="error", stdout="", stderr="boom", duration_ms=3)

    monkeypatch.setattr(ai_module, "execute_code", _fake)
    res = _client().post("/ai/code", json={"code": "x", "language": "python"})
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["status"] == "error"
    assert data["stderr"] == "boom"
