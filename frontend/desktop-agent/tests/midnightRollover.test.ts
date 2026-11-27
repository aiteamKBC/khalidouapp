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

test("day boundaries remain exact across IANA timezones and DST seasons", () => {
  for (const zone of Intl.supportedValuesOf("timeZone")) {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, dateStyle: "short" });
    for (const now of ["2026-03-29T12:00Z", "2026-04-24T12:00Z", "2026-10-25T12:00Z", "2026-10-29T21:30Z", "2026-11-01T12:00Z"]) {
      const end = endOfPreviousLocalDayIso(new Date(now), zone);
      const boundary = new Date(Date.parse(end) + 1);
      const label = `${zone} at ${now}`;
      assert.notEqual(formatter.format(new Date(end)), formatter.format(new Date(now)), label);
      assert.equal(formatter.format(boundary), formatter.format(new Date(now)), label);
      assert.equal(recoveryEndTimestampIso(end, zone), boundary.toISOString(), label);
      assert.equal(recoveryEndTimestampIso(new Date(boundary.getTime() + 12345).toISOString(), zone), new Date(boundary.getTime() + 12345).toISOString(), label);
    }
  }
});

for (const [zone, now, boundary] of [
  ["Africa/Cairo", "2026-04-24T10:00:00Z", "2026-04-23T22:00:00Z"],
  ["Africa/Cairo", "2026-10-29T21:30:00Z", "2026-10-28T21:00:00Z"],
  ["Africa/Cairo", "2026-10-30T10:00:00Z", "2026-10-29T22:00:00Z"],
  ["Europe/London", "2026-03-29T12:00:00Z", "2026-03-29T00:00:00Z"],
  ["Europe/London", "2026-10-25T12:00:00Z", "2026-10-24T23:00:00Z"],
  ["America/New_York", "2026-03-08T12:00:00Z", "2026-03-08T05:00:00Z"],
  ["America/New_York", "2026-11-01T12:00:00Z", "2026-11-01T04:00:00Z"],
  ["Asia/Kolkata", "2026-11-27T12:00:00Z", "2026-11-26T18:30:00Z"],
  ["Asia/Kathmandu", "2026-11-27T12:00:00Z", "2026-11-26T18:15:00Z"],
  ["Pacific/Kiritimati", "2026-12-31T12:00:00Z", "2026-12-31T10:00:00Z"],
  ["Pacific/Pago_Pago", "2027-01-01T08:00:00Z", "2026-12-31T11:00:00Z"],
  ["UTC", "2028-02-29T12:00:00Z", "2028-02-29T00:00:00Z"],
]) {
  test(`offline rollover uses the true day boundary in ${zone} at ${now}`, () => {
    const end = new Date(Date.parse(boundary) - 1).toISOString();
    assert.equal(endOfPreviousLocalDayIso(new Date(now), zone), end);
    assert.equal(recoveryEndTimestampIso(end, zone), new Date(boundary).toISOString());
  });
}

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
