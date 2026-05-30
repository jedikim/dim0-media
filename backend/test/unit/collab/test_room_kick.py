"""Tests for `Room.kick_user`.

Close the sockets of a specific user; leave everyone else alone.
"""

import json

from topix.collab.room import Room


class _FakeSocket:
    def __init__(self):
        self.sent: list[str] = []
        self.close_calls: list[dict] = []
        self.fail_send = False
        self.fail_close = False

    async def send_text(self, raw: str) -> None:
        if self.fail_send:
            raise RuntimeError("send dead")
        self.sent.append(raw)

    async def close(self, *, code: int = 1000, reason: str = "") -> None:
        if self.fail_close:
            raise RuntimeError("close dead")
        self.close_calls.append({"code": code, "reason": reason})


async def test_kick_user_closes_all_sockets_for_one_user():
    """A user with two tabs in the room loses both."""
    room = Room(board_id="b1")
    s_alice_tab1 = _FakeSocket()
    s_alice_tab2 = _FakeSocket()
    s_bob = _FakeSocket()
    await room.add(s_alice_tab1, "alice")
    await room.add(s_alice_tab2, "alice")
    await room.add(s_bob, "bob")

    kicked = await room.kick_user("alice", reason="access-revoked")

    assert kicked == 2
    # Alice's sockets got the kick frame + a close call.
    for sock in (s_alice_tab1, s_alice_tab2):
        assert len(sock.sent) == 1
        msg = json.loads(sock.sent[0])
        assert msg == {"kind": "kick", "reason": "access-revoked"}
        assert len(sock.close_calls) == 1
        assert sock.close_calls[0]["reason"] == "access-revoked"
    # Bob is untouched.
    assert s_bob.sent == []
    assert s_bob.close_calls == []


async def test_kick_user_with_no_live_sockets_returns_zero():
    """Idempotent: removing an offline user is a no-op."""
    room = Room(board_id="b1")
    await room.add(_FakeSocket(), "bob")

    kicked = await room.kick_user("alice", reason="access-revoked")

    assert kicked == 0


async def test_kick_user_swallows_send_errors():
    """Send/close errors don't abort the kick loop.

    A failed send_text shouldn't abort the close, and a failed close
    shouldn't abort the loop over other victims.
    """
    room = Room(board_id="b1")
    s_dead = _FakeSocket()
    s_dead.fail_send = True
    s_live = _FakeSocket()
    await room.add(s_dead, "alice")
    await room.add(s_live, "alice")

    kicked = await room.kick_user("alice", reason="access-revoked")

    # Both counted as kicked even though one's send failed.
    assert kicked == 2
    # The live socket still got the frame.
    assert len(s_live.sent) == 1
    # The dead socket still got close()-attempted.
    assert len(s_dead.close_calls) == 1


async def test_kick_user_does_not_remove_clients_from_dict():
    """kick_user only closes sockets; clients-dict cleanup is elsewhere.

    `room.clients` is owned by the per-socket WS handler's finally
    block via `registry.leave`.
    """
    room = Room(board_id="b1")
    await room.add(_FakeSocket(), "alice")
    assert len(room.clients) == 1

    await room.kick_user("alice", reason="access-revoked")

    # Still there until the WS handler calls registry.leave.
    assert len(room.clients) == 1
