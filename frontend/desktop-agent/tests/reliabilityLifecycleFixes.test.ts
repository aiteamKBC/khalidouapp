// Main-process lifecycle regression tests for the 2026-09-15 desktop reliability
// audit (D1–D6). These drive the REAL extracted main.ts functions through the
// TypeScript-parser sandbox (see support/mainHarness.ts) with mocked network,
// timers, and Electron, and assert the REPAIRED behavior — unlike
// docs/desktop-current-audit-repro.mjs, which defaults to asserting the pre-fix
// defect. They are the deferred-network / ownership counterparts to the existing
// ordering and heartbeat suites.
import assert from "node:assert/strict";
import test from "node:test";
import { context, functions, moduleSource } from "./support/mainHarness.ts";

const noop = () => {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function session(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    started_at: "2026-09-10T10:00:00Z",
    ended_at: null,
    status: "active",
    active_seconds: 600,
    idle_seconds: 0,
    ...extra,
  };
}

// Mirrors the diagnostic reproducer's base wiring so these suite tests exercise
// the same real functions, but here every assertion is the fixed contract.
function base(overrides: Record<string, unknown> = {}) {
  const c = context({
    clearRuntimeTimers: noop,
    inputIntegrityMonitor: { stop: noop },
    invalidateInFlightScreenshotCaptures: noop,
    clearEnrollmentIdentity: noop,
    configureAutoStart: noop,
    saveTrackingPreferences: noop,
    saveScreenshotSchedule: noop,
    showMainWindow: noop,
    tray: null,
    manualPauseTransitionPromise: null,
    recalculateWorkedTime: noop,
    closeActiveLocalTrackingSession: noop,
    startScreenshotMonitoring: noop,
    syncPendingQueues: async () => {},
    freshSessionStartConfirmed: false,
    syncTimer: null,
    eligibleIdleSecondsBeforeCurrentIdle: 0,
    idleWallClockStartedAt: null,
    automaticIdleStartPromise: null,
    automaticIdleFinishPromise: null,
    isFinishingAutomaticIdle: false,
    screenshotQueue: [],
    screenshotWindowEndsAt: null,
    trackingConfig: {},
    apiResponseStatus: (error: { status?: number } | undefined) => error?.status,
    getOpenLocalTrackingSession: () => null,
    startTimers: noop,
    ...overrides,
  });
  moduleSource(c, "electron/services/dailyCounters.ts");
  moduleSource(c, "electron/services/runtimePolicies.ts");
  functions(
    c,
    "localDateKey",
    "currentTimezone",
    "clearedPersonalRuntimeStatus",
    "syncRuntimeFromSession",
    "logoutDevice",
  );
  return c;
}

test("D2: a re-enrollment while an old start is pending is not mutated by it", async () => {
  const pending = deferred<{ session: unknown }>();
  let lookups = 0;
  let timerStarts = 0;
  const c = base({
    currentSessionId: null,
    isStartingTrackingAutomatically: false,
    automaticTrackingRetryTimer: null,
    getCurrentSession: async () =>
      ++lookups === 1 ? { session: null } : pending.promise,
    promotePendingLocalTrackingSessions: async () => false,
    getAgentConfig: async () => ({ screenshot_enabled: false }),
    normalizeTrackingConfig: (value: unknown) => value,
    startTimers: () => {
      timerStarts++;
    },
    heartbeatTick: async () => {},
    refreshTimeAdjustmentRequests: async () => {},
    refreshLeaveRequests: async () => {},
  });
  functions(c, "startTrackingAutomatically", "stopTrackingSession");
  const work = (c as { startTrackingAutomatically: () => Promise<void> })
    .startTrackingAutomatically();
  for (let i = 0; i < 12 && lookups < 2; i++) await Promise.resolve();
  // Log out, then RE-ENROLL as a new identity while A's start is still pending.
  await (c as { logoutDevice: () => Promise<unknown> }).logoutDevice();
  (c as { enrollmentGeneration: number }).enrollmentGeneration += 1; // re-enroll
  const runtime = c as { runtimeStatus: Record<string, unknown> };
  runtime.runtimeStatus.enrolled = true;
  (c as { currentSessionId: string | null }).currentSessionId = "B";
  // A's delayed response now arrives; it must not touch the new enrollment.
  pending.resolve({ session: session("A") });
  await work;
  assert.equal((c as { currentSessionId: string | null }).currentSessionId, "B");
  assert.equal(timerStarts, 0, "A's stale start must not start timers for B");
});

