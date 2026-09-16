// Second follow-up: ordering must cover an IN-FLIGHT predecessor (tracked by
// manualPauseTransitionPromise, which has no queue row yet), not only an
// already-queued one; and an `ignored:true` acknowledgement must preserve the
// event's payload for reconciliation instead of deleting it. Drives the real
// dispatchManualPauseTransition / sendStateEvent / stopTrackingSession /
// syncPendingQueuesOnce against the real SQL.js queue.
import assert from "node:assert/strict";
import test from "node:test";
import {
  databaseContext,
  functions,
  moduleSource,
  cleanupTemporaryDirectories,
} from "./support/mainHarness.ts";

function orderingContext(sendActivityEvent: unknown) {
  const flags = { endSent: false };
  const c = databaseContext().then((ctx) => {
    Object.assign(ctx, {
      currentSessionId: "A",
      localTrackingSessionId: null,
      manualPauseTransitionPromise: null,
      recalculateWorkedTime: () => {},
      clearIdleReturnVerification: () => {},
      notifyRendererStatus: () => {},
      rebuildTrayMenu: () => {},
      invalidateInFlightScreenshotCaptures: () => {},
      saveTrackingPreferences: () => {},
      closeActiveLocalTrackingSession: () => {},
      clearRuntimeTimers: () => {},
      inputIntegrityMonitor: { stop: () => {} },
      startScreenshotMonitoring: () => {},
      freshSessionStartConfirmed: false,
      sendActivityEvent,
      endSession: async () => {
        flags.endSent = true;
        return { session: { ended_at: null, status: "active" }, workday: {} };
      },
      syncRuntimeFromSession: () => {},
      applyWorkdayState: () => {},
      reconcileTrackingStatusAfterSync: () => null,
      refreshWorkedTodayTotal: async () => {},
      refreshTrackingConfig: () => {},
      refreshTasks: () => {},
      apiResponseStatus: (e: { response?: { status?: number } }) =>
        e.response?.status,
      syncPendingQueues: async () => {},
    });
    moduleSource(ctx, "electron/services/runtimePolicies.ts");
    moduleSource(ctx, "electron/services/sessionSnapshotGuard.ts");
    functions(
      ctx,
      "dispatchManualPauseTransition",
      "sendStateEvent",
      "stopTrackingSession",
    );
    return ctx;
  });
  return { c, flags };
}

test("End is queued behind an in-flight Pause that then fails", async () => {
  let rejectPause: ((e: unknown) => void) | null = null;
  const { c: ctxPromise, flags } = orderingContext(
    () => new Promise((_resolve, reject) => (rejectPause = reject)),
  );
  const c = (await ctxPromise) as Record<string, unknown> & {
    dispatchManualPauseTransition: (t: string, s: string) => Promise<boolean>;
    stopTrackingSession: () => Promise<{ success: boolean }>;
    getDuePendingEvents: (
      n: number,
      o: { force: boolean },
    ) => Array<{ endpoint: string }>;
  };
  try {
    const pause = c.dispatchManualPauseTransition("manual_pause_started", "idle");
    assert.equal(typeof rejectPause, "function", "the Pause request is in flight");
    // No queue row exists yet — the old fix only checked hasPendingEventsForSession.
    const stopPromise = c.stopTrackingSession();
    await Promise.resolve();
    rejectPause!(new Error("late connection failure"));
    await pause;
    await stopPromise;

    assert.equal(
      flags.endSent,
      false,
      "End must NOT be sent directly past an in-flight Pause",
    );
    const due = c.getDuePendingEvents(25, { force: true });
    assert.equal(due.length, 2, "the failed Pause and the End are both queued");
    assert.match(due[0].endpoint, /\/agent\/sessions\/A\/events$/, "Pause first");
    assert.match(due[1].endpoint, /\/agent\/sessions\/A\/end$/, "End after");
  } finally {
    cleanupTemporaryDirectories();
  }
});

test("End is sent directly once an in-flight Pause has delivered", async () => {
  let resolvePause: ((v: unknown) => void) | null = null;
  const { c: ctxPromise, flags } = orderingContext(
    () => new Promise((resolve) => (resolvePause = resolve)),
  );
  const c = (await ctxPromise) as Record<string, unknown> & {
    dispatchManualPauseTransition: (t: string, s: string) => Promise<boolean>;
    stopTrackingSession: () => Promise<{ success: boolean }>;
    getDuePendingEvents: (n: number, o: { force: boolean }) => unknown[];
  };
  try {
    const pause = c.dispatchManualPauseTransition("manual_pause_started", "idle");
    const stopPromise = c.stopTrackingSession();
    await Promise.resolve();
    resolvePause!({ session: { ended_at: null, status: "active" }, workday: {}, pause: {} });
    await pause;
    await stopPromise;

    assert.equal(
      flags.endSent,
      true,
      "with the predecessor delivered, End keeps its direct send",
    );
    assert.equal(
      c.getDuePendingEvents(25, { force: true }).length,
      0,
      "nothing is left queued",
    );
  } finally {
    cleanupTemporaryDirectories();
  }
});

test("an ignored acknowledgement preserves the event payload for reconciliation", async () => {
  try {
    const c = (await databaseContext()) as Record<string, unknown> & {
      enqueuePendingEvent: (o: Record<string, unknown>) => void;
      syncPendingQueuesOnce: (force: boolean) => Promise<void>;
      listIgnoredPendingEvents: () => Array<{
        endpoint: string;
        payloadJson: string;
      }>;
      getDuePendingEvents: (n: number, o: { force: boolean }) => unknown[];
    };
    Object.assign(c, {
      sendQueuedRequest: async () => ({ ignored: true }),
      apiResponseStatus: (e: { response?: { status?: number } }) =>
        e.response?.status,
      cleanupTerminalScreenshotFiles: () => {},
      rebuildTrayMenu: () => {},
    });
    moduleSource(c, "electron/services/pendingSyncPolicy.ts");
    functions(c, "syncPendingQueuesOnce");

    c.enqueuePendingEvent({
      id: "pause",
      method: "POST",
      endpoint: "/agent/sessions/A/events",
      payload: { event_type: "manual_pause_started", idle_seconds: 0 },
      idempotencyKey: "pause",
    });

    await c.syncPendingQueuesOnce(true);

    assert.equal(
      c.getDuePendingEvents(25, { force: true }).length,
      0,
      "the ignored event is not retried",
    );
    const ignored = c.listIgnoredPendingEvents();
    assert.equal(ignored.length, 1, "the payload is durably retained, not deleted");
    assert.match(ignored[0].endpoint, /\/agent\/sessions\/A\/events$/);
    assert.match(ignored[0].payloadJson, /manual_pause_started/);
  } finally {
    cleanupTemporaryDirectories();
  }
});
