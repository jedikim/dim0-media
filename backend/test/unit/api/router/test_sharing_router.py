"""Router tests for the sharing endpoints — gating + body validation."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from topix.api.router.sharing import router
from topix.api.utils.security import get_current_user_uid, verify_board_owner
from topix.collab.room import RoomRegistry


class _AsyncAcquire:
    """asyncpg pool.acquire() returns this; it's an async context manager."""

    def __init__(self, conn):
        """Init."""
        self._conn = conn

    async def __aenter__(self):
        """Aenter."""
        return self._conn

    async def __aexit__(self, *args):
        """Aexit."""
        return False


class _FakePool:
    def __init__(self, conn):
        """Init."""
        self._conn = conn

    def acquire(self):
        """Acquire."""
        return _AsyncAcquire(self._conn)


class _FakeGraphStore:
    def __init__(self):
        """Init."""
        self.fake_conn = AsyncMock()
        self._pg_pool = _FakePool(self.fake_conn)
        # Per-user-uid role for testing the remove-member endpoint's
        # "owner can't be removed" guard.
        self.roles_by_uid: dict[str, str] = {"u1": "owner"}
        # Programmable list_members + remove_member behaviour.
        self.list_members_result: list = []
        self.remove_count: int = 1

    async def get_graph_role(self, graph_uid, user_uid):
        """Get graph role."""
        return self.roles_by_uid.get(user_uid)

    async def list_members(self, graph_uid):
        """List members."""
        return self.list_members_result

    async def remove_member(self, graph_uid, user_uid):
        """Remove member."""
        return self.remove_count


def _build_client(*, user_uid: str = "u1", is_owner: bool = True) -> tuple[TestClient, FastAPI]:
    """Build client."""
    app = FastAPI()
    app.include_router(router)
    app.graph_store = _FakeGraphStore()
    app.collab_rooms = RoomRegistry()

    async def _fake_current_user_uid():
        """Fake current user uid."""
        return user_uid

    async def _fake_verify_owner():
        """Fake verify owner."""
        if not is_owner:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Board not found")

    app.dependency_overrides[get_current_user_uid] = _fake_current_user_uid
    app.dependency_overrides[verify_board_owner] = _fake_verify_owner
    return TestClient(app), app


# ---------------------------------------------------------------------------
# Owner endpoints
# ---------------------------------------------------------------------------


