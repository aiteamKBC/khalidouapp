// Behavior test for Bug 2: retrying offline recovery after a partial failure
// must not count the same local work twice. Runs the real
// promotePendingLocalTrackingSessions against a backend mock that mimics the
// server's monotonic/absolute heartbeat semantics.
import assert from "node:assert/strict";
import test from "node:test";

import { context, functions, moduleSource } from "./support/mainHarness.ts";

function recoveryContext(row: Record<string, unknown>) {
  let serverActive = 0;
  const sent: number[] = [];
  let ends = 0;
  let synced = false;
  // In-memory stand-in for the durable per-session baseline columns.
  let baseline: { activeSeconds: number; idleSeconds: number } | null = null;
  const c = context({
    currentSessionId: null,
    localTrackingSessionId: null,
    getPendingLocalTrackingSessions: () => (synced ? [] : [row]),
    getPendingLocalTrackingSession: () => (synced ? null : row),
    getLocalTrackingEvents: () => [],
    getRecoveryBaseline: () => baseline,
    setRecoveryBaseline: (
      _id: string,
      b: { activeSeconds: number; idleSeconds: number },
    ) => {
      if (!baseline) baseline = b;
    },
    startSession: async () => ({
      session: {
        id: "server",
        active_seconds: serverActive,
        idle_seconds: 0,
        ended_at: null,
      },
    }),
    sendHeartbeat: async (payload: { activeSeconds: number }) => {
      sent.push(payload.activeSeconds);
      // Monotonic/absolute, wall-clock capped — the real backend behaviour.
      serverActive = Math.max(serverActive, Math.min(3600, payload.activeSeconds));
      return { session: { id: "server", active_seconds: serverActive } };
    },
    endSession: async () => {
      ends += 1;
      if (ends === 1) throw new Error("connection dropped before end");
      return { session: { id: "server" } };
    },
    markLocalTrackingSessionSynced: () => {
      synced = true;
    },
  });
  moduleSource(c, "electron/services/dailyCounters.ts");
  moduleSource(c, "electron/services/offlineTracking.ts");
  moduleSource(c, "electron/services/localDayBoundary.ts");
  functions(
    c,
    "currentTimezone",
    "localDateKey",
    "heartbeatStatus",
    "replayLocalTrackingEvents",
    "promotePendingLocalTrackingSessions",
  );
  return { c: c as Record<string, unknown>, sent: () => sent };
}

test("retrying recovery of a 600s local record submits 600 again, never 1200", async () => {
  const row = {
    sessionId: "local",
    deviceId: "device",
    startedAt: "2026-09-10T10:00:00Z",
    endedAt: "2026-09-10T11:00:00Z",
    lastCheckpointAt: "2026-09-10T11:00:00Z",
    activeSeconds: 600,
    idleSeconds: 3000,
    status: "ended",
  };
  const { c, sent } = recoveryContext(row);
  const promote = c.promotePendingLocalTrackingSessions as () => Promise<boolean>;
  // First attempt fails at the end step (after the heartbeat succeeded).
  await assert.rejects(promote());
  // Retry: the durable baseline is reused, so the submitted counter is stable.
  await promote();
  assert.deepEqual(
    sent(),
    [600, 600],
    "the same local record must not inflate from 600 to 1200 on retry",
  );
});

test("a pre-existing server baseline is preserved additively and stays idempotent", async () => {
  // Server already has 1200s of independent online work when recovery starts;
  // the local offline record adds 600s. Total must be 1800 exactly, on retry too.
  const row = {
    sessionId: "local",
    deviceId: "device",
    startedAt: "2026-09-10T10:00:00Z",
    endedAt: "2026-09-10T11:00:00Z",
    lastCheckpointAt: "2026-09-10T11:00:00Z",
    activeSeconds: 600,
    idleSeconds: 0,
    status: "ended",
  };
  const { c, sent } = recoveryContext(row);
  // Seed the server session with 1200s pre-existing work at first start.
  (c as Record<string, unknown>).startSession = (() => {
    let started = false;
    return async () => {
      const active = started ? 1800 : 1200;
      started = true;
      return {
        session: { id: "server", active_seconds: active, idle_seconds: 0, ended_at: null },
      };
    };
  })();
  const promote = c.promotePendingLocalTrackingSessions as () => Promise<boolean>;
  await assert.rejects(promote());
  await promote();
  assert.deepEqual(
    sent(),
    [1800, 1800],
    "baseline 1200 + local 600 = 1800 once, preserved on retry",
  );
});
