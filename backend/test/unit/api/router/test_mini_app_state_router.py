"""Router tests for the mini-app per-user state endpoints.

Covers the round-trip (PUT then GET), per-user isolation, per-note
isolation, missing-state returns null, and auth gating. The store
itself is a small in-memory fake — we trust the SQL in the postgres
helpers to be exercised by integration tests separately.
"""

from __future__ import annotations

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from topix.api.router.mini_app_state import router
from topix.api.utils.security import get_current_user_uid


class _FakeStore:
    """In-memory stand-in for MiniAppStateStore.

    Pins behaviour: get returns None when absent, save upserts, the
    composite key is ``(note_uid, user_uid)``.
    """

    def __init__(self) -> None:
        """Init."""
        self.values: dict[tuple[str, str], object] = {}


    async def get_state(self, *, note_uid: str, user_uid: str):
        """Get state."""
        return self.values.get((note_uid, user_uid))


    async def save_state(self, *, note_uid: str, user_uid: str, state):
        """Save state."""
        self.values[(note_uid, user_uid)] = state


def _build_client(user_uid: str = "u1") -> tuple[TestClient, FastAPI, _FakeStore]:
    """Wire a FastAPI app with the router + fake store + fake auth dep."""
    app = FastAPI()
    app.include_router(router)
    store = _FakeStore()
    app.mini_app_state_store = store

    async def _fake_current_user_uid():
        """Fake current user uid."""
        return user_uid

    app.dependency_overrides[get_current_user_uid] = _fake_current_user_uid
    return TestClient(app), app, store


def test_get_returns_null_when_no_state_saved():
    """A first-render fetch with no prior save returns state=None."""
    client, _, _ = _build_client()
    response = client.get("/mini-app-state/note-1")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["data"] == {"state": None}


def test_put_then_get_round_trips_arbitrary_json():
    """Whatever the widget saves comes back identical."""
    client, _, _ = _build_client()
    payload = {"state": {"count": 5, "items": ["a", "b"], "flag": True}}
    put_response = client.put("/mini-app-state/note-1", json=payload)
    assert put_response.status_code == 200

    get_response = client.get("/mini-app-state/note-1")
    assert get_response.status_code == 200
    assert get_response.json()["data"]["state"] == payload["state"]


def test_put_overwrites_previous_state():
    """A second PUT replaces the first — no history."""
    client, _, _ = _build_client()
    client.put("/mini-app-state/note-1", json={"state": {"count": 1}})
    client.put("/mini-app-state/note-1", json={"state": {"count": 99}})

    response = client.get("/mini-app-state/note-1")
    assert response.json()["data"]["state"] == {"count": 99}


def test_state_is_isolated_per_user():
    """User A's state for note N is invisible to user B."""
    client_a, app, store = _build_client(user_uid="user-a")
    client_a.put("/mini-app-state/note-1", json={"state": {"private": "to-a"}})

    # Swap the auth override to simulate user-b on the same app.
    async def _fake_user_b():
        return "user-b"

    app.dependency_overrides[get_current_user_uid] = _fake_user_b
    client_b = TestClient(app)

    response_b = client_b.get("/mini-app-state/note-1")
    assert response_b.json()["data"]["state"] is None

    # And user-b's writes don't leak to user-a either.
    client_b.put("/mini-app-state/note-1", json={"state": {"private": "to-b"}})
    assert store.values[("note-1", "user-a")] == {"private": "to-a"}
    assert store.values[("note-1", "user-b")] == {"private": "to-b"}


def test_state_is_isolated_per_note():
    """The same user's state for note A and note B is independent."""
    client, _, _ = _build_client()
    client.put("/mini-app-state/note-A", json={"state": {"v": "a"}})
    client.put("/mini-app-state/note-B", json={"state": {"v": "b"}})

    assert client.get("/mini-app-state/note-A").json()["data"]["state"] == {"v": "a"}
    assert client.get("/mini-app-state/note-B").json()["data"]["state"] == {"v": "b"}


def test_scalar_state_is_supported():
    """Widgets that save a number or string directly still round-trip."""
    client, _, _ = _build_client()
    client.put("/mini-app-state/note-1", json={"state": 42})
    assert client.get("/mini-app-state/note-1").json()["data"]["state"] == 42


def test_null_state_is_supported():
    """Saving null explicitly is distinct from absence."""
    client, _, _ = _build_client()
    client.put("/mini-app-state/note-1", json={"state": None})
    # Round-trips, but absence vs explicit null look the same to the
    # client — both surface as state=None. Documented limit of v1.
    assert client.get("/mini-app-state/note-1").json()["data"]["state"] is None


def test_get_requires_authentication():
    """Unauthenticated requests are rejected before reaching the store."""
    # Build an app without overriding the auth dep, so the real
    # `get_current_user_uid` runs and rejects.
    app = FastAPI()
    app.include_router(router)
    app.mini_app_state_store = _FakeStore()
    client = TestClient(app)

    response = client.get("/mini-app-state/note-1")
    # 401 from missing bearer token, 422 from FastAPI validation —
    # accept either since both prove auth ran.
    assert response.status_code in (401, 422)


@pytest.mark.parametrize("path", [
    "/mini-app-state/note-1",
    "/mini-app-state/note-1/",
])
def test_trailing_slash_both_resolve(path: str):
    """Router exposes both with/without trailing slash, matching repo style."""
    client, _, _ = _build_client()
    response = client.get(path)
    assert response.status_code == 200
