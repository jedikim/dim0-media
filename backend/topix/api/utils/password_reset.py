"""Password reset helpers."""

from __future__ import annotations

import hashlib
import os
import secrets

from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlencode

import httpx

from fastapi import HTTPException, status

PASSWORD_RESET_ENABLED_ENV = "PASSWORD_RESET_ENABLED"
PASSWORD_RESET_TTL_HOURS_ENV = "PASSWORD_RESET_TTL_HOURS"
RESEND_API_KEY_ENV = "RESEND_API_KEY"
RESEND_FROM_EMAIL_ENV = "RESEND_FROM_EMAIL"
APP_BASE_URL_ENV = "APP_BASE_URL"

DEFAULT_PASSWORD_RESET_TTL_HOURS = 1
DEFAULT_RESET_RESEND_COOLDOWN_SECONDS = 60


def _build_reset_email_content(
    reset_url: str,
    ttl_hours: int,
) -> tuple[str, str]:
    """Build HTML and plain-text password-reset email bodies for better deliverability."""
    expiration_label = f"{ttl_hours} hour{'s' if ttl_hours != 1 else ''}"

    text_body = (
        "Reset your Dim0 password\n\n"
        "We received a request to reset your password.\n\n"
        f"Reset password: {reset_url}\n\n"
        f"This reset link expires in {expiration_label}.\n\n"
        "If you did not request a password reset, you can safely ignore this email."
    )

    html_body = (
        "<div style=\"font-family: Arial, sans-serif; color: #111827; line-height: 1.6;\">"
        "<p>Reset your <strong>Dim0</strong> password</p>"
        "<p>We received a request to reset your password.</p>"
        f"<p><a href=\"{reset_url}\" "
        "style=\"display: inline-block; padding: 10px 16px; background: #111827; color: #ffffff; "
        "text-decoration: none; border-radius: 6px; font-weight: 600;\">Reset password</a></p>"
        "<p>If the button doesn't work, copy and paste this link into your browser:</p>"
        f"<p><a href=\"{reset_url}\">{reset_url}</a></p>"
        f"<p>This reset link expires in <strong>{expiration_label}</strong>.</p>"
        "<p>If you did not request a password reset, you can safely ignore this email.</p>"
        "</div>"
    )

    return html_body, text_body


@dataclass(frozen=True)
class PasswordResetConfig:
    """Runtime settings for password reset email delivery."""

    resend_api_key: str
    resend_from_email: str
    app_base_url: str
    ttl_hours: int


def _is_truthy(value: str | None) -> bool:
    """Parse common truthy env string values."""
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def is_password_reset_enabled() -> bool:
    """Return whether password reset is explicitly enabled."""
    return _is_truthy(os.getenv(PASSWORD_RESET_ENABLED_ENV))


def _read_env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def get_password_reset_config() -> PasswordResetConfig:
    """Load password reset env settings and fail fast when incomplete."""
    resend_api_key = _read_env(RESEND_API_KEY_ENV)
    resend_from_email = _read_env(RESEND_FROM_EMAIL_ENV)
    app_base_url = _read_env(APP_BASE_URL_ENV)
    ttl_hours_raw = _read_env(PASSWORD_RESET_TTL_HOURS_ENV)
    ttl_hours = int(ttl_hours_raw) if ttl_hours_raw else DEFAULT_PASSWORD_RESET_TTL_HOURS

    missing = [
        name
        for name, value in (
            (RESEND_API_KEY_ENV, resend_api_key),
            (RESEND_FROM_EMAIL_ENV, resend_from_email),
            (APP_BASE_URL_ENV, app_base_url),
        )
        if value is None
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Password reset is not configured. Missing env: {', '.join(missing)}",
        )

    return PasswordResetConfig(
        resend_api_key=resend_api_key,
        resend_from_email=resend_from_email,
        app_base_url=app_base_url.rstrip("/"),
        ttl_hours=max(1, ttl_hours),
    )


def generate_password_reset_token() -> str:
    """Generate a random URL-safe reset token."""
    return secrets.token_urlsafe(32)


def hash_password_reset_token(raw_token: str) -> str:
    """Hash a reset token for secure persistence."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def build_password_reset_url(app_base_url: str, raw_token: str) -> str:
    """Build frontend reset URL with token query parameter."""
    query = urlencode({"token": raw_token})
    return f"{app_base_url}/reset-password?{query}"


def compute_reset_expiry(now: datetime, ttl_hours: int) -> datetime:
    """Compute reset token expiry timestamp from UTC now + ttl."""
    return now + timedelta(hours=ttl_hours)


async def send_password_reset_link(
    *,
    resend_api_key: str,
    resend_from_email: str,
    to_email: str,
    reset_url: str,
    ttl_hours: int,
) -> None:
    """Send password reset email through Resend REST API."""
    headers = {
        "Authorization": f"Bearer {resend_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "from": resend_from_email,
        "to": [to_email],
        "subject": "Reset your Dim0 password",
    }
    html_body, text_body = _build_reset_email_content(
        reset_url=reset_url,
        ttl_hours=ttl_hours,
    )
    payload["html"] = html_body
    payload["text"] = text_body

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            "https://api.resend.com/emails",
            headers=headers,
            json=payload,
        )

    if response.status_code >= 400:
        detail = response.text or "Failed to send password reset email"
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Email provider error: {detail}",
        )
