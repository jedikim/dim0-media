"""Router tests for the collab ticket mint endpoint and the WS relay."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from topix.api.router.collab import router
from topix.api.utils.security import get_current_user_uid
from topix.collab.room import RoomRegistry
from topix.collab.tickets import mint_ticket


class _FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    async def set(self, key, value, ex=None):
        self.store[key] = value

    async def getdel(self, key):
        return self.store.pop(key, None)


class _FakeRedisStore:
    def __init__(self):
        self.redis = _FakeRedis()


class _FakeGraphStore:
    """Stub GraphStore covering the surface the collab router actually uses.

    Records every mutating call so op-flow tests can assert that
    `apply_batch` reached the underlying store.
    """

    def __init__(self, role: str = "owner", owner_uid: str = "u1"):
        self.role = role
        self.owner_uid = owner_uid
        self.patch_calls: list = []
        self.add_notes_calls: list = []
        self.delete_node_calls: list = []
        self.add_links_calls: list = []
        self.update_link_calls: list = []
        self.delete_link_calls: list = []

    async def get_graph_role(self, graph_uid: str, user_uid: str) -> str | None:
        return self.role

    async def get_owner_uid(self, graph_uid: str) -> str | None:
        return self.owner_uid

    async def get_graph(self, *, graph_uid: str, root_id: str | None = None):
        # Empty board — welcome.snapshot will be {}.
        return None

    async def patch_note(self, *, node_id, data, user_uid):
        self.patch_calls.append({"node_id": node_id, "data": data, "user_uid": user_uid})

    async def add_notes(self, *, nodes):
        self.add_notes_calls.append(nodes)

    async def delete_node(self, *, node_id, user_uid):
        self.delete_node_calls.append({"node_id": node_id, "user_uid": user_uid})

    async def add_links(self, *, links):
        self.add_links_calls.append(links)

    async def update_link(self, *, link_id, data):
        self.update_link_calls.append({"link_id": link_id, "data": data})

    async def delete_link(self, *, link_id):
        self.delete_link_calls.append(link_id)

    # Bulk methods — apply_batch now dispatches per-kind grouped. Each
    # bulk call records one entry per item into the existing per-op
    # lists so router-level assertions keep working unchanged.
    async def patch_notes(self, *, updates, user_uid=None):
        for node_id, data in updates:
            self.patch_calls.append({"node_id": node_id, "data": data, "user_uid": user_uid})

    async def delete_nodes(self, *, node_ids, user_uid=None):
        for node_id in node_ids:
            self.delete_node_calls.append({"node_id": node_id, "user_uid": user_uid})

    async def update_links(self, *, updates):
        for link_id, data in updates:
            self.update_link_calls.append({"link_id": link_id, "data": data})

    async def delete_links(self, *, link_ids):
        for link_id in link_ids:
            self.delete_link_calls.append(link_id)


class _FakeUserBillingStore:
    """Stub UserBillingStore — only `get_user_billing` is consulted.

    A None return means the owner has no billing row, which the
    capacity module treats as the free-tier cap (5).
    """

    def __init__(self, plan: str | None = None):
        # If `plan` is None, we behave as "no row" (free default).
        self.plan = plan

    async def get_user_billing(self, user_uid: str):
        if self.plan is None:
            return None
        # Lightweight stand-in for UserBilling — only `.plan` is read.
        class _Billing:
            pass
        b = _Billing()
        b.plan = self.plan
        return b


def _build_app(
    *,
    user_uid: str = "u1",
    role: str = "owner",
    owner_uid: str = "u1",
    plan: str | None = None,
) -> tuple[TestClient, FastAPI]:
    app = FastAPI()
    app.include_router(router)
    app.graph_store = _FakeGraphStore(role=role, owner_uid=owner_uid)
    app.user_billing_store = _FakeUserBillingStore(plan=plan)
    app.redis_store = _FakeRedisStore()
    app.collab_rooms = RoomRegistry()

    async def _fake_current_user_uid():
        return user_uid

    app.dependency_overrides[get_current_user_uid] = _fake_current_user_uid
    return TestClient(app), app


# ---------------------------------------------------------------------------
# Ticket mint endpoint
# ---------------------------------------------------------------------------

def test_mint_ticket_owner_succeeds():
    """An owner of the board can mint a ticket."""
    client, _ = _build_app(role="owner")

    response = client.post("/boards/board-1/collab/ticket")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["data"]["expires_in"] == 30
    assert isinstance(body["data"]["ticket"], str) and body["data"]["ticket"]


def test_mint_ticket_non_member_is_rejected():
    """A user with no role on the board cannot mint a ticket."""
    client, _ = _build_app(role=None)

    response = client.post("/boards/board-1/collab/ticket")

    # verify_board_member returns 404 to avoid existence leaks.
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# WebSocket auth path
# ---------------------------------------------------------------------------

def _expect_ws_close(client: TestClient, url: str, expected_code: int) -> None:
    """Open a WS, expect the server to refuse with `expected_code`.

    Starlette's TestClient raises `WebSocketDisconnect` from
    `websocket_connect`'s `__enter__` when the server closes during the
    upgrade — so the try/except must wrap the `with` block itself.
    """
    from starlette.websockets import WebSocketDisconnect

    try:
        with client.websocket_connect(url):
            pass
    except WebSocketDisconnect as exc:
        assert exc.code == expected_code, f"expected close code {expected_code}, got {exc.code}"
        return
    raise AssertionError(f"expected WebSocketDisconnect({expected_code}) for url={url}")


def test_ws_rejects_missing_ticket():
    """A WS upgrade without a ticket is closed with 4401."""
    client, _ = _build_app()
    _expect_ws_close(client, "/boards/board-1/collab", expected_code=4401)


def test_ws_rejects_invalid_ticket():
    """An unknown ticket is rejected with 4401."""
    client, _ = _build_app()
    _expect_ws_close(client, "/boards/board-1/collab?ticket=nope", expected_code=4401)


def test_ws_rejects_ticket_for_different_board():
    """A ticket minted for board A cannot be used to join board B (4403)."""
    client, app = _build_app()

    import asyncio
    loop = asyncio.new_event_loop()
    try:
        token = loop.run_until_complete(
            mint_ticket(app.redis_store, user_id="u1", board_id="board-a")
        )
    finally:
        loop.close()

    _expect_ws_close(client, f"/boards/board-b/collab?ticket={token}", expected_code=4403)


# ---------------------------------------------------------------------------
# WebSocket relay happy path
# ---------------------------------------------------------------------------

def _mint_tickets(app, role: str = "member", **bindings):
    """Mint many tickets in one synchronous block.

    `role` defaults to "member" so tests of edit paths keep working
    without changes; viewer / owner tests pass it explicitly.
    """
    import asyncio
    loop = asyncio.new_event_loop()
    try:
        return {
            label: loop.run_until_complete(
                mint_ticket(app.redis_store, user_id=user_id, board_id=board_id, role=role)
            )
            for label, (user_id, board_id) in bindings.items()
        }
    finally:
        loop.close()


def _drain_welcome(ws) -> dict:
    """Consume the welcome frame the server sends right after accept."""
    msg = ws.receive_json()
    assert msg["kind"] == "welcome"
    return msg


def test_ws_sends_welcome_with_seq_and_snapshot_on_connect():
    """First frame to a freshly-connected peer is `welcome { mode, seq, snapshot }`.

    Phase 1c.1 introduced the `mode` discriminator so the client can
    dispatch on the welcome variant — first connect always sends
    `"snapshot"` (full graph dump for the authoritative store rebuild).
    """
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as ws:
        welcome = ws.receive_json()
        assert welcome["kind"] == "welcome"
        assert welcome["mode"] == "snapshot"
        assert welcome["seq"] == 0
        assert welcome["snapshot"] == {}


def test_ws_welcome_snapshot_respects_root_id_query_param():
    """The welcome snapshot is scoped to the client's `root_id`.

    Regression: WS welcome used to call `get_graph(root_id=None)` even
    when the user was viewing a folder, so the snapshot would carry
    the whole board and the client-side `applyGraphToStore` would
    replace the folder view with whole-board content. Pinning the
    parameter pass-through here means a future refactor can't drop
    the threading silently.
    """
    client, app = _build_app()
    captured: dict = {}

    async def _capture_get_graph(*, graph_uid, root_id=None):
        captured["graph_uid"] = graph_uid
        captured["root_id"] = root_id
        return None  # empty graph; we only care about the call args

    app.graph_store.get_graph = _capture_get_graph

    tickets = _mint_tickets(app, t1=("u1", "b1"))
    with client.websocket_connect(
        f"/boards/b1/collab?ticket={tickets['t1']}&root_id=folder-42"
    ) as ws:
        ws.receive_json()  # drain welcome
    assert captured["graph_uid"] == "b1"
    assert captured["root_id"] == "folder-42"


def test_ws_welcome_snapshot_omits_root_id_by_default():
    """No `root_id` query → snapshot reads the whole board (root_id=None)."""
    client, app = _build_app()
    captured: dict = {}

    async def _capture_get_graph(*, graph_uid, root_id=None):
        captured["root_id"] = root_id
        return None

    app.graph_store.get_graph = _capture_get_graph

    tickets = _mint_tickets(app, t1=("u1", "b1"))
    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as ws:
        ws.receive_json()
    assert captured["root_id"] is None


def test_ws_welcome_snapshot_carries_graph_payload():
    """Welcome snapshot includes the dumped Graph when one exists.

    The client uses this payload to nuke + replay its canvas-harness
    store on first connect. Without a payload (the empty-board case
    above), the client just clears the store.
    """
    client, app = _build_app()
    # Replace the graph response with a populated graph stub.

    class _Graph:
        def __init__(self, payload):
            self._payload = payload

        def model_dump(self, **_):
            return self._payload

    payload = {
        "uid": "b1",
        "type": "graph",
        "readonly": False,
        "visibility": "private",
        "createdAt": "2025-01-01T00:00:00",
        "nodes": [{"id": "n1", "type": "note"}],
        "edges": [],
    }
    app.graph_store.get_graph = lambda *, graph_uid, root_id=None: _async_return(_Graph(payload))

    tickets = _mint_tickets(app, t1=("u1", "b1"))
    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as ws:
        welcome = ws.receive_json()
        assert welcome["mode"] == "snapshot"
        assert welcome["snapshot"] == payload


def _async_return(value):
    """Tiny coroutine that returns `value` — wraps a sync stub for awaitable APIs."""
    async def _inner():
        return value
    return _inner()


# ---------------------------------------------------------------------------
# Phase 1c.2 — since_seq welcome dispatch (live / catch-up / snapshot)
# ---------------------------------------------------------------------------

def test_ws_welcome_live_mode_when_since_seq_matches_room_seq():
    """`since_seq >= room.seq` → `mode=live`, no payload.

    Most common reconnect case for a fast network blip: client knows the
    same seq the server knows, no work to do.
    """
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"))
    with client.websocket_connect(
        f"/boards/b1/collab?ticket={tickets['t1']}&since_seq=0"
    ) as ws:
        welcome = ws.receive_json()
        assert welcome["mode"] == "live"
        assert welcome["seq"] == 0
        assert "snapshot" not in welcome
        assert "batches" not in welcome


def test_ws_welcome_catch_up_mode_replays_buffered_batches():
    """Reconnect with `since_seq < room.seq` → `mode=catch-up` with batches.

    Drives the full flow: client A connects, emits two ops, client B
    reconnects with since_seq=1 and gets the second op replayed.
    """
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"), t2=("u2", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as sender:
        _drain_welcome(sender)
        # Bump room.seq to 2 via two ops.
        for nid in ("n1", "n2"):
            sender.send_json({
                "kind": "op",
                "client_seq": 1,
                "batch": {
                    "id": f"batch-{nid}",
                    "clientId": "alice",
                    "origin": "local",
                    "ops": [{"type": "node.update", "id": nid, "patch": {"x": 1}, "prev": {}}],
                },
            })
            sender.receive_json()  # drain op-applied

        # Reconnect a peer with since_seq=1; should get just the second batch.
        with client.websocket_connect(
            f"/boards/b1/collab?ticket={tickets['t2']}&since_seq=1"
        ) as peer:
            welcome = peer.receive_json()
            assert welcome["mode"] == "catch-up"
            assert welcome["seq"] == 2
            assert len(welcome["batches"]) == 1
            assert welcome["batches"][0]["id"] == "batch-n2"


def test_ws_welcome_falls_back_to_snapshot_when_since_seq_drifts_past_ring():
    """`since_seq` older than the ring's oldest entry → snapshot fallback.

    Simulates a long-disconnected peer reconnecting after the buffer
    has rotated past their last-known seq. The server still serves a
    correct welcome — just a more expensive one.
    """
    # We can't easily fill 500 batches in a test; instead, exploit the
    # boundary: any `since_seq` more than 1 less than the oldest in the
    # ring triggers the fallback. With seq=2 and a ring containing
    # batches at seqs 1 and 2, `since_seq=-100` is past the floor.
    # We use an empty ring + `since_seq < room.seq` to trigger the same
    # path: `batches_since_unlocked` returns None when the buffer is
    # empty AND since_seq is behind room.seq.
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"))

    # Pre-advance seq without populating the buffer — this is
    # artificial but exercises the "drifted past floor" path
    # deterministically.
    import asyncio
    async def _pump_seq():
        room, _ = await app.collab_rooms.join(
            "b1", _NullSocket(), "system",
        )
        async with room.lock:
            room.next_seq_unlocked()
            room.next_seq_unlocked()
            room.next_seq_unlocked()
        return room

    asyncio.new_event_loop().run_until_complete(_pump_seq())

    with client.websocket_connect(
        f"/boards/b1/collab?ticket={tickets['t1']}&since_seq=0"
    ) as ws:
        welcome = ws.receive_json()
        # since_seq=0 < room.seq=3 but buffer is empty → snapshot.
        assert welcome["mode"] == "snapshot"
        assert welcome["seq"] == 3
        assert welcome["snapshot"] == {}


class _NullSocket:
    """Stand-in socket so we can bump `room.seq` without a real WS upgrade."""

    async def send_text(self, _raw: str) -> None:
        return None


# ---------------------------------------------------------------------------
# Phase 3.2 — Per-room presence registry, welcome.presence map, leave on drop
# ---------------------------------------------------------------------------

def test_ws_welcome_snapshot_carries_presence_map():
    """First-connect welcome includes other peers' last-known presence.

    Without this, a freshly-joining peer wouldn't see remote cursors /
    chip entries until each existing peer happened to send another
    `presence` frame.
    """
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"), t2=("u2", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as ws1:
        _drain_welcome(ws1)
        # Establish ws1's presence in the room registry.
        ws1.send_text(
            '{"kind":"presence","clientId":"alice","state":{"name":"Alice","color":"#abc","cursor":null,"selection":[],"editing":null}}'
        )

        # ws2 joins fresh — should see ws1 in the welcome's presence map.
        with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t2']}") as ws2:
            welcome = ws2.receive_json()
            assert welcome["mode"] == "snapshot"
            assert "alice" in welcome["presence"]
            assert welcome["presence"]["alice"]["name"] == "Alice"


def test_ws_presence_frame_updates_per_room_registry():
    """Inbound `presence` frames upsert the per-room state."""
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as ws:
        _drain_welcome(ws)
        ws.send_text(
            '{"kind":"presence","clientId":"alice","state":{"name":"Alice","color":"#fff"}}'
        )
        # Allow the server task to process the frame.
        import time as _time
        _time.sleep(0.05)
        room = app.collab_rooms.get("b1")
        assert room is not None
        assert "alice" in room.presence


def test_ws_disconnect_emits_synthetic_presence_leave():
    """A socket drop emits a `presence-leave` frame to remaining peers.

    Without this, peers' cursor overlays "ghost" — the dropped peer's
    last cursor sits in place because no leave-frame ever arrived.
    """
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"), t2=("u2", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t2']}") as ws2:
        _drain_welcome(ws2)
        with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as ws1:
            _drain_welcome(ws1)
            ws1.send_text(
                '{"kind":"presence","clientId":"alice","state":{"name":"Alice"}}'
            )
            # Drain the relayed presence on ws2.
            ws2.receive_text()
        # ws1 closed — ws2 should now receive a synthetic leave keyed by
        # the app-level clientId ws1 announced via presence.
        import json as _json
        leave = _json.loads(ws2.receive_text())
        assert leave["kind"] == "presence-leave"
        assert leave["clientId"] == "alice"


def test_ws_malformed_presence_is_rejected_not_relayed():
    """Presence frames missing `state` or `clientId` are dropped server-side."""
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"), t2=("u2", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t2']}") as ws2:
        _drain_welcome(ws2)
        with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as ws1:
            _drain_welcome(ws1)
            # Missing `state` field.
            ws1.send_text('{"kind":"presence","clientId":"alice"}')
            # Send something else after so we'd notice if the previous
            # frame had been relayed (frames arrive in order).
            ws1.send_text(
                '{"kind":"presence","clientId":"alice","state":{"name":"Alice"}}'
            )
            relayed = ws2.receive_text()
            # First-relayed frame is the well-formed one, not the malformed.
            assert '"name":"Alice"' in relayed


def test_ws_relays_presence_between_peers():
    """A `presence` frame is still relayed verbatim through the room."""
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"), t2=("u2", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as ws1:
        _drain_welcome(ws1)
        with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t2']}") as ws2:
            _drain_welcome(ws2)
            ws1.send_text('{"kind":"presence","clientId":"c1","state":{}}')
            received = ws2.receive_text()
            assert received == '{"kind":"presence","clientId":"c1","state":{}}'


def test_ws_op_message_sequences_and_broadcasts_peer_op():
    """An incoming `op` is sequenced, applied, broadcast, and acked.

    Verifies the full flow: `apply_batch` runs, a seq is assigned, a
    `peer-op` reaches other clients, and the sender gets `op-applied`.
    """
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"), t2=("u2", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as sender:
        _drain_welcome(sender)
        with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t2']}") as peer:
            _drain_welcome(peer)

            sender.send_json({
                "kind": "op",
                "client_seq": 7,
                "batch": {
                    "id": "batch-1",
                    "clientId": "alice",
                    "origin": "local",
                    "ops": [
                        {"type": "node.update", "id": "n1", "patch": {"x": 200, "y": 150}, "prev": {}},
                    ],
                },
            })

            ack = sender.receive_json()
            assert ack["kind"] == "op-applied"
            assert ack["seq"] == 1
            assert ack["client_seq"] == 7

            peer_op = peer.receive_json()
            assert peer_op["kind"] == "peer-op"
            assert peer_op["seq"] == 1
            assert peer_op["batch"]["id"] == "batch-1"

            # apply_batch reached the store
            assert len(app.graph_store.patch_calls) == 1
            assert app.graph_store.patch_calls[0]["node_id"] == "n1"


def test_ws_op_seq_is_monotonic_across_ops():
    """Two ops from the same sender should be assigned seq=1 then seq=2."""
    client, app = _build_app()
    tickets = _mint_tickets(app, t1=("u1", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t1']}") as ws:
        _drain_welcome(ws)
        for client_seq in (1, 2):
            ws.send_json({
                "kind": "op",
                "client_seq": client_seq,
                "batch": {
                    "id": f"b{client_seq}",
                    "clientId": "alice",
                    "origin": "local",
                    "ops": [{"type": "node.remove", "node": {"id": f"n{client_seq}"}}],
                },
            })
            ack = ws.receive_json()
            assert ack["seq"] == client_seq
            assert ack["client_seq"] == client_seq


def test_ws_two_peers_same_board_register_in_same_room():
    """Two peers using tickets for the same board land in one Room."""
    client, app = _build_app()

    import asyncio
    loop = asyncio.new_event_loop()
    try:
        t1 = loop.run_until_complete(mint_ticket(app.redis_store, user_id="u1", board_id="b1"))
        t2 = loop.run_until_complete(mint_ticket(app.redis_store, user_id="u2", board_id="b1"))
    finally:
        loop.close()

    with client.websocket_connect(f"/boards/b1/collab?ticket={t1}"):
        with client.websocket_connect(f"/boards/b1/collab?ticket={t2}"):
            room = app.collab_rooms._rooms["b1"]
            assert len(room.clients) == 2


def test_ws_drops_room_after_last_disconnect():
    """The room is removed from the registry once both peers leave."""
    client, app = _build_app()

    import asyncio
    loop = asyncio.new_event_loop()
    try:
        t1 = loop.run_until_complete(mint_ticket(app.redis_store, user_id="u1", board_id="b1"))
    finally:
        loop.close()

    with client.websocket_connect(f"/boards/b1/collab?ticket={t1}"):
        pass  # disconnect immediately

    # After the context exits the registry should not retain the empty room.
    # TestClient is synchronous, but the server's `finally` runs before the
    # context manager returns, so the cleanup has already happened by here.
    assert "b1" not in app.collab_rooms._rooms


# ---------------------------------------------------------------------------
# Slice 2: role on the ticket + viewer reject + room-capacity cap
# ---------------------------------------------------------------------------

def test_ticket_response_carries_user_role():
    """The mint endpoint returns the user's role on the board."""
    client, _ = _build_app(role="viewer")

    response = client.post("/boards/b1/collab/ticket")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["role"] == "viewer"


