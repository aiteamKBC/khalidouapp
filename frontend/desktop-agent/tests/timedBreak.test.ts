import assert from "node:assert/strict";
import test from "node:test";
import { timedBreakState } from "../electron/services/timedBreak.ts";
import { context, FIXED_NOW, functions, databaseContext, cleanupTemporaryDirectories } from "./support/mainHarness.ts";

const startedAt = new Date(FIXED_NOW).toISOString();

test("break warning starts at 45 minutes, ending starts at 60 minutes", () => {
  assert.equal(timedBreakState(startedAt, FIXED_NOW + 2699_999)?.warning, false);
  assert.equal(timedBreakState(startedAt, FIXED_NOW + 2700_000)?.warning, true);
  assert.equal(timedBreakState(startedAt, FIXED_NOW + 3599_999)?.expired, false);
  assert.equal(timedBreakState(startedAt, FIXED_NOW + 3600_000)?.expired, true);
  assert.equal(timedBreakState(startedAt, FIXED_NOW + 7200_000)?.remainingSeconds, 0);
  assert.equal(timedBreakState(null), null);
  assert.equal(timedBreakState("invalid"), null);
  assert.equal(timedBreakState(startedAt, FIXED_NOW - 5000)?.seconds, 0);
});

function breakContext(overrides: Record<string, unknown> = {}) {
  const c = context({
    hasTrackingSession: () => true,
    saveTrackingPreferences: () => {},
    recalculateWorkedTime: () => {},
    invalidateInFlightScreenshotCaptures: () => {},
    dispatchManualPauseTransition: async () => true,
    eligibleIdleSecondsBeforeCurrentIdle: 0,
    idleWallClockStartedAt: null,
    ...overrides,
  });
  functions(c, "clearTimedBreak", "pauseTimedBreak", "pauseTracking", "endExpiredBreak");
  return c;
}

test("Take Break persists its own timestamp and preserves it on repeated clicks", async () => {
  let saves = 0;
  const c = breakContext({ saveTrackingPreferences: () => saves++ });
  assert.equal((await c.pauseTracking({ takeBreak: true })).success, true);
  assert.equal(c.runtimeStatus.breakStartedAt, startedAt);
  assert.equal(c.breakSessionSnapshot.id, "A");
  assert.equal(c.unpaidPauseActive, true);
  c.setClock(FIXED_NOW + 120_000);
  await c.pauseTracking({ takeBreak: true });
  assert.equal(c.runtimeStatus.breakStartedAt, startedAt);
  assert.equal(saves, 1);
});

test("ordinary Pause does not create an automatic shift deadline", async () => {
  const c = breakContext();
  await c.pauseTracking();
  assert.equal(c.runtimeStatus.breakStartedAt, undefined);
});

test("only an expired, enrolled break finalizes and clears before awaiting delivery", async () => {
  let finish!: () => void;
  const delivery = new Promise<void>((resolve) => { finish = resolve; });
  const reasons: string[] = [];
  const c = breakContext({
    stopTrackingSession: async (reason: string) => {
      reasons.push(reason);
      c.clearTimedBreak();
      c.trackingPausedByUser = true;
      await delivery;
    },
  });
  await c.pauseTracking({ takeBreak: true });
  c.setClock(FIXED_NOW + 3599_999);
  await c.endExpiredBreak();
  assert.equal(reasons.length, 0);
  c.setClock(FIXED_NOW + 3600_000);
  const pending = c.endExpiredBreak();
  assert.equal(c.runtimeStatus.breakStartedAt, null);
  assert.equal(c.trackingPausedByUser, true);
  await c.endExpiredBreak();
  assert.equal(reasons.length, 1);
  finish();
  await pending;
});

test("Resume freezes the break total and cancels ending while working", async () => {
  let ends = 0;
  const c = breakContext({ stopTrackingSession: async () => { ends++; } });
  functions(c, "resumeTracking");
  await c.pauseTracking({ takeBreak: true });
  c.setClock(FIXED_NOW + 2700_000);
  assert.equal((await c.resumeTracking()).success, true);
  assert.equal(c.runtimeStatus.breakStartedAt, null);
  assert.equal(c.runtimeStatus.breakElapsedSeconds, 2700);
  c.setClock(FIXED_NOW + 3600_000);
  await c.endExpiredBreak();
  assert.equal(ends, 0);
  assert.equal(timedBreakState(null, c.now(), c.runtimeStatus.breakElapsedSeconds)?.seconds, 2700);
});

