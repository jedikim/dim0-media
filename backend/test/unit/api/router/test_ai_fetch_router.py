"""Unit tests for the managed fetch proxy (`POST /ai/fetch`).

Monkeypatches `fetch_content` so the endpoint's mapping is exercised without a
real HTTP fetch.
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


def test_fetch_maps_first_result_to_page_content(monkeypatch):
    """The first extracted result maps to {url, title, text}."""
    seen = {}

    async def _fake(url, api_key=None):
        seen["url"] = url
        return SimpleNamespace(
            answer="",
            search_results=[SimpleNamespace(url=url, title="A Title", content="the page body")],
        )

    monkeypatch.setattr(ai_module, "fetch_content", _fake)

    res = _client().post("/ai/fetch", json={"url": "https://a.com/x"})
    assert res.status_code == 200
    data = res.json()["data"]
    assert data == {"url": "https://a.com/x", "title": "A Title", "text": "the page body"}
    assert seen["url"] == "https://a.com/x"


def test_fetch_falls_back_to_answer_when_no_results(monkeypatch):
    """No extracted results → text falls back to the output answer, title None."""
    async def _fake(url, api_key=None):
        return SimpleNamespace(answer="fallback text", search_results=[])

    monkeypatch.setattr(ai_module, "fetch_content", _fake)
    res = _client().post("/ai/fetch", json={"url": "https://a.com"})
    data = res.json()["data"]
    assert data["title"] is None
    assert data["text"] == "fallback text"


def test_fetch_relays_the_byok_key(monkeypatch):
    """An `X-Provider-Key` header is forwarded to `fetch_content` (BYOK relay)."""
    seen = {}

    async def _fake(url, api_key=None):
        seen["api_key"] = api_key
        return SimpleNamespace(answer="x", search_results=[])

    monkeypatch.setattr(ai_module, "fetch_content", _fake)
    _client().post("/ai/fetch", json={"url": "https://a.com"}, headers={"X-Provider-Key": "tvly-user"})
    assert seen["api_key"] == "tvly-user"