def test_ticket_mint_404s_for_unaffiliated_user():
    """A user with no role on the board cannot mint a ticket."""
    client, _ = _build_app(role=None)

    response = client.post("/boards/b1/collab/ticket")

    assert response.status_code == 404


def test_ws_viewer_op_is_rejected_with_op_rejected():
    """A viewer's `op` is bounced with `op-rejected`.

    Connecting works; sending `op` returns `op-rejected` and the
    underlying GraphStore is never touched.
    """
    client, app = _build_app(role="viewer")
    tickets = _mint_tickets(app, role="viewer", t=("u1", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t']}") as ws:
        _drain_welcome(ws)
        ws.send_json({
            "kind": "op",
            "client_seq": 1,
            "batch": {
                "id": "b1",
                "clientId": "viewer",
                "origin": "local",
                "ops": [{"type": "node.update", "id": "n1", "patch": {"x": 1, "y": 2}, "prev": {}}],
            },
        })
        ack = ws.receive_json()

    assert ack["kind"] == "op-rejected"
    assert ack["client_seq"] == 1
    assert ack["reason"] == "read-only"
    # The graph store was NOT touched.
    assert len(app.graph_store.patch_calls) == 0


def test_ws_member_op_still_applies_normally():
    """Members still get the standard op-applied + peer-op pair (no regression)."""
    client, app = _build_app(role="member")
    tickets = _mint_tickets(app, t=("u1", "b1"))

    with client.websocket_connect(f"/boards/b1/collab?ticket={tickets['t']}") as ws:
        _drain_welcome(ws)
        ws.send_json({
            "kind": "op",
            "client_seq": 1,
            "batch": {
                "id": "b1",
                "clientId": "alice",
                "origin": "local",
                "ops": [{"type": "node.update", "id": "n1", "patch": {"x": 1, "y": 2}, "prev": {}}],
            },
        })
        ack = ws.receive_json()

    assert ack["kind"] == "op-applied"
    assert ack["seq"] == 1
    assert len(app.graph_store.patch_calls) == 1


def test_ws_room_full_closes_sixth_join_on_free_plan():
    """Free-tier owners cap their rooms at 5 actors; the 6th gets 4429."""
    from contextlib import ExitStack

    from starlette.websockets import WebSocketDisconnect

    client, app = _build_app(role="member", plan="free")  # cap = 5

    # Pre-mint 6 tickets (each can only be consumed once).
    tickets = [
        _mint_tickets(app, **{f"t{i}": (f"u{i}", "b1")})[f"t{i}"]
        for i in range(6)
    ]

    with ExitStack() as stack:
        for tok in tickets[:5]:
            ws = stack.enter_context(client.websocket_connect(f"/boards/b1/collab?ticket={tok}"))
            _drain_welcome(ws)

        # Sixth joiner — server should accept, see the cap, and close
        # with 4429 before the welcome is sent.
        raised = False
        try:
            with client.websocket_connect(f"/boards/b1/collab?ticket={tickets[5]}") as ws6:
                ws6.receive_json()
        except WebSocketDisconnect as exc:
            raised = True
            assert exc.code == 4429
        assert raised, "expected room-full close on 6th joiner"
