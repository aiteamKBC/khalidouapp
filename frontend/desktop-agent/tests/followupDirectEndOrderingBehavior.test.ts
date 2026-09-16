// Follow-up finding 3: a direct End (Stop) must not overtake a queued predecessor
// for the same session. With a backed-off Pause already in the durable queue,
// sending End directly would close the session server-side before the Pause is
// delivered, and the closed session would reject the Pause as immutable. The fix
// enqueues End behind its predecessors so ordered replay delivers Pause → End.
// This test drives the real stopTrackingSession against the real SQL.js queue.
import assert from "node:assert/strict";
import test from "node:test";
import {
  databaseContext,
  functions,
  cleanupTemporaryDirectories,
} from "./support/mainHarness.ts";

test("direct End is queued behind a backed-off Pause for the same session", async () => {
  try {
    const queue = await databaseContext();
    queue.enqueuePendingEvent({
      id: "pause",
      method: "POST",
      endpoint: "/agent/sessions/A/events",
      payload: { event_type: "manual_pause_started" },
      idempotencyKey: "pause",
    });
    // The Pause failed once and is now backed off (still pending delivery).
    queue.markPendingEventFailed("pause", 0);

    let endSessionCalled = false;
    let replayTriggered = false;
    Object.assign(queue, {
      currentSessionId: "A",
      manualPauseTransitionPromise: null,
      recalculateWorkedTime: () => {},
      invalidateInFlightScreenshotCaptures: () => {},
      saveTrackingPreferences: () => {},
      closeActiveLocalTrackingSession: () => {},
      clearRuntimeTimers: () => {},
      inputIntegrityMonitor: { stop: () => {} },
      startScreenshotMonitoring: () => {},
      freshSessionStartConfirmed: false,
      endSession: async () => {
        endSessionCalled = true;
        return { session: {} };
      },
      syncPendingQueues: async () => {
        replayTriggered = true;
      },
      syncRuntimeFromSession: () => {},
    });
    functions(queue, "stopTrackingSession");

    const result = await queue.stopTrackingSession();
    assert.equal(result.success, true);
    assert.equal(
      endSessionCalled,
      false,
      "End must NOT be sent directly while a predecessor is queued",
    );
    assert.equal(replayTriggered, true, "an ordered replay pass is triggered");

    // Both events are now queued for session A, in causal order: Pause then End.
    const due = queue.getDuePendingEvents(25, { force: true });
    assert.equal(due.length, 2, "Pause and End are both queued");
    assert.equal(due[0].id, "pause", "the Pause remains ahead of the End");
    assert.match(due[1].endpoint, /\/agent\/sessions\/A\/end$/);
  } finally {
    cleanupTemporaryDirectories();
  }
});

test("a direct End with no queued predecessor is still sent immediately", async () => {
  try {
    const queue = await databaseContext();
    let endSessionCalled = false;
    Object.assign(queue, {
      currentSessionId: "solo",
      manualPauseTransitionPromise: null,
      recalculateWorkedTime: () => {},
      invalidateInFlightScreenshotCaptures: () => {},
      saveTrackingPreferences: () => {},
      closeActiveLocalTrackingSession: () => {},
      clearRuntimeTimers: () => {},
      inputIntegrityMonitor: { stop: () => {} },
      startScreenshotMonitoring: () => {},
      freshSessionStartConfirmed: false,
      endSession: async () => {
        endSessionCalled = true;
        return { session: {} };
      },
      applyWorkdayState: () => {},
      refreshWorkedTodayTotal: async () => {},
      syncRuntimeFromSession: () => {},
    });
    functions(queue, "stopTrackingSession");
    await queue.stopTrackingSession();
    assert.equal(
      endSessionCalled,
      true,
      "with nothing queued, End keeps its fast local-first direct send",
    );
  } finally {
    cleanupTemporaryDirectories();
  }
});
