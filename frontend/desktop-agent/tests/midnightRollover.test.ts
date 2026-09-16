// Bug 3: offline work crossing midnight must be closed within the previous local
// day (so the backend credits it there) and recovery must verify the work was
// credited before retiring the local row.
import assert from "node:assert/strict";
import test from "node:test";

import {
  endOfPreviousLocalDayIso,
  recoveryEndTimestampIso,
} from "../electron/services/localDayBoundary.ts";
import { recoveryResponseCredited } from "../electron/services/offlineTracking.ts";
import { context, functions, moduleSource } from "./support/mainHarness.ts";

test("endOfPreviousLocalDayIso returns the last instant of the prior local day (UTC)", () => {
  assert.equal(
    endOfPreviousLocalDayIso(new Date("2026-09-10T00:00:00.250Z"), "UTC"),
    "2026-09-09T23:59:59.999Z",
  );
});

test("endOfPreviousLocalDayIso respects a non-UTC timezone", () => {
  // 2026-09-10T00:30:00Z is 2026-09-10T03:30 in +03:00; the prior local day ends
  // at 2026-09-09T23:59:59.999 local == 2026-09-09T20:59:59.999Z.
  assert.equal(
    endOfPreviousLocalDayIso(new Date("2026-09-10T00:30:00.000Z"), "Etc/GMT-3"),
    "2026-09-09T20:59:59.999Z",
  );
});

test("recoveryEndTimestampIso bumps a day-boundary end to the next local midnight (UTC)", () => {
  // A rollover-bounded end (…23:59:59.999) becomes the day boundary so end_session
  // credits the final whole second the integer wall-clock cap would otherwise lose.
  assert.equal(
    recoveryEndTimestampIso("2026-09-09T23:59:59.999Z", "UTC"),
    "2026-09-10T00:00:00.000Z",
  );
});

test("recoveryEndTimestampIso bumps a day-boundary end for a non-UTC timezone", () => {
  // 2026-09-09T20:59:59.999Z is 23:59:59.999 in +03:00; the boundary is the next
  // local midnight == 2026-09-09T21:00:00Z.
  assert.equal(
    recoveryEndTimestampIso("2026-09-09T20:59:59.999Z", "Etc/GMT-3"),
    "2026-09-09T21:00:00.000Z",
  );
});

test("recoveryEndTimestampIso leaves a mid-day checkpoint end unchanged", () => {
  // A checkpoint-bounded rollover (not at a day boundary) must NOT be bumped.
  assert.equal(
    recoveryEndTimestampIso("2026-09-09T22:47:13.000Z", "UTC"),
    "2026-09-09T22:47:13.000Z",
  );
  // A normal stop mid-day is also untouched.
  assert.equal(
    recoveryEndTimestampIso("2026-09-09T14:00:00.000Z", "UTC"),
    "2026-09-09T14:00:00.000Z",
  );
});

test("recoveryResponseCredited rejects restarted/ignored responses", () => {
  assert.equal(recoveryResponseCredited({}), true);
  assert.equal(recoveryResponseCredited({ restarted: true }), false);
  assert.equal(recoveryResponseCredited({ ignored: true }), false);
});

test("live midnight rollover closes yesterday within the previous local day", () => {
  let closed: { at: string; reason: string } | null = null;
  const c = context({
    activeCounterDate: "2026-09-09",
    localTrackingSessionId: "local",
    requestPolicy: { timezone: "UTC" },
    closeActiveLocalTrackingSession: (at: string, reason: string) => {
      closed = { at, reason };
    },
    resetDailyRuntimeCounters: () => {},
    automaticTrackingIsExpected: () => false,
    notifyRendererStatus: () => {},
    rebuildTrayMenu: () => {},
  });
  (c as Record<string, unknown>).runtimeStatus = {
    ...(c as { runtimeStatus: Record<string, unknown> }).runtimeStatus,
    requestPolicy: { timezone: "UTC" },
  };
  moduleSource(c, "electron/services/localDayBoundary.ts");
  functions(c, "currentTimezone", "localDateKey", "ensureCurrentCounterDate");
  (c as unknown as { ensureCurrentCounterDate: (d: Date) => void }).ensureCurrentCounterDate(
    new Date("2026-09-10T00:00:00.250Z"),
  );
  assert.notEqual(closed, null);
  assert.equal(
    closed!.at,
    "2026-09-09T23:59:59.999Z",
    "yesterday must be closed in the previous local day, not at the next-day tick",
  );
  assert.equal(closed!.reason, "daily_rollover");
});
