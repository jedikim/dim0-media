"""Unit tests for users password reset endpoints."""

from datetime import datetime, timedelta, timezone

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from topix.api.router.users import router
from topix.api.utils.email_verification import utc_now
from topix.api.utils.password_reset import hash_password_reset_token
from topix.api.utils.security import create_refresh_token
from topix.config.config import Config
from topix.datatypes.password_reset import PasswordResetToken
from topix.datatypes.stage import StageEnum
from topix.datatypes.user import User
from topix.utils.singleton import SingletonAlreadyInitializedError


@pytest.fixture(scope="module", autouse=True)
def _init_config():
    """Ensure Config singleton is loaded so JWT signing/verification works in tests."""
    try:
        Config.load(stage=StageEnum.TEST)
    except SingletonAlreadyInitializedError:
        pass


class _FakeUserStore:
    """Minimal user store stub for password reset router tests."""

    def __init__(self):
        self._users_by_uid: dict[str, User] = {}
        self._users_by_email: dict[str, User] = {}
        self.updates: list[tuple[str, dict]] = []

    async def add_user(self, user: User):
        self._users_by_uid[user.uid] = user
        self._users_by_email[user.email] = user

    async def get_user(self, user_uid: str) -> User | None:
        return self._users_by_uid.get(user_uid)

    async def get_user_by_email(self, email: str) -> User | None:
        return self._users_by_email.get(email)

    async def update_user(self, user_uid: str, data: dict):
        self.updates.append((user_uid, data))
        user = self._users_by_uid.get(user_uid)
        if user:
            for k, v in data.items():
                setattr(user, k, v)


class _FakePasswordResetStore:
    """Minimal password reset store stub for router tests."""

    def __init__(self):
        self._active_by_hash: dict[str, PasswordResetToken] = {}
        self._latest_by_user: dict[str, PasswordResetToken] = {}
        self.saved: list[PasswordResetToken] = []
        self.used: list[str] = []

    async def save_token(self, token: PasswordResetToken):
        self.saved.append(token)
        self._active_by_hash[token.token_hash] = token
        self._latest_by_user[token.user_uid] = token
        return token

    async def get_active_token_by_hash(self, token_hash: str) -> PasswordResetToken | None:
        return self._active_by_hash.get(token_hash)

    async def mark_token_used(self, token_uid: str):
        self.used.append(token_uid)
        for h, t in list(self._active_by_hash.items()):
            if t.uid == token_uid:
                del self._active_by_hash[h]

    async def get_latest_token_for_user(self, user_uid: str) -> PasswordResetToken | None:
        return self._latest_by_user.get(user_uid)


class _FakeUserBillingStore:
    """Minimal billing store stub used by token plan resolver."""

    async def get_user_billing(self, user_uid: str):
        return None


def _build_client(
    *,
    user_store: _FakeUserStore | None = None,
    reset_store: _FakePasswordResetStore | None = None,
) -> tuple[TestClient, _FakeUserStore, _FakePasswordResetStore]:
    """Build a TestClient backed by in-memory fakes."""
    app = FastAPI()
    app.include_router(router)
    app.user_store = user_store or _FakeUserStore()
    app.password_reset_store = reset_store or _FakePasswordResetStore()
    app.user_billing_store = _FakeUserBillingStore()
    return TestClient(app), app.user_store, app.password_reset_store


def _set_reset_env(monkeypatch):
    """Enable reset feature with the env vars the config loader expects."""
    monkeypatch.setenv("PASSWORD_RESET_ENABLED", "true")
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    monkeypatch.setenv("RESEND_FROM_EMAIL", "noreply@test.com")
    monkeypatch.setenv("APP_BASE_URL", "http://localhost:3175")


GENERIC_FORGOT_MESSAGE = "If an account exists, a password reset link has been sent."


def test_password_reset_status_disabled(monkeypatch):
    """Status endpoint should report disabled when feature flag is off."""
    monkeypatch.delenv("PASSWORD_RESET_ENABLED", raising=False)
    client, _, _ = _build_client()

    response = client.get("/users/password-reset-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"] == {"enabled": False}


def test_password_reset_status_enabled(monkeypatch):
    """Status endpoint should report enabled when feature flag is set."""
    monkeypatch.setenv("PASSWORD_RESET_ENABLED", "true")
    client, _, _ = _build_client()

    response = client.get("/users/password-reset-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"] == {"enabled": True}


