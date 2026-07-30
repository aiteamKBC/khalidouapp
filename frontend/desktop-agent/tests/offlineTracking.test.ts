import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeRecoveredCounters,
  offsetRecoveredEventPayload,
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
