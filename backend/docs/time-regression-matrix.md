# Time regression coverage

The time ledger contract is defined in [time-ledger-constitution.md](time-ledger-constitution.md).
Run the following before publishing a time tracking release:

| Layer | Coverage | Command (from that project directory) |
| --- | --- | --- |
| Desktop | UTC calibration forward/backward by seconds/days; wrong Windows date; stale/rounded server responses; active/idle counters; fractional ticks; sleep/frozen gaps | `npm test` in `frontend/desktop-agent` |
| Desktop | All seven runtime states against online/offline and 64 combinations of identity/stop/pause/teardown guards (896 combinations) | `tests/clockCalibration.test.ts` |
| Desktop | Offline day boundaries in every IANA zone exposed by the runtime across five DST dates; explicit Cairo skipped midnight, repeated hour, London/New York DST, fractional offsets, date line, year end and leap day | `tests/midnightRollover.test.ts` |
| Desktop | Blind probe restart, physical vs injected input, missing/late reports, persistent inactivity; stop/restart/upgrade and durable offline replay | Full desktop suite |
| Backend | Forty country/day-boundary cases: idle/locked/sleeping/offline, inflated counters, duplicate requests, immutable closed history, late events and fresh active return | `python -m pytest tests/test_session_tracking.py -q` |
| Backend | Attendance, normal/overtime, shift boundaries, approved corrections, timesheets, device handover, stale HR liveness and location lookup failures | `python -m pytest -q` |
| HTTP | Real signed device/admin authentication, wrong Windows zone vs verified country, Cairo DST overnight idle and active return, long Unicode administrative reason and stale replay | `python -m pytest tests/test_time_http_flow.py -q` |
| Dashboard | Monitoring date/polling policy, activity status, authorization boundaries and employee summary adapters | `node --experimental-strip-types --test src/lib/*.test.ts src/components/employee-workspace/adapters.test.ts` in `frontend/admin-dashboard` |

The HTTP tests normally use an in-memory database. To exercise PostgreSQL
constraints/triggers, first create a **disposable database**, migrate it with
`alembic upgrade head`, and set both `DATABASE_URL` and
`KHALIDUO_TIME_TEST_DATABASE_URL` to its SQLAlchemy URL before starting pytest.
The database name must begin with `khaliduo_time_test_`; the fixture rejects any
other name. Destroy that disposable database when finished. Never use employee
records from production as test fixtures.

The unified runner is `scripts/test-khaliduo.ps1 -Suite all`. See
[the E2E guide](../../e2e/README.md) for quick/nightly profiles, portable PostgreSQL,
Hypothesis/fast-check replay, network chaos, authenticated k6 load, the deployment
gate and isolated Windows VM checks. Tests cover specified invariants and
regressions; they cannot prove that every hardware, network or OS condition is error-free.