test("separate breaks accumulate, excluding work time, and reach the original 45/60 minute limits", async () => {
  let ends = 0;
  const c = breakContext({ stopTrackingSession: async () => { ends++; c.clearTimedBreak(); } });
  functions(c, "resumeTracking");
  await c.pauseTracking({ takeBreak: true });
  c.setClock(FIXED_NOW + 20 * 60_000);
  await c.resumeTracking();
  assert.equal(c.runtimeStatus.breakElapsedSeconds, 1200);
  c.setClock(FIXED_NOW + 140 * 60_000);
  await c.endExpiredBreak();
  assert.equal(ends, 0);
  await c.pauseTracking({ takeBreak: true });
  assert.equal(c.runtimeStatus.breakElapsedSeconds, 1200);
  c.setClock(FIXED_NOW + 165 * 60_000);
  const warning = timedBreakState(c.runtimeStatus.breakStartedAt, c.now(), c.runtimeStatus.breakElapsedSeconds)!;
  assert.equal(warning.seconds, 2700);
  assert.equal(warning.warning, true);
  await c.endExpiredBreak();
  assert.equal(ends, 0);
  c.setClock(FIXED_NOW + 180 * 60_000 - 1);
  await c.endExpiredBreak();
  assert.equal(ends, 0);
  c.setClock(FIXED_NOW + 180 * 60_000);
  await c.endExpiredBreak();
  assert.equal(ends, 1);
  assert.equal(c.runtimeStatus.breakElapsedSeconds, 0);
});

test("saved break total stays paused across restart and resumes from its saved value", async () => {
  let stored: string;
  const c = breakContext({
    fs: {
      readFileSync: () => stored,
      mkdirSync: () => {},
      writeFileSync: (_path: string, value: string) => { stored = value; },
    },
    app: { getPath: () => "preview" },
  });
  functions(c, "resumeTracking", "loadTrackingPreferences", "getTrackingPreferencesPath", "saveTrackingPreferences");
  await c.pauseTracking({ takeBreak: true });
  c.setClock(FIXED_NOW + 15 * 60_000);
  await c.resumeTracking();
  assert.equal(JSON.parse(stored!).timed_break.elapsedSeconds, 900);
  assert.equal(JSON.parse(stored!).timed_break.startedAt, null);
  c.runtimeStatus.breakElapsedSeconds = 0;
  c.setClock(FIXED_NOW + 120 * 60_000);
  c.loadTrackingPreferences();
  assert.equal(c.runtimeStatus.breakElapsedSeconds, 900);
  assert.equal(c.runtimeStatus.breakStartedAt, null);
  assert.equal(c.runtimeStatus.trackingPaused, false);
  await c.pauseTracking({ takeBreak: true });
  assert.equal(timedBreakState(c.runtimeStatus.breakStartedAt, c.now(), c.runtimeStatus.breakElapsedSeconds)?.seconds, 900);
  c.clearTimedBreak();
  c.saveTrackingPreferences();
  assert.equal(c.runtimeStatus.breakElapsedSeconds, 0);
  assert.equal(JSON.parse(stored!).timed_break, null);
});

test("restored break uses its captured session for offline finalization after sleep", async () => {
  const c = breakContext({ hasTrackingSession: () => false });
  c.unpaidPauseActive = true;
  c.runtimeStatus.breakStartedAt = startedAt;
  c.currentSessionId = null;
  c.breakSessionSnapshot = { id: "old-session", activeSeconds: 120, idleSeconds: 30 };
  c.stopTrackingSession = async () => {
    assert.equal(c.currentSessionId, "old-session");
    assert.equal(c.runtimeStatus.activeSeconds, 120);
    assert.equal(c.runtimeStatus.idleSeconds, 30);
    c.clearTimedBreak();
  };
  c.setClock(FIXED_NOW + 7200_000);
  await c.endExpiredBreak();
  assert.equal(c.runtimeStatus.breakStartedAt, null);
});

