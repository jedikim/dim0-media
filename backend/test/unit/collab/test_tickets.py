"""Unit tests for the one-shot WebSocket ticket flow."""

from topix.collab.tickets import TICKET_KEY_PREFIX, consume_ticket, mint_ticket


class _FakeRedis:
    """In-memory stand-in for redis.asyncio.Redis covering set/getdel."""

    def __init__(self):
        self.store: dict[str, str] = {}
        self.last_ex: int | None = None

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value
        self.last_ex = ex

    async def getdel(self, key: str):
        return self.store.pop(key, None)


class _FakeRedisStore:
    """Minimal stand-in mirroring RedisStore.redis attribute."""

    def __init__(self):
        self.redis = _FakeRedis()


async def test_mint_round_trips_payload_and_uses_ttl():
    """Minted ticket decodes back to (user_id, board_id, role) and uses the configured TTL."""
    redis_store = _FakeRedisStore()

    token = await mint_ticket(redis_store, user_id="u1", board_id="b1", role="member")

    assert token
    assert redis_store.redis.last_ex == 30
    assert f"{TICKET_KEY_PREFIX}{token}" in redis_store.redis.store

    payload = await consume_ticket(redis_store, token)
    assert payload == {"user_id": "u1", "board_id": "b1", "role": "member"}


async def test_mint_defaults_role_to_member_when_omitted():
    """Calling mint_ticket without `role` keeps a `member` default."""
    redis_store = _FakeRedisStore()

    token = await mint_ticket(redis_store, user_id="u1", board_id="b1")
    payload = await consume_ticket(redis_store, token)

    assert payload is not None
    assert payload["role"] == "member"


async def test_mint_carries_viewer_role():
    """Viewer tickets round-trip the role through the payload."""
    redis_store = _FakeRedisStore()

    token = await mint_ticket(redis_store, user_id="u1", board_id="b1", role="viewer")
    payload = await consume_ticket(redis_store, token)

    assert payload is not None
    assert payload["role"] == "viewer"


async def test_consume_is_single_use():
    """A ticket can only be consumed once; the second consume sees nothing."""
    redis_store = _FakeRedisStore()
    token = await mint_ticket(redis_store, user_id="u1", board_id="b1")

    assert await consume_ticket(redis_store, token) is not None
    assert await consume_ticket(redis_store, token) is None


async def test_consume_missing_ticket_returns_none():
    """An unknown / expired ticket consumes to None (no exception)."""
    redis_store = _FakeRedisStore()
    assert await consume_ticket(redis_store, "never-minted") is None


async def test_consume_malformed_payload_returns_none():
    """If the stored payload is not JSON, consume must not raise."""
    redis_store = _FakeRedisStore()
    bad_token = "manual-token"
    redis_store.redis.store[f"{TICKET_KEY_PREFIX}{bad_token}"] = "{not json"

    assert await consume_ticket(redis_store, bad_token) is None


async def test_mint_uses_unguessable_tokens():
    """Minted tokens are URL-safe random strings of meaningful length."""
    redis_store = _FakeRedisStore()
    tokens = set()
    for _ in range(50):
        tokens.add(await mint_ticket(redis_store, user_id="u", board_id="b"))
    assert len(tokens) == 50
    for t in tokens:
        # token_urlsafe(32) → ~43 chars
        assert len(t) >= 32
