"""Isolated identities for k6: one employee/device/session per virtual user."""

import json
import os
from pathlib import Path
from uuid import uuid4

from sqlalchemy.engine import make_url

from app.core.config import settings
from app.core.security import create_device_token, hash_token
from app.database.session import get_sessionmaker
from app.models import Company, Device, DeviceToken, Employee, TrackingSettings


def main():
    url = make_url(settings.database_url)
    if url.host != "127.0.0.1" or url.database != "khaliduo_e2e" or url.port != 55432:
        raise SystemExit("Load seeding requires the isolated loopback E2E database")
    count = int(os.environ.get("KHALIDUO_LOAD_USERS", "20"))
    if not 1 <= count <= 100:
        raise SystemExit("Load identity count must be between 1 and 100")
    users = []
    with get_sessionmaker()() as db:
        company = Company(name=f"Khaliduo load test {uuid4().hex}", status="active")
        db.add(company)
        db.flush()
        db.add(TrackingSettings(company_id=company.id, screenshot_enabled=False))
        for index in range(count):
            employee = Employee(company_id=company.id, name=f"Load {index}", email=f"{uuid4()}@example.com",
                                employee_code=f"LOAD-{index}", timezone="Africa/Cairo", status="active")
            db.add(employee)
            db.flush()
            device = Device(company_id=company.id, employee_id=employee.id, device_name=f"Load device {index}",
                            installation_id=str(uuid4()), operating_system="Windows test", agent_version="9.9.9",
                            timezone="Africa/Cairo", status="active")
            db.add(device)
            db.flush()
            token = create_device_token(device_id=device.id, company_id=company.id, employee_id=employee.id)
            db.add(DeviceToken(company_id=company.id, device_id=device.id, token_hash=hash_token(token)))
            users.append({"device_id": str(device.id), "token": token})
        db.commit()
        Path(os.environ["KHALIDUO_LOAD_FIXTURE"]).write_text(json.dumps({
            "company_id": str(company.id), "api": "http://127.0.0.1:8010/api/v1", "users": users,
        }), encoding="utf-8")
    print(f"Created {count} disposable load-test identities")


if __name__ == "__main__":
    main()
