// Behavior test for Bug 7: a heartbeat response for session A that arrives after
// a task switch established session B must NOT restore A. Runs the real
// heartbeatTick extracted from main.ts.
import assert from "node:assert/strict";
import test from "node:test";

import { context, functions, moduleSource } from "./support/mainHarness.ts";

type Ctx = Record<string, unknown> & {
  heartbeatTick: (opts: { refreshMetadata?: boolean }) => Promise<void>;
  currentSessionId: string | null;
  runtimeStatus: Record<string, unknown>;
};

function heartbeatContext(release: { fn?: (value: unknown) => void }) {
  const c = context({
    sendHeartbeat: () =>
      new Promise((resolve) => {
        release.fn = resolve;
      }),
    recalculateWorkedTime: () => {},
    shouldWaitForInputBeforeRestart: () => false,
    applyPauseState: () => {},
    applyWorkdayState: () => {},
    apiResponseStatus: (e: { status?: number }) => e?.status,
    inputIntegrityObservation: () => undefined,
    scheduleAutomaticTrackingRestart: () => {},
    isDeviceIdentityMismatch: () => false,
    axios: { isAxiosError: () => false },
    enqueuePendingEvent: () => {},
    beginLocalTrackingSession: () => false,
    resetForDeviceReenrollment: () => {},
  });
  moduleSource(c, "electron/services/dailyCounters.ts");
  moduleSource(c, "electron/services/trackingStatusReconcile.ts");
  moduleSource(c, "electron/services/sessionSnapshotGuard.ts");
  moduleSource(c, "electron/services/runtimePolicies.ts");
  moduleSource(c, "electron/services/idlePolicy.ts");
  functions(
    c,
    "currentTimezone",
    "localDateKey",
    "syncRuntimeFromSession",
    "heartbeatTick",
  );
  return c as unknown as Ctx;
}

test("a late heartbeat for A does not replace the newer session B", async () => {
  const release: { fn?: (value: unknown) => void } = {};
  const c = heartbeatContext(release);
  const pending = c.heartbeatTick({ refreshMetadata: false });
  // A task switch establishes session B while the heartbeat for A is in flight.
  c.currentSessionId = "B";
  c.runtimeStatus.sessionStartedAt = "2026-09-10T11:59:00Z";
  release.fn!({
    session: {
      id: "A",
      started_at: "2026-09-10T10:00:00Z",
      ended_at: null,
      status: "active",
      active_seconds: 600,
      idle_seconds: 0,
    },
  });
  await pending;
  assert.equal(
    c.currentSessionId,
    "B",
    "the stale heartbeat for A must not revert the current session to A",
  );
});

test("a heartbeat for the still-current session A is applied normally", async () => {
  const release: { fn?: (value: unknown) => void } = {};
  const c = heartbeatContext(release);
  const pending = c.heartbeatTick({ refreshMetadata: false });
  release.fn!({
    session: {
      id: "A",
      started_at: "2026-09-10T10:00:00Z",
      ended_at: null,
      status: "active",
      active_seconds: 700,
      idle_seconds: 0,
    },
  });
  await pending;
  assert.equal(c.currentSessionId, "A");
  assert.equal(c.runtimeStatus.activeSeconds, 700);
});
