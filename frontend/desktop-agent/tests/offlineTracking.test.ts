import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeRecoveredCounters,
  offsetRecoveredEventPayload,
  restoreOpenLocalTrackingSnapshot,
} from "../electron/services/offlineTracking.ts";

test("offline counters are added to the existing server session", () => {
  assert.deepEqual(
    mergeRecoveredCounters(
      { activeSeconds: 3_600, idleSeconds: 120 },
      { activeSeconds: 900, idleSeconds: 30 },
    ),
    { activeSeconds: 4_500, idleSeconds: 150 },
  );
});

test("replayed idle events are offset by the server idle baseline", () => {
  assert.deepEqual(
    offsetRecoveredEventPayload(
      {
        status: "active",
        idle_seconds: 45,
        idle_seconds_before_gap: 15,
        idle_gap_seconds: 30,
      },
      120,
    ),
    {
      status: "active",
      idle_seconds: 165,
      idle_seconds_before_gap: 135,
      idle_gap_seconds: 30,
    },
  );
});

test("invalid or negative counters cannot reduce payroll totals", () => {
  assert.deepEqual(
    mergeRecoveredCounters(
      { activeSeconds: 100.9, idleSeconds: Number.NaN },
      { activeSeconds: -50, idleSeconds: 20.8 },
    ),
    { activeSeconds: 100, idleSeconds: 20 },
  );
});

test("an open local session resumes with the same counters after an update", () => {
  assert.deepEqual(
    restoreOpenLocalTrackingSnapshot(
      {
        startedAt: "2026-07-30T08:00:00.000Z",
        lastCheckpointAt: "2026-07-30T10:14:55.000Z",
        status: "active",
        activeSeconds: 7_195.9,
        idleSeconds: 900.8,
      },
      new Date("2026-07-30T10:15:00.000Z"),
    ),
    {
      startedAt: "2026-07-30T08:00:00.000Z",
      lastCheckpointAt: "2026-07-30T10:14:55.000Z",
      status: "active",
      activeSeconds: 7_195,
      idleSeconds: 900,
    },
  );
});

test("invalid persisted session data cannot invent future time", () => {
  assert.deepEqual(
    restoreOpenLocalTrackingSnapshot(
      {
        startedAt: "2099-01-01T00:00:00.000Z",
        lastCheckpointAt: "invalid",
        status: "unknown",
        activeSeconds: -100,
        idleSeconds: Number.NaN,
      },
      new Date("2026-07-30T10:15:00.000Z"),
    ),
    {
      startedAt: "2026-07-30T10:15:00.000Z",
      lastCheckpointAt: "2026-07-30T10:15:00.000Z",
      status: "active",
      activeSeconds: 0,
      idleSeconds: 0,
    },
  );
});
