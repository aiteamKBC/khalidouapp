import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileWorkedToday,
  shouldResetDailyCountersForSession,
} from "../electron/services/dailyCounters.ts";

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
