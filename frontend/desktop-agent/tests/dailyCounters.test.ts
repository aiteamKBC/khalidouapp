import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdoptPromotedLocalSession,
  isSessionCounterToday,
  promotableLocalSessionIds,
  reconcileWorkedToday,
  resolveSessionCounterSeconds,
  shouldRolloverRestoredLocalSession,
  shouldResetDailyCountersForSession,
} from "../electron/services/dailyCounters.ts";

test("a session that started today belongs to today", () => {
  assert.equal(
    isSessionCounterToday({
      sessionCounterDate: "2026-09-08",
      todayCounterDate: "2026-09-08",
    }),
    true,
  );
});

test("a session continued from a previous day does not belong to today", () => {
  assert.equal(
    isSessionCounterToday({
      sessionCounterDate: "2026-09-07",
      todayCounterDate: "2026-09-08",
    }),
    false,
  );
});

test("a today session takes the higher of server and local seconds", () => {
  assert.equal(
    resolveSessionCounterSeconds({
      belongsToToday: true,
      serverSeconds: 1200,
      localSeconds: 1100,
    }),
    1200,
  );
  // The live local ticker can be ahead of a lagging server snapshot.
  assert.equal(
    resolveSessionCounterSeconds({
      belongsToToday: true,
      serverSeconds: 1100,
      localSeconds: 1200,
    }),
    1200,
  );
});

test("a continued session preserves today's local portion instead of zeroing", () => {
  // Regression for the cross-midnight reset: a session started yesterday must
  // NOT reset today's counter to 0 (which happened on every heartbeat), and
  // must NOT adopt the server's multi-day total.
  assert.equal(
    resolveSessionCounterSeconds({
      belongsToToday: false,
      serverSeconds: 40_000, // multi-day server total (yesterday + today)
      localSeconds: 900, // 15 minutes accrued locally since midnight
    }),
    900,
  );
});

test("a server rollover resets counters even when the local date was already advanced", () => {
  assert.equal(
    shouldResetDailyCountersForSession({
      activeCounterDate: "2026-08-03",
      todayCounterDate: "2026-08-03",
      previousSessionCounterDate: "2026-08-02",
      nextSessionCounterDate: "2026-08-03",
      changedSession: true,
    }),
    true,
  );
});

test("a same-day session restart preserves the accumulated workday", () => {
  assert.equal(
    shouldResetDailyCountersForSession({
      activeCounterDate: "2026-08-03",
      todayCounterDate: "2026-08-03",
      previousSessionCounterDate: "2026-08-03",
      nextSessionCounterDate: "2026-08-03",
      changedSession: true,
    }),
    false,
  );
});

test("today's authoritative total replaces yesterday's larger cached total", () => {
  assert.deepEqual(
    reconcileWorkedToday({
      trackedTodaySeconds: 165,
      activeSeconds: 62,
      previousBaseSeconds: 19_454,
      preservePreviousBase: false,
    }),
    {
      baseSeconds: 103,
      workedTodaySeconds: 165,
    },
  );
});

test("same-day local seconds remain visible while the server is slightly behind", () => {
  assert.deepEqual(
    reconcileWorkedToday({
      trackedTodaySeconds: 5_090,
      activeSeconds: 100,
      previousBaseSeconds: 5_000,
      preservePreviousBase: true,
    }),
    {
      baseSeconds: 5_000,
      workedTodaySeconds: 5_100,
    },
  );
});

test("a previous-day restored local session rolls over before replay", () => {
  assert.equal(
    shouldRolloverRestoredLocalSession({
      checkpointCounterDate: "2026-08-04",
      todayCounterDate: "2026-08-06",
    }),
    true,
  );
  assert.equal(
    shouldRolloverRestoredLocalSession({
      checkpointCounterDate: "2026-08-06",
      todayCounterDate: "2026-08-06",
    }),
    false,
  );
});

test("historical promotion cannot adopt a newer local session", () => {
  assert.equal(
    canAdoptPromotedLocalSession({
      promotedSessionId: "old-session",
      activeLocalSessionId: "today-session",
    }),
    false,
  );
  assert.equal(
    canAdoptPromotedLocalSession({
      promotedSessionId: "today-session",
      activeLocalSessionId: "today-session",
    }),
    true,
  );
});

test("a restart recovers every bounded local segment before starting a new server session", () => {
  assert.deepEqual(
    promotableLocalSessionIds({
      pendingSessions: [
        { sessionId: "closed-before-quit" },
        { sessionId: "open-after-crash" },
      ],
      activeLocalSessionId: "open-after-crash",
      hasOpenServerSession: false,
    }),
    ["closed-before-quit", "open-after-crash"],
  );
});

test("bounded historical rows cannot close an already-running server session", () => {
  assert.deepEqual(
    promotableLocalSessionIds({
      pendingSessions: [{ sessionId: "closed-before-quit" }],
      activeLocalSessionId: null,
      hasOpenServerSession: true,
    }),
    [],
  );
  assert.deepEqual(
    promotableLocalSessionIds({
      pendingSessions: [
        { sessionId: "closed-before-quit" },
        { sessionId: "matching-live-local" },
      ],
      activeLocalSessionId: "matching-live-local",
      hasOpenServerSession: true,
    }),
    ["matching-live-local"],
  );
});