test("D3: a stale ended snapshot cannot alter a different current session", async () => {
  const c = base({ currentSessionId: "B", trackingPausedByUser: false });
  const runtime = c as { runtimeStatus: Record<string, unknown> };
  Object.assign(runtime.runtimeStatus, {
    trackingStatus: "active",
    activeSeconds: 42,
    idleSeconds: 3,
    sessionStartedAt: "2026-09-10T11:59:00Z",
  });
  // Directly apply A's closed snapshot while B is current (defense-in-depth path).
  (c as { syncRuntimeFromSession: (s: unknown) => void }).syncRuntimeFromSession(
    session("A", { ended_at: "2026-09-10T12:00:00Z", status: "ended" }),
  );
  assert.equal((c as { currentSessionId: string | null }).currentSessionId, "B");
  assert.equal(runtime.runtimeStatus.trackingStatus, "active");
  assert.equal(runtime.runtimeStatus.activeSeconds, 42);
  assert.equal(runtime.runtimeStatus.sessionStartedAt, "2026-09-10T11:59:00Z");
});

test("D4: sign-out clears every personal field, not just the session counters", async () => {
  const c = base({ currentSessionId: null });
  const runtime = c as { runtimeStatus: Record<string, unknown> };
  Object.assign(runtime.runtimeStatus, {
    leaveRequests: { requests: [{ id: "leave-1", reason: "personal" }] },
    recentTasks: [{ id: "t1", name: "secret task" }],
    employeeAvatarUrl: "https://example.test/avatar.png",
    requestPolicy: { some: "policy" },
    timeSummary: { today: {} },
    normalSeconds: 999,
    extraSeconds: 111,
  });
  functions(c, "stopTrackingSession");
  await (c as { logoutDevice: () => Promise<unknown> }).logoutDevice();
  assert.equal(runtime.runtimeStatus.leaveRequests, null);
  assert.equal((runtime.runtimeStatus.recentTasks as unknown[]).length, 0);
  assert.equal(runtime.runtimeStatus.employeeAvatarUrl, null);
  assert.equal(runtime.runtimeStatus.requestPolicy, null);
  assert.equal(runtime.runtimeStatus.timeSummary, null);
  assert.equal(runtime.runtimeStatus.normalSeconds, 0);
  assert.equal(runtime.runtimeStatus.extraSeconds, 0);
  assert.equal(runtime.runtimeStatus.enrolled, false);
});

test("D5: manual Pause stays screenshot-blocked across a lock/unlock cycle", async () => {
  const handlers = new Map<string, () => void>();
  const c = base({
    // No server session id, so sendStateEvent short-circuits before the network
    // path; the test isolates the pause-vs-physical-lock separation only.
    currentSessionId: null,
    trackingPausedByUser: false,
    unpaidPauseActive: true, // employee is on a manual unpaid Pause
    powerMonitor: {
      isOnBatteryPower: () => false,
      on: (event: string, cb: () => void) => handlers.set(event, cb),
    },
    observedIdleSeconds: () => 0,
    hasReachedIdleThreshold: () => false,
    trackingConfig: { screenshot_enabled: true, capture_during_idle: false },
  });
  moduleSource(c, "electron/services/powerTransitionPolicy.ts");
  functions(
    c,
    "wireSystemEvents",
    "sendStateEvent",
    "screenshotCaptureBlockReason",
  );
  const block = c as { screenshotCaptureBlockReason: () => string | null };
  (c as { wireSystemEvents: () => void }).wireSystemEvents();
  assert.equal(block.screenshotCaptureBlockReason(), "tracking_paused");
  handlers.get("lock-screen")!();
  handlers.get("unlock-screen")!();
  // Physical lock cleared, but the manual pause intent must still block capture.
  assert.equal(block.screenshotCaptureBlockReason(), "tracking_paused");
});

test("D6: a repeated sign-out while one is draining is idempotent", async () => {
  const firstSync = deferred<void>();
  let stopCalls = 0;
  let syncCalls = 0;
  const c = base({
    syncPendingQueues: () => {
      syncCalls++;
      return firstSync.promise;
    },
    stopTrackingSession: async () => {
      stopCalls++;
      return { success: true };
    },
    trackingConfig: { screenshot_enabled: true, capture_during_idle: false },
    observedIdleSeconds: () => 0,
    hasReachedIdleThreshold: () => false,
  });
  functions(c, "screenshotCaptureBlockReason");
  const logout = c as { logoutDevice: () => Promise<{ success: boolean }> };
  const first = logout.logoutDevice();
  await Promise.resolve();
  // Capture is blocked immediately, before the first sync resolves.
  assert.equal(
    (c as { screenshotCaptureBlockReason: () => string | null })
      .screenshotCaptureBlockReason(),
    "signing_out",
  );
  // A second sign-out while the first is still draining must be a no-op.
  const second = await logout.logoutDevice();
  assert.equal(second.success, true);
  assert.equal(stopCalls, 1, "the second sign-out must not start another Stop");
  firstSync.resolve();
  await first;
  assert.equal(syncCalls, 1, "the second sign-out must not start another sync");
});