def test_mint_share_link_returns_token(monkeypatch):
    """Mint share link returns token."""
    from topix.api.router import sharing as sharing_router

    monkeypatch.setattr(
        sharing_router.links, "mint_link", AsyncMock(return_value="abc123token"),
    )

    client, _ = _build_client()
    response = client.post("/boards/b1/share-links", json={"role": "member"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["data"]["token"] == "abc123token"
    assert body["data"]["role"] == "member"


def test_mint_share_link_rejects_invalid_role(monkeypatch):
    """Mint share link rejects invalid role."""
    from topix.api.router import sharing as sharing_router

    monkeypatch.setattr(sharing_router.links, "mint_link", AsyncMock())

    client, _ = _build_client()
    response = client.post("/boards/b1/share-links", json={"role": "admin"})

    assert response.status_code == 400


def test_mint_share_link_rejected_when_not_owner():
    """Mint share link rejected when not owner."""
    client, _ = _build_client(is_owner=False)
    response = client.post("/boards/b1/share-links", json={"role": "member"})

    # verify_board_owner returns 404 to avoid leaking existence.
    assert response.status_code == 404


def test_list_share_links_returns_active_set(monkeypatch):
    """List share links returns active set."""
    from topix.api.router import sharing as sharing_router

    monkeypatch.setattr(
        sharing_router.links, "list_active_links",
        AsyncMock(return_value=[
            {"token": "t1", "role": "member", "created_at": "2026-05-28T10:00:00"},
            {"token": "t2", "role": "viewer", "created_at": "2026-05-28T09:00:00"},
        ]),
    )

    client, _ = _build_client()
    response = client.get("/boards/b1/share-links")

    assert response.status_code == 200
    body = response.json()
    assert len(body["data"]["links"]) == 2
    assert body["data"]["links"][0]["token"] == "t1"


def test_delete_share_link_revokes(monkeypatch):
    """Delete share link revokes."""
    from topix.api.router import sharing as sharing_router

    revoke_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(sharing_router.links, "revoke", revoke_mock)

    client, _ = _build_client()
    response = client.delete("/boards/b1/share-links/some-token")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["revoked"] is True
    revoke_mock.assert_awaited_once()


def test_revoke_all_share_links_returns_count(monkeypatch):
    """Revoke all share links returns count."""
    from topix.api.router import sharing as sharing_router

    monkeypatch.setattr(
        sharing_router.links, "revoke_all", AsyncMock(return_value=3),
    )

    client, _ = _build_client()
    response = client.delete("/boards/b1/share-links")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["revoked_count"] == 3


# ---------------------------------------------------------------------------
# Recipient endpoints
# ---------------------------------------------------------------------------


def test_preview_returns_graph_uid_and_role(monkeypatch):
    """Preview returns graph uid and role."""
    from topix.api.router import sharing as sharing_router

    monkeypatch.setattr(
        sharing_router.links, "preview",
        AsyncMock(return_value={"graph_uid": "b1", "role": "viewer"}),
    )

    client, _ = _build_client()
    response = client.get("/share-links/some-token/preview")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["graph_uid"] == "b1"
    assert body["data"]["role"] == "viewer"


def test_preview_404_when_token_unknown(monkeypatch):
    """Preview 404 when token unknown."""
    from topix.api.router import sharing as sharing_router

    monkeypatch.setattr(sharing_router.links, "preview", AsyncMock(return_value=None))

    client, _ = _build_client()
    response = client.get("/share-links/nope/preview")

    assert response.status_code == 404


def test_accept_creates_membership_and_returns_role(monkeypatch):
    """Accept creates membership and returns role."""
    from topix.api.router import sharing as sharing_router

    monkeypatch.setattr(
        sharing_router.acceptance, "accept_link",
        AsyncMock(return_value={
            "graph_uid": "b1", "role": "member", "already_member": False,
        }),
    )

    client, _ = _build_client()
    response = client.post("/share-links/some-token/accept")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["graph_uid"] == "b1"
    assert body["data"]["role"] == "member"
    assert body["data"]["already_member"] is False


def test_accept_404_when_token_unknown(monkeypatch):
    """Accept 404 when token unknown."""
    from topix.api.router import sharing as sharing_router

    monkeypatch.setattr(sharing_router.acceptance, "accept_link", AsyncMock(return_value=None))

    client, _ = _build_client()
    response = client.post("/share-links/nope/accept")

    assert response.status_code == 404


def test_accept_requires_authentication():
    """Without get_current_user_uid override, the endpoint should 401."""
    app = FastAPI()
    app.include_router(router)
    app.graph_store = _FakeGraphStore()
    client = TestClient(app)

    response = client.post("/share-links/some-token/accept")

    # No JWT → OAuth2PasswordBearer raises 401.
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Member listing + removal (Slice 3)
# ---------------------------------------------------------------------------


def test_list_members_returns_ordered_list():
    """List members returns ordered list."""
    client, app = _build_client()
    app.graph_store.list_members_result = [
        {"user_uid": "u1", "email": "alice@x.com", "role": "owner", "joined_at": "2026-01-01"},
        {"user_uid": "u2", "email": "bob@x.com", "role": "member", "joined_at": "2026-01-02"},
        {"user_uid": "u3", "email": "carol@x.com", "role": "viewer", "joined_at": "2026-01-03"},
    ]

    response = client.get("/boards/b1/members")

    assert response.status_code == 200
    body = response.json()
    assert [m["role"] for m in body["data"]["members"]] == ["owner", "member", "viewer"]
    assert body["data"]["members"][0]["email"] == "alice@x.com"


def test_list_members_rejected_when_not_owner():
    """List members rejected when not owner."""
    client, _ = _build_client(is_owner=False)
    response = client.get("/boards/b1/members")
    assert response.status_code == 404


def test_remove_member_drops_row_and_returns_kick_count():
    """Remove member drops row and returns kick count."""
    client, app = _build_client()
    # Target user is a regular member, not the owner.
    app.graph_store.roles_by_uid = {"u1": "owner", "u9": "member"}

    response = client.delete("/boards/b1/members/u9")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["removed"] is True
    # No live socket for u9 in the registry → kicked_sessions == 0.
    assert body["data"]["kicked_sessions"] == 0


def test_remove_member_kicks_live_sockets():
    """A member with an open WS session loses it on remove."""
    client, app = _build_client()
    app.graph_store.roles_by_uid = {"u1": "owner", "u9": "member"}

    # Seed the registry with a live "session" for u9.
    import asyncio

    class _FakeSocket:
        def __init__(self):
            """Init."""
            self.sent: list[str] = []
            self.close_calls: list = []

        async def send_text(self, raw):
            """Send text."""
            self.sent.append(raw)

        async def close(self, *, code=1000, reason=""):
            """Close."""
            self.close_calls.append({"code": code, "reason": reason})

    sock = _FakeSocket()

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(app.collab_rooms.join("b1", sock, "u9"))
    finally:
        loop.close()

    response = client.delete("/boards/b1/members/u9")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["kicked_sessions"] == 1
    assert len(sock.sent) == 1
    import json as _json
    assert _json.loads(sock.sent[0]) == {"kind": "kick", "reason": "access-revoked"}
    assert sock.close_calls[0]["reason"] == "access-revoked"


def test_remove_owner_returns_400():
    """Remove owner returns 400."""
    client, app = _build_client()
    # u1 IS the owner; removing them should be refused with 400.
    app.graph_store.roles_by_uid = {"u1": "owner"}

    response = client.delete("/boards/b1/members/u1")

    assert response.status_code == 400


def test_remove_unknown_member_returns_404():
    """Remove unknown member returns 404."""
    client, app = _build_client()
    # u9 has no role on the board.
    app.graph_store.roles_by_uid = {"u1": "owner"}
    app.graph_store.remove_count = 0

    response = client.delete("/boards/b1/members/u9")

    assert response.status_code == 404


def test_remove_member_rejected_when_caller_is_not_owner():
    """Remove member rejected when caller is not owner."""
    client, _ = _build_client(is_owner=False)
    response = client.delete("/boards/b1/members/u9")
    assert response.status_code == 404
