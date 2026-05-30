"""One-shot WebSocket auth tickets backed by Redis.

The frontend can't attach `Authorization:` to a WS upgrade, so we mint a
short-lived single-use token over authenticated HTTP and exchange it
during the WS handshake. Storage is Redis with `SET ... EX 30`; consume
is `GETDEL` so a ticket can never be replayed.
"""

import json
import logging
import secrets

from topix.store.redis.store import RedisStore

logger = logging.getLogger(__name__)


TICKET_TTL_SECONDS = 30
TICKET_KEY_PREFIX = "collab:ticket:"


async def mint_ticket(
    redis_store: RedisStore,
    user_id: str,
    board_id: str,
    *,
    role: str = "member",
) -> str:
    """Mint a short-lived ticket binding (user_id, board_id, role) for WS auth.

    `role` is consumed by the WS handler to gate op messages (viewers
    cannot mutate). Defaults to `"member"` for back-compat; callers
    minting from the ticket router should always pass the user's
    effective role looked up from `graph_user`.
    """
    token = secrets.token_urlsafe(32)
    payload = json.dumps({
        "user_id": user_id,
        "board_id": board_id,
        "role": role,
    })
    await redis_store.redis.set(f"{TICKET_KEY_PREFIX}{token}", payload, ex=TICKET_TTL_SECONDS)
    return token


async def consume_ticket(redis_store: RedisStore, token: str) -> dict | None:
    """Atomically consume a ticket; returns the payload or None if missing/expired.

    Payload shape: `{user_id, board_id, role}`. Tickets minted before
    Slice 2 of Phase A may lack `role`; the WS handler defaults missing
    role to `"member"` (those tickets expire within 30s so the
    incompatibility window is tiny).
    """
    raw = await redis_store.redis.getdel(f"{TICKET_KEY_PREFIX}{token}")
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("collab ticket payload was malformed for token=%s", token[:8])
        return None