def test_forgot_password_disabled_returns_generic_response(monkeypatch):
    """Forgot endpoint should silently no-op (generic 200) when disabled."""
    monkeypatch.delenv("PASSWORD_RESET_ENABLED", raising=False)
    client, _, reset_store = _build_client()

    response = client.post("/users/forgot-password", json={"email": "any@test.com"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["message"] == GENERIC_FORGOT_MESSAGE
    assert reset_store.saved == []


def test_forgot_password_unknown_email_no_enumeration(monkeypatch):
    """Forgot endpoint must return generic 200 for unknown emails (no enumeration)."""
    _set_reset_env(monkeypatch)
    client, _, reset_store = _build_client()

    response = client.post("/users/forgot-password", json={"email": "ghost@test.com"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["message"] == GENERIC_FORGOT_MESSAGE
    assert reset_store.saved == []


def test_forgot_password_google_only_account_silently_noops(monkeypatch):
    """Google-only accounts (password_hash IS NULL) should silently no-op."""
    _set_reset_env(monkeypatch)
    client, user_store, reset_store = _build_client()
    user_store._users_by_uid["g-1"] = user_store._users_by_email["g@test.com"] = User(
        uid="g-1",
        email="g@test.com",
        username="g-1",
        auth_provider="google",
        google_sub="google-sub-1",
        password_hash=None,
    )

    response = client.post("/users/forgot-password", json={"email": "g@test.com"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["message"] == GENERIC_FORGOT_MESSAGE
    assert reset_store.saved == []


def test_forgot_password_happy_path_saves_token_and_sends_email(monkeypatch):
    """Forgot endpoint should persist token and send email for a real local account."""
    _set_reset_env(monkeypatch)

    sent_payloads: list[dict] = []

    async def _fake_send_password_reset_link(**kwargs):
        sent_payloads.append(kwargs)

    monkeypatch.setattr(
        "topix.api.router.users.send_password_reset_link",
        _fake_send_password_reset_link,
    )

    client, user_store, reset_store = _build_client()
    user_store._users_by_uid["u-1"] = user_store._users_by_email["u1@test.com"] = User(
        uid="u-1",
        email="u1@test.com",
        username="u-1",
        password_hash="bcrypt-hash",
    )

    response = client.post("/users/forgot-password", json={"email": "u1@test.com"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["message"] == GENERIC_FORGOT_MESSAGE
    assert len(reset_store.saved) == 1
    assert reset_store.saved[0].user_uid == "u-1"
    assert len(sent_payloads) == 1
    assert sent_payloads[0]["to_email"] == "u1@test.com"


def test_forgot_password_within_cooldown_does_not_resend(monkeypatch):
    """Forgot endpoint should silently swallow requests inside the cooldown window."""
    _set_reset_env(monkeypatch)

    sent_payloads: list[dict] = []

    async def _fake_send_password_reset_link(**kwargs):
        sent_payloads.append(kwargs)

    monkeypatch.setattr(
        "topix.api.router.users.send_password_reset_link",
        _fake_send_password_reset_link,
    )

    client, user_store, reset_store = _build_client()
    user_store._users_by_uid["u-2"] = user_store._users_by_email["u2@test.com"] = User(
        uid="u-2",
        email="u2@test.com",
        username="u-2",
        password_hash="bcrypt-hash",
    )
    reset_store._latest_by_user["u-2"] = PasswordResetToken(
        uid="prt-recent",
        user_uid="u-2",
        token_hash=hash_password_reset_token("recent"),
        expires_at=utc_now() + timedelta(hours=1),
        created_at=utc_now(),
    )

    response = client.post("/users/forgot-password", json={"email": "u2@test.com"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["message"] == GENERIC_FORGOT_MESSAGE
    assert reset_store.saved == []
    assert sent_payloads == []


def test_reset_password_disabled_returns_503(monkeypatch):
    """Reset endpoint should refuse with 503 when the feature is disabled."""
    monkeypatch.delenv("PASSWORD_RESET_ENABLED", raising=False)
    client, _, _ = _build_client()

    response = client.post(
        "/users/reset-password",
        json={"token": "t", "new_password": "Aa1!aaaa"},
    )

    assert response.status_code == 503


def test_reset_password_invalid_token_returns_400(monkeypatch):
    """Reset endpoint should return 400 for unknown/expired tokens."""
    _set_reset_env(monkeypatch)
    client, _, _ = _build_client()

    response = client.post(
        "/users/reset-password",
        json={"token": "nope", "new_password": "Aa1!aaaa"},
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["data"]["message"] == "Invalid or expired reset token"


def test_reset_password_short_password_returns_400(monkeypatch):
    """Reset endpoint should reject passwords shorter than 8 characters."""
    _set_reset_env(monkeypatch)
    client, _, _ = _build_client()

    response = client.post(
        "/users/reset-password",
        json={"token": "t", "new_password": "short"},
    )

    assert response.status_code == 400
    payload = response.json()
    assert "at least 8" in payload["data"]["message"]


def test_reset_password_happy_path_updates_user_and_consumes_token(monkeypatch):
    """Reset endpoint should rotate the password hash, set password_changed_at, and burn the token."""
    _set_reset_env(monkeypatch)

    client, user_store, reset_store = _build_client()
    user_store._users_by_uid["u-3"] = User(
        uid="u-3",
        email="u3@test.com",
        username="u-3",
        password_hash="old-hash",
    )

    raw_token = "valid-reset-token"
    token_hash = hash_password_reset_token(raw_token)
    reset_store._active_by_hash[token_hash] = PasswordResetToken(
        uid="prt-1",
        user_uid="u-3",
        token_hash=token_hash,
        expires_at=utc_now() + timedelta(hours=1),
    )

    response = client.post(
        "/users/reset-password",
        json={"token": raw_token, "new_password": "Brand-New-Pw1!"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["message"] == "Password reset successfully"

    assert len(user_store.updates) == 1
    updated_uid, updated_data = user_store.updates[0]
    assert updated_uid == "u-3"
    assert "password_hash" in updated_data
    assert updated_data["password_hash"] != "old-hash"
    assert "password_changed_at" in updated_data
    assert isinstance(updated_data["password_changed_at"], datetime)
    assert reset_store.used == ["prt-1"]


def test_refresh_accepts_when_password_changed_at_unset(monkeypatch):
    """Refresh should succeed when the user has never reset their password."""
    monkeypatch.delenv("VITE_BILLING_ENABLED", raising=False)
    client, user_store, _ = _build_client()
    user_store._users_by_uid["u-4"] = User(
        uid="u-4",
        email="u4@test.com",
        username="u-4",
        password_hash="hash",
    )
    refresh_token = create_refresh_token({"sub": "u-4"}, expires_delta=timedelta(days=7))

    response = client.post("/users/refresh", json={"refresh_token": refresh_token})

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["token"]["access_token"]


def test_refresh_rejects_token_issued_before_password_change(monkeypatch):
    """Refresh should 401 when iat is older than password_changed_at."""
    client, user_store, _ = _build_client()
    refresh_token = create_refresh_token({"sub": "u-5"}, expires_delta=timedelta(days=7))
    # password_changed_at must be after the refresh token was issued.
    future_naive_utc = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=5)
    user_store._users_by_uid["u-5"] = User(
        uid="u-5",
        email="u5@test.com",
        username="u-5",
        password_hash="hash",
        password_changed_at=future_naive_utc,
    )

    response = client.post("/users/refresh", json={"refresh_token": refresh_token})

    assert response.status_code == 401
    payload = response.json()
    assert payload["data"]["message"] == "Refresh token revoked"


def test_refresh_accepts_token_issued_after_password_change(monkeypatch):
    """Refresh should succeed when iat is newer than password_changed_at."""
    monkeypatch.delenv("VITE_BILLING_ENABLED", raising=False)
    client, user_store, _ = _build_client()
    past_naive_utc = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=5)
    user_store._users_by_uid["u-6"] = User(
        uid="u-6",
        email="u6@test.com",
        username="u-6",
        password_hash="hash",
        password_changed_at=past_naive_utc,
    )
    refresh_token = create_refresh_token({"sub": "u-6"}, expires_delta=timedelta(days=7))

    response = client.post("/users/refresh", json={"refresh_token": refresh_token})

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["token"]["access_token"]
