// Round-5 durable causal-finalization fixes (J1, J2, and the shared Stop/sign-out
// finalizer + deadline) from the 2026-09-16 independent verification. These prove
// the durable-BEFORE-send contract with the real sql.js localDb, and the bounded
// Stop/sign-out finalizer with the extracted stopTrackingSession function.
//
//   J1/J2 — a state transition (Pause) is persisted to the outbox BEFORE its
//           network send, so a concurrent finalization End (ordered last via the
//           sentinel created_at) is head-of-line blocked behind it, and the
//           predecessor survives a deadline/kill exit — not only End.
//   Stop  — stopTrackingSession persists End durably before awaiting predecessors
//           and is bounded by the shared shutdown deadline, so a hung predecessor
//           cannot block Stop/sign-out while End stays durable.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  context,
  databaseContext,
  cleanupTemporaryDirectories,
  functions,
  moduleSource,
  FIXED_NOW,
} from "./support/mainHarness.ts";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const noop = () => {};
const drain = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const session = {
  id: "A",
  started_at: "2026-09-10T10:00:00Z",
  status: "ended",
  ended_at: "2026-09-10T12:00:00Z",
  active_seconds: 600,
  idle_seconds: 0,
};

test("J1/J2 (real sql.js DB): a state transition is durable BEFORE its send, removed on success", async () => {
  const delivery = deferred<Record<string, unknown>>();
  const c = await databaseContext({
    currentSessionId: "A",
    localTrackingSessionId: null,
    isPromotingLocalTrackingSessions: false,
    sendActivityEvent: () => delivery.promise,
    syncRuntimeFromSession: noop,
    applyWorkdayState: noop,
    reconcileTrackingStatusAfterSync: () => null,
    refreshWorkedTodayTotal: async () => {},
    connectionStatusAfterApiFailure: () => "offline",
    apiResponseStatus: () => undefined,
    refreshTrackingConfig: async () => {},
    refreshTasks: async () => {},
    appendLocalTrackingEvent: noop,
    checkpointActiveLocalTrackingSession: noop,
    clearIdleReturnVerification: noop,
  });
  moduleSource(c, "electron/services/sessionSnapshotGuard.ts");
  functions(c, "sendStateEvent");
  const db = c as unknown as {
    sendStateEvent: (t: string, s: string) => Promise<boolean>;
    getDuePendingEvents: (limit?: number, options?: { force?: boolean }) => Array<{ payloadJson: string }>;
  };
  const inflight = db.sendStateEvent("manual_pause_started", "idle");
  await drain();
  // Durable BEFORE the network resolves: the row is already in the outbox.
  const durableTypes = db
    .getDuePendingEvents(25, { force: true })
    .map((e) => JSON.parse(e.payloadJson).event_type)
    .join("|");
  assert.equal(durableTypes, "manual_pause_started", "the transition is persisted before its send completes");

  // On direct-send success the redundant durable row is removed.
  delivery.resolve({ session, workday: null });
  await inflight;
  await drain();
  const remaining = db.getDuePendingEvents(25, { force: true }).length;
  assert.equal(remaining, 0, "the durable row is dropped after a successful direct send");
  cleanupTemporaryDirectories();
});

test("J1 (real sql.js DB): a finalization End cannot become due ahead of an earlier durable predecessor", async () => {
  const c = await databaseContext();
  const db = c as unknown as {
    enqueuePendingEvent: (o: {
      id: string;
      method: string;
      endpoint: string;
      payload: Record<string, unknown>;
      idempotencyKey: string;
      createdAt?: string;
    }) => void;
    getDuePendingEvents: (limit?: number, options?: { force?: boolean }) => Array<{ payloadJson: string }>;
  };
  // Predecessor persisted first (durable-before-send), End persisted later with
  // the sentinel order — the real J1 shape (End enqueued after, must still be last).
  db.enqueuePendingEvent({
    id: "pause",
    method: "POST",
    endpoint: "/agent/sessions/A/events",
    payload: { event_id: "pause", event_type: "manual_pause_started" },
    idempotencyKey: "pause",
  });
  db.enqueuePendingEvent({
    id: "end",
    method: "POST",
    endpoint: "/agent/sessions/A/end",
    payload: { event_id: "end", event_type: "end" },
    idempotencyKey: "end",
    createdAt: "9999-12-31T23:59:59.999Z",
  });
  const order = db
    .getDuePendingEvents(25, { force: true })
    .map((e) => JSON.parse(e.payloadJson).event_type)
    .join("|");
  assert.equal(order, "manual_pause_started|end", "End is delivered only after its predecessor");
  cleanupTemporaryDirectories();
});

// --- Stop/sign-out shared finalizer + deadline (extracted stopTrackingSession) ---

const mainAst = ts.createSourceFile(
  "main.ts",
  fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);

function stopBase(overrides: Record<string, unknown> = {}) {
  const c = context({
    currentSessionId: "A",
    trackingPausedByUser: false,
    waitingForInputAfterIdleSessionClose: false,
    freshSessionStartConfirmed: false,
    freshSessionStartPromptActive: false,
    manualPauseTransitionPromise: null,
    pendingForegroundActivityFlush: null,
    inputIntegrityMonitor: { stop: noop },
    clearRuntimeTimers: noop,
    invalidateInFlightScreenshotCaptures: noop,
    saveTrackingPreferences: noop,
    closeActiveLocalTrackingSession: noop,
    recalculateWorkedTime: noop,
    startScreenshotMonitoring: noop,
    hasPendingEventsForSession: () => false,
    syncPendingQueues: async () => {},
    apiResponseStatus: () => undefined,
    connectionStatusAfterApiFailure: () => "offline",
    syncRuntimeFromSession: noop,
    applyWorkdayState: noop,
    refreshWorkedTodayTotal: async () => {},
    syncTimer: null,
    ...overrides,
  });
  moduleSource(c, "electron/services/dailyCounters.ts");
  moduleSource(c, "electron/services/runtimePolicies.ts");
  functions(c, "localDateKey", "currentTimezone", "syncRuntimeFromSession", "stopTrackingSession");
  return c;
}

