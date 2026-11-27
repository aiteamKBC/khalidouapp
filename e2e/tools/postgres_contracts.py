"""Verify HTTP ledger regressions on a migrated disposable loopback PostgreSQL DB."""

import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from app.core.config import settings

root = Path(__file__).resolve().parents[2]
url = make_url(settings.database_url)
if url.host != "127.0.0.1" or url.port != 55432 or url.database != "khaliduo_e2e":
    raise SystemExit("PostgreSQL contract tests require the isolated local test cluster")
name = "khaliduo_time_test_" + uuid4().hex
admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT", poolclass=NullPool)
created = False
try:
    with admin.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
        created = True
    test_url = url.set(database=name).render_as_string(hide_password=False)
    env = dict(os.environ, DATABASE_URL=test_url, KHALIDUO_TIME_TEST_DATABASE_URL=test_url, APP_ENV="testing")
    for revision in ["20261026_000064", "head"]:
        subprocess.run([sys.executable, "-m", "alembic", "-c", str(root / "e2e/.runtime/alembic.ini"), "upgrade", revision],
                       cwd=root / "e2e/.runtime", env=env, check=True)
    subprocess.run([sys.executable, "-m", "pytest", str(root / "backend/tests/test_time_http_flow.py"), "-q",
                    "--tb=short", "--junitxml=" + os.environ.get("KHALIDUO_PG_REPORT", str(root / "e2e/.runtime/postgres-http.xml"))],
                   cwd=root / "e2e/.runtime", env=env, check=True)
finally:
    if created:
        with admin.connect() as connection:
            connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
    admin.dispose()
