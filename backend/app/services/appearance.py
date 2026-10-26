from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.employee_appearance import EmployeeAppearance


class AppearanceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skin: Literal["orbit", "ember", "forest"] = "orbit"
    mode: Literal["dark", "light"] = "dark"


def appearance_row(db: Session, company_id: UUID, employee_id: UUID, *, lock=False):
    statement = select(EmployeeAppearance).where(
        EmployeeAppearance.company_id == company_id,
        EmployeeAppearance.employee_id == employee_id,
    )
    return db.scalar(statement.with_for_update() if lock else statement)


def serialize_appearance(row: EmployeeAppearance | None):
    return {"skin": row.skin, "mode": row.mode} if row else None


def read_appearance(db: Session, company_id: UUID, employee_id: UUID):
    return serialize_appearance(appearance_row(db, company_id, employee_id))


def write_appearance(db: Session, company_id: UUID, employee_id: UUID, payload: AppearanceUpdate):
    changes = payload.model_dump(exclude_unset=True)
    row = appearance_row(db, company_id, employee_id, lock=True)
    if row is None:
        row = EmployeeAppearance(company_id=company_id, employee_id=employee_id, **changes)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            # The browser and desktop can save their first preference together.
            db.rollback()
            row = appearance_row(db, company_id, employee_id, lock=True)
            if row is None:
                raise
        else:
            return serialize_appearance(row)
    for key, value in changes.items():
        setattr(row, key, value)
    db.commit()
    return serialize_appearance(row)
