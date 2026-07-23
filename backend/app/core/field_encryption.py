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


@lru_cache(maxsize=1)
def _cipher() -> AESGCM:
    secret = settings.salary_encryption_key
    if not secret:
        # Production rejects an empty dedicated key. This fallback is only for
        # local development and isolated tests.
        secret = f"development-only:{settings.jwt_secret_key}"
    return AESGCM(hashlib.sha256(secret.encode("utf-8")).digest())


def encrypt_text(value: str) -> str:
    nonce = os.urandom(12)
    encrypted = _cipher().encrypt(nonce, value.encode("utf-8"), AAD)
    return PREFIX + base64.urlsafe_b64encode(nonce + encrypted).decode("ascii")


def decrypt_text(value: str) -> str:
    if not value.startswith(PREFIX):
        return value
    try:
        payload = base64.urlsafe_b64decode(value[len(PREFIX) :].encode("ascii"))
        return _cipher().decrypt(payload[:12], payload[12:], AAD).decode("utf-8")
    except Exception as exc:  # pragma: no cover - crypto backend errors vary
        raise RuntimeError("Encrypted payroll data could not be decrypted.") from exc


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
