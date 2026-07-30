"""Authenticated field-level encryption for payroll data at rest."""

import base64
import hashlib
import json
import os
from decimal import Decimal
from functools import lru_cache
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

PREFIX = "enc:v1:"
AAD = b"khaliduo:payroll:v1"


def _legacy_secret() -> str:
    return f"development-only:{settings.jwt_secret_key}"


@lru_cache(maxsize=4)
def _cipher_for_secret(secret: str) -> AESGCM:
    return AESGCM(hashlib.sha256(secret.encode("utf-8")).digest())


def _cipher() -> AESGCM:
    # Production requires a dedicated key. The legacy derivation remains the
    # development/test default and a read-only rotation fallback below.
    return _cipher_for_secret(settings.salary_encryption_key or _legacy_secret())


def encrypt_text(value: str) -> str:
    nonce = os.urandom(12)
    encrypted = _cipher().encrypt(nonce, value.encode("utf-8"), AAD)
    return PREFIX + base64.urlsafe_b64encode(nonce + encrypted).decode("ascii")


def decrypt_text(value: str) -> str:
    if not value.startswith(PREFIX):
        return value
    try:
        payload = base64.urlsafe_b64decode(value[len(PREFIX) :].encode("ascii"))
    except Exception as exc:
        raise RuntimeError("Encrypted payroll data could not be decrypted.") from exc
    ciphers = [_cipher()]
    # Older releases derived payroll encryption from JWT_SECRET_KEY when no
    # dedicated salary key was configured. Keep that data readable while new
    # writes use SALARY_ENCRYPTION_KEY; a controlled re-encryption can then
    # remove this compatibility path in a later release.
    if settings.salary_encryption_key:
        ciphers.append(_cipher_for_secret(_legacy_secret()))
    last_error: Exception | None = None
    for cipher in ciphers:
        try:
            return cipher.decrypt(payload[:12], payload[12:], AAD).decode("utf-8")
        except Exception as exc:  # pragma: no cover - crypto backend errors vary
            last_error = exc
    raise RuntimeError("Encrypted payroll data could not be decrypted.") from last_error


def encrypt_decimal(value: Decimal | int | float | str) -> str:
    return encrypt_text(format(Decimal(str(value)), "f"))


def decrypt_decimal(value: str | Decimal | int | float) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(decrypt_text(str(value)))


def encrypt_json(value: Any) -> str:
    return encrypt_text(json.dumps(value, separators=(",", ":"), sort_keys=True))


def decrypt_json(value: str | dict | list) -> Any:
    if not isinstance(value, str):
        return value
    return json.loads(decrypt_text(value))
