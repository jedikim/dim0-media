"""Router tests for the browser-agent chat transcript endpoints (Phase 2).

Covers the round-trip (PUT then GET-by-board), verbatim storage of client-only
shapes that would NOT validate against the server ``Message`` model (the whole
point of storing opaque JSON), full-replace on re-PUT, owner isolation, board
filtering, and auth gating. The store is a small in-memory fake — the SQL in
the postgres helper is exercised by integration tests separately.
"""

from __future__ import annotations

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from topix.api.router.chats import router
from topix.api.utils.security import get_current_user_uid


class _FakeStore:
    """In-memory stand-in for ChatStore's transcript methods.

    Pins behaviour: composite key ``(chat_uid, user_uid)``, full-replace on
    upsert, non-null label never regresses, list filters by ``board_id`` and is
    scoped to the caller.
    """

    def __init__(self) -> None:
        """Init."""
        self.rows: dict[tuple[str, str], dict] = {}


    async def upsert_transcript(self, chat_uid, user_uid, board_id, label, transcript):
        """Insert or replace a transcript row (mirrors the SQL upsert)."""
        prev = self.rows.get((chat_uid, user_uid))
        kept_label = label if label is not None else (prev or {}).get("label")
        self.rows[(chat_uid, user_uid)] = {
            "chat_uid": chat_uid,
            "board_id": board_id,
            "label": kept_label,
            "transcript": transcript,
        }


    async def list_transcripts_by_board(self, user_uid, board_id):
        """Return the caller's rows for a board, shape matching the helper."""
        return [
            {
                "chat_uid": r["chat_uid"],
                "label": r["label"],
                "transcript": r["transcript"],
                "updated_at": None,
            }
            for (_, u), r in self.rows.items()
            if u == user_uid and r["board_id"] == board_id
        ]


def _build_client(user_uid: str = "u1") -> tuple[TestClient, FastAPI, _FakeStore]:
    """Wire a FastAPI app with the chats router + fake store + fake auth dep."""
    app = FastAPI()
    app.include_router(router)
    store = _FakeStore()
    app.chat_store = store

    async def _fake_current_user_uid():
        """Fake current user uid."""
        return user_uid

    app.dependency_overrides[get_current_user_uid] = _fake_current_user_uid
    return TestClient(app), app, store


# A transcript whose tool-call steps use client-only tool names (`fetch`,
# `doc_search`) and a client-only output shape — exactly what would fail the
# server's strict `AgentToolName`/`ToolOutput` validation. Storing it verbatim
# is the reason for the opaque-blob design.
_CLIENT_TRANSCRIPT = [
    {"id": "m1", "role": "user", "content": {"markdown": "hi"}},
    {
        "id": "m2",
        "role": "assistant",
        "content": {"markdown": "done"},
        "properties": {
            "reasoning": {
                "type": "reasoning",
                "reasoning": [
                    {
                        "type": "tool_call",
                        "id": "t1",
                        "name": "fetch",
                        "thought": "look it up",
                        "output": {"kind": "doc_search", "references": [{"noteId": "n1"}]},
                        "state": "completed",
                        "eventMessages": ["searched"],
                    }
                ],
            }
        },
    },
]


def test_put_then_list_round_trips_client_only_shapes():
    """The transcript comes back byte-for-byte, incl. fetch/doc_search steps."""
    client, _, _ = _build_client()
    put = client.put(
        "/chats/chat-1/transcript",
        json={"transcript": _CLIENT_TRANSCRIPT, "board_id": "b1", "label": "My chat"},
    )
    assert put.status_code == 200
    assert put.json()["data"] == {"chat_id": "chat-1", "stored": 2}

    got = client.get("/chats/transcripts", params={"board_id": "b1"})
    assert got.status_code == 200
    rows = got.json()["data"]["transcripts"]
    assert len(rows) == 1
    assert rows[0]["chat_uid"] == "chat-1"
    assert rows[0]["label"] == "My chat"
    # Verbatim — no coercion, no dropped fields.
    assert rows[0]["transcript"] == _CLIENT_TRANSCRIPT


def test_reput_replaces_transcript_and_keeps_label():
    """A second PUT replaces the messages; a null label doesn't wipe the old."""
    client, _, _ = _build_client()
    client.put(
        "/chats/chat-1/transcript",
        json={"transcript": _CLIENT_TRANSCRIPT, "board_id": "b1", "label": "Keep me"},
    )
    client.put(
        "/chats/chat-1/transcript",
        json={"transcript": [{"id": "m9", "role": "user", "content": {"markdown": "again"}}], "board_id": "b1"},
    )

    rows = client.get("/chats/transcripts", params={"board_id": "b1"}).json()["data"]["transcripts"]
    assert len(rows) == 1
    assert [m["id"] for m in rows[0]["transcript"]] == ["m9"]
    assert rows[0]["label"] == "Keep me"


def test_transcripts_are_isolated_per_owner():
    """User A's transcript is invisible to user B."""
    client_a, app, store = _build_client(user_uid="user-a")
    client_a.put(
        "/chats/chat-1/transcript",
        json={"transcript": _CLIENT_TRANSCRIPT, "board_id": "b1"},
    )

    async def _fake_user_b():
        """Fake auth for a second user on the same app."""
        return "user-b"

    app.dependency_overrides[get_current_user_uid] = _fake_user_b
    client_b = TestClient(app)

    rows_b = client_b.get("/chats/transcripts", params={"board_id": "b1"}).json()["data"]["transcripts"]
    assert rows_b == []
    # A's row is untouched.
    assert ("chat-1", "user-a") in store.rows


def test_list_filters_by_board():
    """Only the requested board's transcripts are returned."""
    client, _, _ = _build_client()
    client.put("/chats/chat-1/transcript", json={"transcript": _CLIENT_TRANSCRIPT, "board_id": "b1"})
    client.put("/chats/chat-2/transcript", json={"transcript": _CLIENT_TRANSCRIPT, "board_id": "b2"})

    rows = client.get("/chats/transcripts", params={"board_id": "b1"}).json()["data"]["transcripts"]
    assert [r["chat_uid"] for r in rows] == ["chat-1"]


def test_list_requires_authentication():
    """Unauthenticated requests are rejected before reaching the store."""
    app = FastAPI()
    app.include_router(router)
    app.chat_store = _FakeStore()
    client = TestClient(app)

    response = client.get("/chats/transcripts", params={"board_id": "b1"})
    assert response.status_code in (401, 422)


@pytest.mark.parametrize("path", ["/chats/transcripts", "/chats/transcripts/"])
def test_trailing_slash_both_resolve(path: str):
    """Router exposes both with/without trailing slash, matching repo style."""
    client, _, _ = _build_client()
    response = client.get(path, params={"board_id": "b1"})
    assert response.status_code == 200
