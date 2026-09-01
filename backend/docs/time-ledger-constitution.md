# Khaliduo Time Ledger Constitution

This document is the non-negotiable contract for every desktop, API, timeline,
attendance, timesheet, and payroll change. A feature is not complete if it
violates any rule below, even when its screen appears correct.

## Source-of-truth layers

1. **Device liveness** means the server received a request. It uses server time
   and never proves that an employee was working.
2. **Activity evidence** is an accepted event inside one work session. Active
   input is work evidence; idle/lock/sleep is only device state.
3. **The session ledger** owns immutable start/end boundaries and accepted
   counters. It is the only input to the timeline.
4. **Timeline and attendance are projections.** They may be rebuilt, but may
   never invent evidence or mutate the ledger.
5. **Payroll is derived from approved attendance.** It never reads raw device
   liveness as payable work.

## Mandatory invariants

1. `ended_at` is null or greater than/equal to `started_at`.
2. A device has at most one open work session.
3. A closed session is immutable. It cannot be reopened, change status, receive
   counters, or accept another event.
4. Every event timestamp is inside its session's inclusive `[start, end]`
   boundary.
5. A stale timestamp cannot close, backdate, or replace a newer session.
6. Explicit idempotent offline recovery may extend the same local workday
   backwards; it may never cross a local-day boundary.
7. Local midnight is a hard session boundary. The first next-day signal closes
   yesterday at the last proven work instant, no later than local midnight.
8. A next-day idle/lock/sleep heartbeat closes yesterday but does not start
   today. Only fresh active evidence starts today's session.
9. Idle-only device liveness is not attendance, sign-in, sign-out, or work.
10. Timeline queries ignore historical corrupt events outside their session
    bounds. Refreshing a projection cannot revive those events.
11. Client counters are untrusted hints: active time cannot exceed session
    duration, and idle cannot exceed duration minus accepted active time.
12. Client timestamps are work timestamps only. Server receipt time is used for
    device online/offline health.

## Enforcement

- Service guards reject or idempotently ignore stale and post-close writes.
- PostgreSQL constraints and triggers enforce session bounds, closed-session
  immutability, event bounds, and one open session per device.
- Migration `20260805_000054` repairs existing impossible rows and clears their
  derived attendance cache before enabling those guards.
- Regression tests cover overnight idle, post-close events, stale timestamps,
  impossible end times, post-close historical evidence, and idle-only
  attendance.

## Release gate

A time-tracking release may ship only when:

1. session tracking, daily attendance, timeline, and timesheet tests pass;
2. the Alembic schema has exactly one head and upgrades from the previous head;
3. the production audit reports no end-before-start sessions, no ended session
   with a live status, no post-close events created after this migration, and no
   duplicate open session per device;
4. one overnight-idle scenario and one active-return scenario are verified
   against the deployed API before publishing the desktop update.

