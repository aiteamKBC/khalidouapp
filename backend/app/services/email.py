"""Reliable outbound email with persistent deduplication and cooldowns."""

import logging
import smtplib
import time
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from hashlib import sha256
from uuid import UUID

import httpx
from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ApiError
from app.database.session import get_sessionmaker
from app.models import EmailDelivery

logger = logging.getLogger("uvicorn.error")
_graph_token_cache: dict = {"token": None, "expires_at": 0.0}
ALLOWED_EMAIL_CATEGORIES = {
    "admin_welcome",
    "admin_password_reset",
    "employee_invitation",
    "employee_portal_key",
}
BLOCKED_EMAIL_DOMAINS = {"example.com", "example.net", "example.org", "invalid", "localhost"}


def _is_blocked_recipient(to: str) -> bool:
    address = to.strip().lower()
    domain = address.rpartition("@")[2]
    return not domain or domain in BLOCKED_EMAIL_DOMAINS or domain.endswith(".test")


def _graph_configured() -> bool:
    return bool(
        settings.graph_tenant_id
        and settings.graph_client_id
        and settings.graph_client_secret
        and settings.graph_sender
    )


def _smtp_configured() -> bool:
    return bool(settings.smtp_host)


def _get_graph_token() -> str:
    if _graph_token_cache["token"] and time.time() < _graph_token_cache["expires_at"] - 60:
        return _graph_token_cache["token"]
    response = httpx.post(
        f"https://login.microsoftonline.com/{settings.graph_tenant_id}/oauth2/v2.0/token",
        data={
            "client_id": settings.graph_client_id,
            "client_secret": settings.graph_client_secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    _graph_token_cache["token"] = payload["access_token"]
    _graph_token_cache["expires_at"] = time.time() + int(payload.get("expires_in", 3600))
    return _graph_token_cache["token"]


def _send_via_graph(to: str, subject: str, body: str) -> None:
    response = httpx.post(
        f"https://graph.microsoft.com/v1.0/users/{settings.graph_sender}/sendMail",
        headers={"Authorization": f"Bearer {_get_graph_token()}"},
        json={
            "message": {
                "subject": subject,
                "body": {"contentType": "Text", "content": body},
                "toRecipients": [{"emailAddress": {"address": to}}],
            },
            "saveToSentItems": True,
        },
        timeout=20,
    )
    response.raise_for_status()


def _send_via_smtp(to: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = settings.smtp_from or settings.smtp_user or "no-reply@khaliduo.local"
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message)


def send_email(to: str, subject: str, body: str) -> bool:
    """Deliver one message and report transport success without raising."""
    if settings.app_env.lower() in {"test", "testing"}:
        logger.info("[email:test] suppressed delivery to %s | subject=%r", to, subject)
        return True
    if _is_blocked_recipient(to):
        logger.warning("[email] blocked reserved/test recipient %s", to.lower())
        return False
    allowed_recipients = {
        item.strip().lower()
        for item in settings.email_allowed_recipients.split(",")
        if item.strip()
    }
    if (
        settings.app_env.lower() != "production"
        and allowed_recipients
        and to.lower() not in allowed_recipients
    ):
        logger.warning("[email] blocked non-allowlisted development recipient %s", to.lower())
        return False
    try:
        if _graph_configured():
            _send_via_graph(to, subject, body)
            logger.info("[email] sent via Graph to %s | subject=%r", to, subject)
        elif _smtp_configured():
            _send_via_smtp(to, subject, body)
            logger.info("[email] sent via SMTP to %s | subject=%r", to, subject)
        else:
            logger.info(
                "[email:dev] no transport configured — would send to %s | subject=%r", to, subject
            )
        return True
    except Exception:  # noqa: BLE001
        logger.exception("[email] failed to send to %s | subject=%r", to, subject)
        return False


def ensure_email_allowed(db: Session, *, to: str, category: str) -> None:
    """Block rapid credential rotation before the old credential is invalidated."""
    minutes = max(1, settings.email_cooldown_minutes)
    cutoff = datetime.now(UTC) - timedelta(minutes=minutes)
    recent = db.scalar(
        select(EmailDelivery)
        .where(
            EmailDelivery.recipient == to.lower(),
            EmailDelivery.category == category,
            EmailDelivery.status.in_(["queued", "sent", "suppressed"]),
            EmailDelivery.created_at >= cutoff,
        )
        .order_by(EmailDelivery.created_at.desc())
    )
    if recent:
        created_at = recent.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        retry_at = created_at + timedelta(minutes=minutes)
        raise ApiError(
            "EMAIL_COOLDOWN",
            "This email was already sent recently. Wait before sending it again.",
            429,
            details={
                "retry_after_seconds": max(1, int((retry_at - datetime.now(UTC)).total_seconds())),
                "category": category,
            },
        )


def _deliver_reserved_email(delivery_id: UUID, to: str, subject: str, body: str) -> None:
    delivered = send_email(to, subject, body)
    with get_sessionmaker()() as db:
        delivery = db.get(EmailDelivery, delivery_id)
        if delivery is None:
            return
        delivery.status = "sent" if delivered else "failed"
        delivery.sent_at = datetime.now(UTC) if delivered else None
        delivery.error_message = None if delivered else "Email transport failed; see server logs."
        db.commit()


def enqueue_email_once(
    db: Session,
    background_tasks: BackgroundTasks,
    *,
    company_id: UUID | None,
    to: str,
    category: str,
    subject: str,
    body: str,
) -> bool:
    if _is_blocked_recipient(to):
        logger.warning("[email] refused to queue reserved/test recipient %s", to.lower())
        return False
    if category not in ALLOWED_EMAIL_CATEGORIES:
        logger.warning("[email] blocked disallowed category=%s recipient=%s", category, to.lower())
        return False
    recipient = to.lower()
    fingerprint = sha256(f"{category}\0{recipient}\0{subject}\0{body}".encode()).hexdigest()
    delivery = EmailDelivery(
        company_id=company_id,
        recipient=recipient,
        category=category,
        fingerprint=fingerprint,
        subject=subject,
        status="suppressed" if settings.app_env.lower() in {"test", "testing"} else "queued",
    )
    db.add(delivery)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        logger.info("[email] duplicate suppressed for %s | category=%s", recipient, category)
        return False
    db.refresh(delivery)
    if delivery.status == "suppressed":
        logger.info(
            "[email:test] queued message suppressed for %s | category=%s", recipient, category
        )
        return True
    background_tasks.add_task(_deliver_reserved_email, delivery.id, recipient, subject, body)
    return True


def _admin_message(*, to: str, name: str, password: str, is_reset: bool) -> tuple[str, str]:
    subject = (
        f"{settings.app_name}: your password was reset"
        if is_reset
        else f"You have been invited to {settings.app_name}"
    )
    lead = (
        "Your dashboard password was reset by an administrator."
        if is_reset
        else "An administrator created a Khaliduo dashboard account for you."
    )
    body = (
        f"Hi {name},\n\n{lead}\n\nSign in here: {settings.app_public_url.rstrip('/')}/login\n"
        f"Email: {to}\nTemporary password: {password}\n\n"
        f"Please sign in and change your password as soon as possible.\n\n— {settings.app_name}"
    )
    return subject, body


def enqueue_admin_credentials_email(
    db: Session,
    background_tasks: BackgroundTasks,
    *,
    company_id: UUID,
    to: str,
    name: str,
    password: str,
    is_reset: bool,
) -> bool:
    subject, body = _admin_message(to=to, name=name, password=password, is_reset=is_reset)
    return enqueue_email_once(
        db,
        background_tasks,
        company_id=company_id,
        to=to,
        category="admin_password_reset" if is_reset else "admin_welcome",
        subject=subject,
        body=body,
    )


def enqueue_admin_password_reset_link_email(
    db: Session,
    background_tasks: BackgroundTasks,
    *,
    company_id: UUID,
    to: str,
    name: str,
    token: str,
    expires_in_minutes: int,
) -> bool:
    reset_url = f"{settings.app_public_url.rstrip('/')}/login?resetToken={token}"
    subject = f"{settings.app_name}: reset your password"
    body = (
        f"Hi {name},\n\nWe received a request to reset your dashboard password.\n\n"
        f"Reset it here: {reset_url}\n\n"
        f"This link expires in {expires_in_minutes} minutes and can be used once. "
        "If you did not request this, you can ignore this message; your password has not changed.\n\n"
        f"— {settings.app_name}"
    )
    return enqueue_email_once(
        db,
        background_tasks,
        company_id=company_id,
        to=to,
        category="admin_password_reset",
        subject=subject,
        body=body,
    )


def enqueue_employee_invitation_email(
    db: Session,
    background_tasks: BackgroundTasks,
    *,
    company_id: UUID,
    to: str,
    name: str,
    token: str,
    expires_in_hours: int,
) -> bool:
    invitation_url = f"{settings.app_public_url.rstrip('/')}/accept-invitation?token={token}"
    subject = f"You have been invited to {settings.app_name}"
    body = (
        f"Hi {name},\n\nYour Khaliduo employee account has been created.\n\n"
        f"Accept your invitation and choose your password: {invitation_url}\n\n"
        f"This one-time link expires in {expires_in_hours} hours. If you did not expect this "
        "invitation, you can ignore this message.\n\n"
        f"— {settings.app_name}"
    )
    return enqueue_email_once(
        db,
        background_tasks,
        company_id=company_id,
        to=to,
        category="employee_invitation",
        subject=subject,
        body=body,
    )