test("Stop: End is persisted durably (sentinel-ordered) before awaiting an in-flight foreground upload", async () => {
  const foreground = deferred<void>();
  const enqueued: Array<{ endpoint: string; createdAt?: string }> = [];
  let ends = 0;
  const c = stopBase({
    pendingForegroundActivityFlush: foreground.promise,
    enqueuePendingEvent: (e: { endpoint: string; createdAt?: string }) => enqueued.push(e),
    markPendingEventUploaded: noop,
    endSession: async () => {
      ends++;
      return { session };
    },
  });
  const stop = (c as { stopTrackingSession: () => Promise<unknown> }).stopTrackingSession();
  await drain();
  const durableEnd = enqueued.find((e) => e.endpoint.endsWith("/end"));
  assert.ok(durableEnd, "End is durably queued before the finalization waits");
  assert.equal(durableEnd?.createdAt, "9999-12-31T23:59:59.999Z", "End is ordered last within its session group");
  assert.equal(ends, 0, "End is not sent directly while the foreground upload is still in flight");
  foreground.resolve();
  await stop;
  assert.equal(ends, 1, "End sends directly once the foreground upload delivers");
});

test("Gap 3: orphaned startup session is closed with its ORIGINAL operation-bound token, not the current one", async () => {
  const endCalls: Array<{ sessionId: string; authToken?: string }> = [];
  const c = context({
    // The current global token now belongs to a re-enrolled identity B; cleanup
    // for A's orphaned session must NOT use it.
    getDeviceToken: () => "current-token-B",
    apiResponseStatus: () => undefined,
    endSession: async (o: { sessionId: string; authToken?: string }) => {
      endCalls.push(o);
      return { session };
    },
  });
  functions(c, "endOrphanedStartupSession");
  await (
    c as { endOrphanedStartupSession: (id: string, token: string | null) => Promise<void> }
  ).endOrphanedStartupSession("orphan-session-A", "original-token-A");
  assert.equal(endCalls.length, 1, "the orphan is actively closed");
  assert.equal(endCalls[0].sessionId, "orphan-session-A");
  assert.equal(
    endCalls[0].authToken,
    "original-token-A",
    "cleanup uses the captured original identity's token, not the current global token",
  );
});

test("Gap 3: a revoked/foreign original identity fails safe (no throw, no replay under another identity)", async () => {
  let endAttempts = 0;
  const c = context({
    getDeviceToken: () => "current-token-B",
    apiResponseStatus: (e: { status?: number } | undefined) => e?.status,
    endSession: async () => {
      endAttempts++;
      const error: { status?: number } & Error = Object.assign(
        new Error("revoked"),
        { status: 401 },
      );
      throw error;
    },
  });
  functions(c, "endOrphanedStartupSession");
  // Must not throw, and must not retry the End under any other identity.
  await (
    c as { endOrphanedStartupSession: (id: string, token: string | null) => Promise<void> }
  ).endOrphanedStartupSession("orphan-session-A", "original-token-A");
  assert.equal(endAttempts, 1, "exactly one attempt under the original identity, then fall back to the server timeout");
});

test("Gap 3: no captured token means no cleanup attempt (falls back to server timeout)", async () => {
  let endAttempts = 0;
  const c = context({
    endSession: async () => {
      endAttempts++;
      return { session };
    },
  });
  functions(c, "endOrphanedStartupSession");
  await (
    c as { endOrphanedStartupSession: (id: string, token: string | null) => Promise<void> }
  ).endOrphanedStartupSession("orphan-session-A", null);
  assert.equal(endAttempts, 0, "without a captured credential no End is attempted under any identity");
});

test("Stop deadline: a hung predecessor cannot block Stop — End stays durable, finalization returns at the deadline", async () => {
  const hung = deferred<boolean>(); // predecessor that never resolves
  const enqueued: Array<{ endpoint: string }> = [];
  let deadlineFire: (() => void) | undefined;
  const c = stopBase({
    manualPauseTransitionPromise: hung.promise,
    enqueuePendingEvent: (e: { endpoint: string }) => enqueued.push(e),
    markPendingEventUploaded: noop,
    endSession: async () => ({ session }),
    setTimeout: (cb: () => void) => {
      deadlineFire = cb;
      return 1;
    },
    clearTimeout: noop,
  });
  let settled = false;
  const stop = (c as { stopTrackingSession: () => Promise<{ success: boolean }> })
    .stopTrackingSession()
    .then((r) => {
      settled = true;
      return r;
    });
  await drain();
  assert.equal(enqueued.filter((e) => e.endpoint.endsWith("/end")).length, 1, "End is durably queued up front");
  assert.equal(settled, false, "Stop is still finalizing while the predecessor hangs");
  assert.equal(typeof deadlineFire, "function", "a finalization deadline was armed");
  deadlineFire!();
  const result = await stop;
  assert.equal(result.success, true, "Stop completes at the deadline despite the hung predecessor");
});
