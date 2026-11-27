"""Generated event sequences against the real ledger, with independent invariants."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, initialize, invariant, precondition, rule
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database.base import Base
from app.models import ActivityEvent, Company, Device, Employee, WorkSession
from app.schemas.session import HeartbeatRequest, SessionEndRequest, SessionStartRequest
from app.services.session_tracking import end_session, record_heartbeat, start_or_get_session

ZONES = st.sampled_from(["UTC", "Africa/Cairo", "Europe/London", "America/New_York", "Asia/Kathmandu"])
STATUSES = st.sampled_from(["active", "idle", "locked", "sleeping", "offline"])


def utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def ledger_row(session):
    return (utc(session.started_at), utc(session.ended_at) if session.ended_at else None,
            session.status, session.active_seconds, session.idle_seconds)


class TimeLedgerMachine(RuleBasedStateMachine):
    def __init__(self):
        super().__init__()
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, autoflush=False, expire_on_commit=False)
        company = Company(name=f"Generated time {uuid4().hex}", status="active")
        self.db.add(company)
        self.db.flush()
        self.employee = Employee(company_id=company.id, name="Generated employee",
                                 email=f"{uuid4()}@example.com", employee_code="GENERATED",
                                 timezone="UTC", status="active")
        self.db.add(self.employee)
        self.db.flush()
        self.device = Device(company_id=company.id, employee_id=self.employee.id,
                             device_name="Isolated generator", installation_id=str(uuid4()),
                             operating_system="Windows 11", agent_version="9.9.9", status="active")
        self.db.add(self.device)
        self.db.commit()
        self.clock = datetime(2026, 3, 28, 21, 59, 50, tzinfo=UTC)
        self.session_id = None
        self.sent = []
        self.closed = {}

    @initialize(zone=ZONES)
    def country(self, zone):
        self.device.timezone = self.employee.timezone = zone
        self.db.commit()

    @rule(seconds=st.integers(min_value=0, max_value=6 * 3600))
    def time_passes(self, seconds):
        self.clock += timedelta(seconds=seconds)

    @rule()
    def start(self):
        result = start_or_get_session(self.db, self.device, SessionStartRequest(started_at=self.clock))
        self.session_id = UUID(result["session"]["id"])

    @precondition(lambda self: self.session_id is not None)
    @rule(status=STATUSES, active=st.integers(0, 100_000), idle=st.integers(0, 100_000), late=st.integers(0, 3600))
    def heartbeat(self, status, active, idle, late):
        payload = HeartbeatRequest(event_id=uuid4(), timestamp=self.clock - timedelta(seconds=late),
                                   status=status, active_seconds=active, idle_seconds=idle,
                                   agent_version="9.9.9")
        result = record_heartbeat(self.db, device=self.device, session_id=self.session_id, payload=payload)
        self.sent.append((self.session_id, payload))
        if result.get("restarted"):
            self.session_id = UUID(result["session"]["id"])

    @precondition(lambda self: bool(self.sent))
    @rule(index=st.integers(0, 100))
    def duplicate_delivery(self, index):
        session_id, payload = self.sent[index % len(self.sent)]
        record_heartbeat(self.db, device=self.device, session_id=session_id, payload=payload)

    @precondition(lambda self: self.session_id is not None)
    @rule(late=st.integers(0, 3600), active=st.integers(0, 100_000))
    def stop(self, late, active):
        end_session(self.db, device=self.device, session_id=self.session_id,
                    payload=SessionEndRequest(event_id=uuid4(), ended_at=self.clock - timedelta(seconds=late),
                                              active_seconds=active, idle_seconds=0, reason="Generated stop"))

    @rule(zone=ZONES)
    def country_changes(self, zone):
        self.device.timezone = zone
        self.db.commit()

    @invariant()
    def immutable_bounded_ledger(self):
        self.db.expire_all()
        sessions = list(self.db.scalars(select(WorkSession)).all())
        assert sum(s.ended_at is None for s in sessions) <= 1
        for session in sessions:
            start = utc(session.started_at)
            end = utc(session.ended_at) if session.ended_at else self.clock
            assert start <= end
            assert 0 <= session.active_seconds + session.idle_seconds <= int((end - start).total_seconds())
            if session.id in self.closed:
                assert ledger_row(session) == self.closed[session.id], "a closed ledger row changed"
            if session.ended_at is not None:
                assert session.status == "ended"
                self.closed[session.id] = ledger_row(session)
            for event in self.db.scalars(select(ActivityEvent).where(ActivityEvent.session_id == session.id)):
                assert start <= utc(event.event_timestamp) <= end, "accepted event lies outside its session"

    def teardown(self):
        self.db.close()
        self.engine.dispose()


TestTimeLedgerSequences = TimeLedgerMachine.TestCase
