// Follow-up main-process lifecycle regressions (F1, F2, F3) from the 2026-09-15
// independent verification. These drive the REAL extracted main.ts functions
// through the TypeScript-parser sandbox (support/mainHarness.ts) with mocked
// network/timers/Electron, and assert the REPAIRED behavior. They cover the
// deeper cases the first round left open: quit ordering behind the in-flight
// foreground-activity upload, startup timer restart during the summary await,
// and Resume/accrual admitted during a draining sign-out.
//
// Scope note: like reliabilityLifecycleFixes.test.ts, these execute real
// *extracted* functions with substituted dependencies; they do not import and run
// the whole main module or the Electron IPC bridge. The built-Electron harness
// (docs/desktop-current-audit-electron.mjs) is the native-boundary complement.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  context,
  functions,
  moduleSource,
  evaluate,
  FIXED_NOW,
} from "./support/mainHarness.ts";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const noop = () => {};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  started_at: "2026-09-10T10:00:00Z",
  status: "active",
  ended_at: null,
  active_seconds: 600,
  idle_seconds: 0,
  ...extra,
});

function base(overrides: Record<string, unknown> = {}) {
  const c = context({
    currentSessionId: null,
    eligibleIdleSecondsBeforeCurrentIdle: 0,
    idleWallClockStartedAt: null,
    automaticIdleStartPromise: null,
    automaticIdleFinishPromise: null,
    isFinishingAutomaticIdle: false,
    manualPauseTransitionPromise: null,
    screenshotQueue: [],
    screenshotWindowEndsAt: null,
    trackingConfig: {},
    inputIntegrityMonitor: { stop: noop },
    clearRuntimeTimers: noop,
    invalidateInFlightScreenshotCaptures: noop,
    clearEnrollmentIdentity: noop,
    configureAutoStart: noop,
    saveTrackingPreferences: noop,
    saveScreenshotSchedule: noop,
    showMainWindow: noop,
    tray: null,
    freshSessionStartConfirmed: false,
    syncTimer: null,
    recalculateWorkedTime: noop,
    closeActiveLocalTrackingSession: noop,
    startScreenshotMonitoring: noop,
    startTimers: noop,
    getOpenLocalTrackingSession: () => null,
    apiResponseStatus: (e: { status?: number } | undefined) => e?.status,
    syncPendingQueues: async () => {},
    endSession: async () =>
      session("A", { status: "ended", ended_at: "2026-09-10T12:00:00Z" }),
    hasPendingEventsForSession: () => false,
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
    "stopTrackingSession",
  );
  return c;
}

test("F1: Quit orders End behind its in-flight foreground-activity upload", async () => {
  const delivery = deferred<{ ignored: boolean }>();
  let handler: ((event: { preventDefault: () => void }) => void) | undefined;
  let ends = 0;
  const sent: string[] = [];
  const c = base({
    currentSessionId: "A",
    app: {
      on: (_event: string, callback: typeof handler) => {
        handler = callback;
      },
      quit: noop,
    },
    stopCrashRecoveryWatchdog: noop,
    updateDisplaySleepBlocker: noop,
    shouldClearInstallRecoveryOnBeforeQuit: () => false,
    isInstallingUpdate: false,
    updateCheckTimer: null,
    initialUpdateCheckTimer: null,
    quitNotificationSent: false,
    foregroundActivitySegment: {
      sessionId: "A",
      applicationName: "Synthetic Editor",
      processName: "audit",
      siteDomain: null,
      startedAt: FIXED_NOW - 10000,
      lastObservedAt: FIXED_NOW,
    },
    foregroundActivityTimer: null,
    heartbeatTimer: null,
    durationTimer: null,
    idleTimer: null,
    screenshotTimer: null,
    automaticTrackingRetryTimer: null,
    trackingWatchdogTimer: null,
    endSession: async () => {
      ends++;
      sent.push("end");
    },
    sendActivityEvent: () => {
      sent.push("foreground_activity pending");
      return delivery.promise;
    },
    enqueuePendingEvent: noop,
  });
  functions(
    c,
    "clearRuntimeTimers",
    "flushForegroundActivitySegment",
    "uploadForegroundActivitySegment",
  );
  const source = fs.readFileSync(
    new URL("../electron/main.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "main.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = ast.statements.find(
    (n: unknown) =>
      (ts as { isExpressionStatement: (x: unknown) => boolean })
        .isExpressionStatement(n) &&
      (n as { getText: (a: unknown) => string })
        .getText(ast)
        .startsWith('app.on("before-quit"'),
  );
  assert.ok(statement, "before-quit statement found");
  evaluate(c, (statement as { getText: (a: unknown) => string }).getText(ast));
  handler!({ preventDefault: noop });
  await Promise.resolve();
  // End must NOT have been sent while the foreground upload is still in flight.
  assert.equal(ends, 0);
  assert.deepEqual(sent, ["foreground_activity pending"]);
  // Once the foreground upload delivers, End proceeds (ordered after it).
  delivery.resolve({ ignored: true });
  for (let i = 0; i < 20 && ends === 0; i++) await Promise.resolve();
  assert.equal(ends, 1);
  assert.deepEqual(sent, ["foreground_activity pending", "end"]);
});

test("F2: startup does not start timers when logout lands during the summary await", async () => {
  const summary = deferred();
  let waiting = false;
  let timerStarts = 0;
  const c = base({
    isStartingTrackingAutomatically: false,
    automaticTrackingRetryTimer: null,
    getCurrentSession: async () => ({ session: session("A") }),
    promotePendingLocalTrackingSessions: async () => false,
    getAgentConfig: async () => ({}),
    normalizeTrackingConfig: (x: unknown) => x,
    refreshWorkedTodayTotal: () => {
      waiting = true;
      return summary.promise;
    },
    heartbeatTick: async () => {},
    refreshTimeAdjustmentRequests: async () => {},
    refreshLeaveRequests: async () => {},
    startTimers: () => {
      timerStarts++;
    },
    endSession: async () => {
      throw new Error("synthetic connection failure during sign-out");
    },
    enqueuePendingEvent: noop,
    setInterval: () => 1,
  });
  functions(c, "startTrackingAutomatically");
  const start = (c as { startTrackingAutomatically: () => Promise<void> })
    .startTrackingAutomatically();
  for (let i = 0; i < 20 && !waiting; i++) await Promise.resolve();
  assert.ok(waiting, "startup is holding the summary refresh");
  await (c as { logoutDevice: () => Promise<unknown> }).logoutDevice();
  summary.resolve();
  await start;
  const runtime = c as { runtimeStatus: Record<string, unknown> };
  assert.equal(timerStarts, 0, "no timers after logout during the summary await");
  assert.equal(runtime.runtimeStatus.enrolled, false);
  assert.notEqual(
    runtime.runtimeStatus.connectionStatus,
    "online",
    "signed-out runtime is not marked online",
  );
});

test("F3: Resume is rejected and no time accrues during a draining sign-out", async () => {
  const sync = deferred();
  let created = 0;
  const c = base({
    syncPendingQueues: () => sync.promise,
    createLocalTrackingSession: () => {
      created++;
    },
    startTrackingAutomatically: async () => {},
    clearPaidPauseTimer: noop,
    hasTrackingSession: () =>
      Boolean(
        (c as { currentSessionId: string | null }).currentSessionId ||
          (c as { localTrackingSessionId: string | null })
            .localTrackingSessionId,
      ),
  });
  functions(c, "resumeTracking", "beginLocalTrackingSession");
  const logout = (c as { logoutDevice: () => Promise<unknown> }).logoutDevice();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal((c as { isSigningOut: boolean }).isSigningOut, true);
  const resumed = await (
    c as { resumeTracking: () => Promise<{ success: boolean }> }
  ).resumeTracking();
  // Defensive accrual path: advance the clock and drive the real accrual fn.
  moduleSource(c, "electron/services/powerTransitionPolicy.ts");
  moduleSource(c, "electron/services/trackingTick.ts");
  functions(c, "recalculateWorkedTime");
  (c as { setClock: (n: number) => void }).setClock(FIXED_NOW + 5000);
  (c as { recalculateWorkedTime: () => void }).recalculateWorkedTime();
  const runtime = c as { runtimeStatus: Record<string, unknown> };
  assert.equal(resumed.success, false, "Resume is rejected during sign-out");
  assert.equal(created, 0, "no local session is created during sign-out");
  assert.equal(
    runtime.runtimeStatus.activeSeconds,
    600,
    "no active time accrues during sign-out",
  );
  sync.resolve();
  await logout;
});