for (const reason of ["signout", "quit", "unenrolled", "resumed"]) {
  test(`expired break cannot end work after ${reason}`, async () => {
    let ends = 0;
    const c = breakContext({ stopTrackingSession: async () => { ends++; } });
    await c.pauseTracking({ takeBreak: true });
    if (reason === "signout") c.isSigningOut = true;
    if (reason === "quit") c.isQuitting = true;
    if (reason === "unenrolled") c.runtimeStatus.enrolled = false;
    if (reason === "resumed") c.unpaidPauseActive = false;
    c.setClock(FIXED_NOW + 3600_000);
    await c.endExpiredBreak();
    assert.equal(ends, 0);
  });
}

test("saved break survives restart and Windows startup only for its enrolled device", () => {
  const preferences = {
    unpaid_pause_active: true,
    timed_break: {
      startedAt, deviceId: "device",
      session: { id: "A", activeSeconds: 600, idleSeconds: 0 },
    },
  };
  let saved: typeof preferences;
  const c = breakContext({
    fs: {
      readFileSync: () => JSON.stringify(preferences),
      mkdirSync: () => {},
      writeFileSync: (_path: string, value: string) => { saved = JSON.parse(value); },
    },
    app: { getPath: () => "preview" },
  });
  functions(c, "loadTrackingPreferences", "getTrackingPreferencesPath", "saveTrackingPreferences");
  c.loadTrackingPreferences(true);
  assert.equal(c.runtimeStatus.breakStartedAt, startedAt);
  assert.equal(saved!.timed_break.startedAt, startedAt);
  assert.equal(c.runtimeStatus.trackingPaused, true);
  c.runtimeStatus.deviceId = "another-device";
  c.loadTrackingPreferences(false);
  assert.equal(c.runtimeStatus.breakStartedAt, null);
  assert.equal(c.breakSessionSnapshot, null);
});

test("automatic break end persists Stop and queues End behind an offline Pause", async () => {
  try {
    const c = await databaseContext();
    c.enqueuePendingEvent({
      id: "break-pause", method: "POST", endpoint: "/agent/sessions/A/events",
      payload: { event_type: "manual_pause_started" }, idempotencyKey: "break-pause",
    });
    let stopSaved = false;
    Object.assign(c, {
      unpaidPauseActive: true,
      freshSessionStartConfirmed: false,
      hasTrackingSession: () => true,
      manualPauseTransitionPromise: null,
      recalculateWorkedTime: () => {},
      invalidateInFlightScreenshotCaptures: () => {},
      saveTrackingPreferences: () => {
        stopSaved = c.trackingPausedByUser && c.runtimeStatus.breakStartedAt === null;
      },
      closeActiveLocalTrackingSession: () => {},
      clearRuntimeTimers: () => {},
      inputIntegrityMonitor: { stop: () => {} },
      startScreenshotMonitoring: () => {},
      syncPendingQueues: async () => {},
      syncRuntimeFromSession: () => {},
      endSession: async () => { assert.fail("End must stay behind the offline Pause"); },
    });
    c.runtimeStatus.breakStartedAt = startedAt;
    c.setClock(FIXED_NOW + 3600_000);
    functions(c, "clearTimedBreak", "endExpiredBreak", "stopTrackingSession");
    await c.endExpiredBreak();
    assert.equal(stopSaved, true);
    assert.equal(c.currentSessionId, null);
    assert.equal(c.runtimeStatus.trackingStatus, "paused");
    const queued = c.getDuePendingEvents(25, { force: true });
    assert.equal(queued.length, 2);
    assert.equal(queued[0].id, "break-pause");
    assert.match(queued[1].endpoint, /\/agent\/sessions\/A\/end$/);
    assert.match(JSON.parse(queued[1].payloadJson).reason, /Break reached 60 minutes/);
    await c.endExpiredBreak();
    assert.equal(c.getDuePendingEvents(25, { force: true }).length, 2);
  } finally {
    cleanupTemporaryDirectories();
  }
});
