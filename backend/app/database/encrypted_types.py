"""SQLAlchemy types that transparently encrypt sensitive payroll fields."""

from decimal import Decimal
from typing import Any

from sqlalchemy import Text
from sqlalchemy.engine.interfaces import Dialect
from sqlalchemy.types import TypeDecorator

from app.core.field_encryption import (
    decrypt_decimal,
    decrypt_json,
    encrypt_decimal,
    encrypt_json,
)


class EncryptedDecimal(TypeDecorator[Decimal]):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Dialect) -> str | None:
        if value is None:
            return None
        return encrypt_decimal(value)

    def process_result_value(self, value: Any, dialect: Dialect) -> Decimal | None:
        if value is None:
            return None
        return decrypt_decimal(value)


class EncryptedJSON(TypeDecorator[Any]):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Dialect) -> str | None:
        if value is None:
            return None
        return encrypt_json(value)

    def process_result_value(self, value: Any, dialect: Dialect) -> Any:
        if value is None:
            return None
        return decrypt_json(value)
