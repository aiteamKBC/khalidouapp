// Round-2 main-process lifecycle regressions (G1, G2, G3) from the 2026-09-16
// independent verification of the F1-F3 fixes. Like reliabilityFollowupFixes,
// these drive the REAL extracted main.ts functions (and, for G2, the extracted
// enrollment IPC callback) through the TypeScript-parser sandbox with mocked
// network/timers/Electron, and assert the REPAIRED behavior:
//
//   G1a — Quit must order End behind a foreground upload the PERIODIC TICK
//         already started (not only the cleanup-triggered flush).
//   G1b — Stop/sign-out must order End behind the foreground flush its own
//         cleanup starts.
//   G2  — a credential enrollment that begins while an old logout is draining
//         must NOT persist identity (rejected), so the old logout's teardown
//         cannot erase a newly saved account.
//   G3  — teardown (Quit/logout) must bank the pre-intent accrual tick exactly
//         once at the intent boundary, despite the sign-out/quit accrual freeze.
//
// Scope note: these execute real *extracted* functions with substituted
// dependencies; they do not import the whole main module or the Electron IPC
// bridge. The built-Electron harness is the native-boundary complement.
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
const drain = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
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

const mainSource = fs.readFileSync(
  new URL("../electron/main.ts", import.meta.url),
  "utf8",
);
const mainAst = ts.createSourceFile(
  "main.ts",
  mainSource,
  ts.ScriptTarget.Latest,
  true,
);

function statement(c: ReturnType<typeof context>, prefix: string) {
  const node = mainAst.statements.find(
    (n: unknown) =>
      (ts as { isExpressionStatement: (x: unknown) => boolean })
        .isExpressionStatement(n) &&
      (n as { getText: (a: unknown) => string })
        .getText(mainAst)
        .replaceAll("\r\n", "\n")
        .startsWith(prefix),
  );
  assert.ok(node, prefix);
  evaluate(c, (node as { getText: (a: unknown) => string }).getText(mainAst));
}

