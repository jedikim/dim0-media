"""Router tests for the /utils/ping liveness endpoint."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from topix.api.router.utils import router


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_ping_returns_204_with_empty_body():
    """The ping endpoint replies 204 No Content — used by the connection-state detector."""
    client = _build_client()

    response = client.get("/utils/ping")

    assert response.status_code == 204
    assert response.text == ""


def test_ping_requires_no_auth_header():
    """Ping is unauthenticated so a frozen client can probe without a valid JWT."""
    client = _build_client()

    response = client.get("/utils/ping")

    assert response.status_code == 204


def test_ping_is_cheap_get_only():
    """POST/PUT/DELETE on /utils/ping should not be routed."""
    client = _build_client()

    assert client.post("/utils/ping").status_code in (404, 405)
    assert client.delete("/utils/ping").status_code in (404, 405)
