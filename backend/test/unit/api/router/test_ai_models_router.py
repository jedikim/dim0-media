"""The public model catalog (`GET /ai/models`) — no auth, all declared models."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from topix.api.router.ai import router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_models_are_listed_without_auth():
    """The catalog is public (no token) and carries id/label/routes per model."""
    res = _client().get("/ai/models")  # no Authorization header
    assert res.status_code == 200
    llm = res.json()["data"]["llm"]
    assert len(llm) > 0
    first = llm[0]
    assert {"id", "label", "family", "tier", "routes"} <= set(first)
    # routes carry the per-provider model strings a BYOK caller sends
    assert all("via" in r and "model" in r for r in first["routes"])