function base(overrides: Record<string, unknown> = {}) {
  const c = context({
    currentSessionId: "A",
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
    apiResponseStatus: (e: { status?: number } | undefined) => e?.status,
    syncPendingQueues: async () => {},
    endSession: async () => ({ session }),
    hasPendingEventsForSession: () => false,
    enqueuePendingEvent: noop,
    clearInterval: noop,
    clearTimeout: noop,
    stopCrashRecoveryWatchdog: noop,
    updateDisplaySleepBlocker: noop,
    shouldClearInstallRecoveryOnBeforeQuit: () => false,
    isInstallingUpdate: false,
    updateCheckTimer: null,
    initialUpdateCheckTimer: null,
    quitNotificationSent: false,
    foregroundActivityTimer: 1,
    foregroundActivityTickRunning: false,
    heartbeatTimer: null,
    durationTimer: null,
    idleTimer: null,
    screenshotTimer: null,
    automaticTrackingRetryTimer: null,
    trackingWatchdogTimer: null,
    foregroundActivitySegment: {
      sessionId: "A",
      applicationName: "Synthetic Editor",
      processName: "audit",
      siteDomain: null,
      startedAt: FIXED_NOW - 10000,
      lastObservedAt: FIXED_NOW,
    },
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

test("G1a: Quit orders End behind a foreground upload the periodic tick already started", async () => {
  const delivery = deferred<Record<string, unknown>>();
  let quit: ((event: { preventDefault: () => void }) => void) | undefined;
  let ends = 0;
  let uploads = 0;
  const c = base({
    app: {
      on: (_event: string, cb: typeof quit) => {
        quit = cb;
      },
      quit: noop,
    },
    readForegroundActivity: async () => null,
    sendActivityEvent: () => {
      uploads++;
      return delivery.promise;
    },
    endSession: async () => {
      ends++;
      return { session };
    },
  });
  functions(
    c,
    "clearRuntimeTimers",
    "flushForegroundActivitySegment",
    "uploadForegroundActivitySegment",
    "foregroundActivityTick",
  );
  const tick = (c as { foregroundActivityTick: () => Promise<void> })
    .foregroundActivityTick();
  await drain();
  // The tick flushed the buffered segment: one upload is in flight, buffer clear.
  assert.equal(uploads, 1);
  assert.equal((c as { foregroundActivitySegment: unknown }).foregroundActivitySegment, null);

  statement(c, 'app.on("before-quit"');
  quit!({ preventDefault: noop });
  await drain();
  // End must NOT fire while the tick's foreground upload is still in flight.
  assert.equal(ends, 0);

  delivery.resolve({});
  await tick;
  await drain();
  assert.equal(ends, 1, "End proceeds once the in-flight foreground upload delivers");
});

test("G1b: Stop orders End behind the foreground flush its own cleanup starts", async () => {
  const delivery = deferred<Record<string, unknown>>();
  let ends = 0;
  let uploads = 0;
  const c = base({
    sendActivityEvent: () => {
      uploads++;
      return delivery.promise;
    },
    endSession: async () => {
      ends++;
      return { session };
    },
  });
  functions(
    c,
    "clearRuntimeTimers",
    "flushForegroundActivitySegment",
    "uploadForegroundActivitySegment",
  );
  const stop = (c as { stopTrackingSession: () => Promise<unknown> })
    .stopTrackingSession();
  await drain();
  assert.equal(uploads, 1);
  // End must NOT fire while the cleanup foreground flush is still in flight.
  assert.equal(ends, 0);

  delivery.resolve({});
  await stop;
  assert.equal(ends, 1, "Stop/sign-out End proceeds only after foreground evidence delivers");
});

test("G2: credential enrollment during a draining logout is rejected and cannot persist identity", async () => {
  const sync = deferred();
  let enrollHandler:
    | ((event: unknown, email: string, password: string) => Promise<{ success: boolean }>)
    | undefined;
  let storedDevice: string | null = "A";
  let enrollmentCalls = 0;
  const c = base({
    currentSessionId: null,
    syncPendingQueues: () => sync.promise,
    clearEnrollmentIdentity: () => {
      storedDevice = null;
    },
    ipcMain: {
      handle: (_channel: string, handler: typeof enrollHandler) => {
        enrollHandler = handler;
      },
    },
    app: { getVersion: () => "test" },
    enrollDeviceWithCredentials: async () => {
      enrollmentCalls++;
      storedDevice = "B";
      return { deviceId: "B", employeeName: "Synthetic B" };
    },
    getLocalNetworkInfo: () => ({}),
    startTrackingAutomatically: async () => {},
    refreshTasks: async () => {},
    refreshTimeAdjustmentRequests: async () => {},
    refreshLeaveRequests: async () => {},
  });
  functions(c, "activateEnrolledDevice");
  statement(c, 'ipcMain.handle(\n  "agent:enroll-with-credentials"');

  const logout = (c as { logoutDevice: () => Promise<unknown> }).logoutDevice();
  await drain();
  assert.equal((c as { isSigningOut: boolean }).isSigningOut, true);

  const enrollment = await enrollHandler!(
    {},
    "synthetic@example.invalid",
    "synthetic-test-only",
  );
  assert.equal(enrollment.success, false, "enrollment is rejected while sign-out drains");
  assert.equal(enrollmentCalls, 0, "no credential-persisting API call during draining logout");

  sync.resolve();
  await logout;
  const runtime = c as { runtimeStatus: Record<string, unknown> };
  assert.equal(storedDevice, null, "old logout cleared its own identity, not a newer one");
  assert.equal(runtime.runtimeStatus.enrolled, false);
});

test("G3: Quit banks the final valid accrual tick after setting isQuitting", async () => {
  let quit: ((event: { preventDefault: () => void }) => void) | undefined;
  let finalActive: number | undefined;
  const c = base({
    app: {
      on: (_event: string, cb: typeof quit) => {
        quit = cb;
      },
      quit: noop,
    },
    pendingForegroundActivityFlush: null,
    endSession: async (args: { activeSeconds: number }) => {
      finalActive = args.activeSeconds;
      return { session };
    },
  });
  moduleSource(c, "electron/services/powerTransitionPolicy.ts");
  moduleSource(c, "electron/services/trackingTick.ts");
  functions(c, "hasTrackingSession", "recalculateWorkedTime");
  const runtime = c as {
    runtimeStatus: Record<string, number>;
    lastDurationTickAt: number;
    recalculateWorkedTime: () => void;
  };
  // Control: with an active runtime and a one-second-old tick, the normal path
  // banks the legitimate last second (600 -> 601).
  runtime.recalculateWorkedTime();
  assert.equal(runtime.runtimeStatus.activeSeconds, 601);

  // Reset to the same pre-teardown state and drive the real Quit callback.
  runtime.runtimeStatus.activeSeconds = 600;
  runtime.lastDurationTickAt = FIXED_NOW - 1000;
  statement(c, 'app.on("before-quit"');
  quit!({ preventDefault: noop });
  await drain();
  assert.equal(finalActive, 601, "the pre-intent interval is banked once before the freeze");
});
