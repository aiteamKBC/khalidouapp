import assert from "node:assert/strict";
import test from "node:test";
import { context, functions, moduleSource } from "./support/mainHarness.ts";

const archive = (id: string) => ({
  sessionId: id, startedAt: "2026-08-04T08:40:22Z",
  endedAt: "2026-08-04T08:40:23Z", activeSeconds: 1, idleSeconds: 0,
});

test("background archive import is bounded and cannot adopt or stop today's runtime", async () => {
  let acknowledge!: (value: unknown) => void;
  const pending = new Promise(resolve => { acknowledge = resolve; });
  const sent: string[] = [];
  const retired: string[] = [];
  const c = context({
    closedSessionRecoveryRetryAt: new Map(),
    getPendingLocalTrackingSessions: () => [
      { ...archive("open-local"), endedAt: null }, archive("old-1"), archive("old-2"), archive("old-3"),
    ],
    getLocalTrackingEvents: () => [],
    currentTimezone: () => "UTC",
    recoverClosedSession: async (p: { offlineRecoveryId: string }) => {
      sent.push(p.offlineRecoveryId);
      if (sent.length === 1) await pending;
      return { session_id: `server-${p.offlineRecoveryId}`, duplicate: false };
    },
    markLocalTrackingSessionSynced: (id: string, _at: unknown, server: string) => {
      retired.push(id);
      assert.equal(server, `server-${id}`);
    },
  });
  moduleSource(c, "electron/services/localDayBoundary.ts");
  functions(c, "syncClosedLocalSessions");
  const before = JSON.stringify(c.runtimeStatus);
  const work = c.syncClosedLocalSessions();
  assert.deepEqual(sent, ["old-1"]);
  assert.deepEqual(retired, [], "do not retire evidence before the server acknowledges it");
  acknowledge({});
  await work;
  assert.deepEqual(sent, ["old-1", "old-2"], "at most two historical rows per pass");
  assert.deepEqual(retired, sent);
  assert.equal(c.currentSessionId, "A");
  assert.equal(JSON.stringify(c.runtimeStatus), before);
});

test("failed archives remain durable and back off so later rows can synchronize", async () => {
  const attempts: string[] = [];
  const retired: string[] = [];
  const c = context({
    closedSessionRecoveryRetryAt: new Map(),
    getPendingLocalTrackingSessions: () => [archive("bad"), archive("good")]
      .filter(row => !retired.includes(row.sessionId)),
    getLocalTrackingEvents: () => [],
    currentTimezone: () => "UTC",
    recoverClosedSession: async (p: { offlineRecoveryId: string }) => {
      attempts.push(p.offlineRecoveryId);
      if (p.offlineRecoveryId === "bad") throw new Error("422 incomplete evidence");
      return { session_id: "recovered" };
    },
    markLocalTrackingSessionSynced: (id: string) => retired.push(id),
  });
  moduleSource(c, "electron/services/localDayBoundary.ts");
  functions(c, "syncClosedLocalSessions");
  await c.syncClosedLocalSessions();
  await c.syncClosedLocalSessions();
  assert.deepEqual(attempts, ["bad", "good"]);
  assert.deepEqual(retired, ["good"]);
});

test("a response from a previous enrollment cannot retire its evidence", async () => {
  let retired = false;
  const c = context({
    closedSessionRecoveryRetryAt: new Map(),
    getPendingLocalTrackingSessions: () => [archive("old")],
    getLocalTrackingEvents: () => [],
    currentTimezone: () => "UTC",
    recoverClosedSession: async () => {
      c.enrollmentGeneration++;
      return { session_id: "old-server" };
    },
    markLocalTrackingSessionSynced: () => { retired = true; },
  });
  moduleSource(c, "electron/services/localDayBoundary.ts");
  functions(c, "syncClosedLocalSessions");
  await c.syncClosedLocalSessions();
  assert.equal(retired, false);
});

test("today's timers start even while the historical queue is stalled", async () => {
  let timersRunning = false;
  let queueStarted = false;
  const c = context({
    currentSessionId: null,
    isStartingTrackingAutomatically: false,
    trackingConfig: {},
    freshSessionStartConfirmed: false,
    automaticTrackingRetryTimer: null,
    apiResponseStatus: (error: unknown) => { throw error; },
    getOpenLocalTrackingSession: () => null,
    getCurrentSession: async () => ({ session: {
      id: "today", status: "active", ended_at: null,
    } }),
    promotePendingLocalTrackingSessions: async (p: { activeLocalOnly: boolean }) => {
      assert.equal(p.activeLocalOnly, true);
      return false;
    },
    getAgentConfig: async () => ({}),
    normalizeTrackingConfig: (value: unknown) => value,
    saveTrackingPreferences: () => {},
    syncRuntimeFromSession: (s: { id: string }) => { c.currentSessionId = s.id; },
    startTimers: () => { timersRunning = true; },
    syncPendingQueues: () => {
      queueStarted = true;
      return new Promise(() => {});
    },
    heartbeatTick: async () => {},
    refreshTimeAdjustmentRequests: async () => {},
    refreshLeaveRequests: async () => {},
  });
  functions(c, "startTrackingAutomatically");
  await c.startTrackingAutomatically();
  assert.equal(queueStarted, true);
  assert.equal(timersRunning, true);
  assert.equal(c.currentSessionId, "today");
});
