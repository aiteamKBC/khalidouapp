// Round-3 main-process lifecycle races (H1, H2) from the 2026-09-16 independent
// verification of the G1-G3 fixes. Like the earlier reliability suites, these
// drive the REAL extracted main.ts functions — and, for H1, the REAL extracted
// agentApi.ts enrollment helper AND the extracted enrollment IPC callback —
// through the TypeScript-parser sandbox with mocked network/timers/persistence,
// and assert the REPAIRED behavior:
//
//   H1 — an enrollment whose HTTP round-trip is still in flight when a logout
//        begins must NOT persist credentials or report success once that logout
//        invalidates it (whether the logout has completed or is still draining).
//   H2 — when a newer foreground upload finishes before an older one, the shared
//        tracker must stay alive until the ENTIRE chain settles, so Quit still
//        orders End behind the older, still-pending upload.
//
// Scope note: real *extracted* functions with substituted dependencies; not a
// full-module import or a live IPC/Electron bridge. The built-Electron harness
// remains the native-boundary complement.
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

function apiFunction(c: ReturnType<typeof context>, name: string) {
  const textPath = new URL(
    "../electron/services/agentApi.ts",
    import.meta.url,
  );
  const text = fs.readFileSync(textPath, "utf8");
  const ast = ts.createSourceFile(
    "agentApi.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const node = ast.statements.find(
    (n: unknown) =>
      (ts as { isFunctionDeclaration: (x: unknown) => boolean })
        .isFunctionDeclaration(n) &&
      (n as { name?: { text?: string } }).name?.text === name,
  );
  assert.ok(node, name);
  evaluate(c, (node as { getText: (a: unknown) => string }).getText(ast));
}

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

for (const timing of ["after logout completed", "while logout drains"] as const) {
  test(`H1: a pre-existing enrollment response cannot persist identity ${timing}`, async () => {
    const response = deferred<{ data: { data: unknown } }>();
    const sync = deferred();
    let enrollHandler:
      | ((event: unknown, email: string, password: string) => Promise<{ success: boolean }>)
      | undefined;
    let stored: { deviceId: string } | null = { deviceId: "A" };
    let requests = 0;
    let writes = 0;
    const c = base({
      app: { getVersion: () => "test" },
      ipcMain: {
        handle: (_channel: string, cb: typeof enrollHandler) => {
          enrollHandler = cb;
        },
      },
      getApiBaseUrl: () => "http://synthetic.invalid",
      getDeviceInfo: () => ({}),
      axios: {
        post: async (url: string) => {
          requests++;
          if (url.endsWith("/employee-auth/login")) {
            return { data: { data: { access_token: "synthetic" } } };
          }
          return response.promise;
        },
        isAxiosError: () => false,
      },
      saveEnrollmentIdentity: (identity: { deviceId: string }) => {
        writes++;
        stored = identity;
        return identity;
      },
      clearEnrollmentIdentity: () => {
        stored = null;
      },
      syncPendingQueues: () =>
        timing === "while logout drains" ? sync.promise : Promise.resolve(),
      getLocalNetworkInfo: () => ({}),
      startTrackingAutomatically: async () => {},
      refreshTasks: async () => {},
      refreshTimeAdjustmentRequests: async () => {},
      refreshLeaveRequests: async () => {},
    });
    apiFunction(c, "enrollDeviceWithCredentials");
    functions(c, "activateEnrolledDevice");
    statement(c, 'ipcMain.handle(\n  "agent:enroll-with-credentials"');

    const enroll = enrollHandler!({}, "synthetic@example.invalid", "synthetic-test-only");
    await drain();
    assert.equal(requests, 2, "real API helper is awaiting the enrollment response");

    const logout = (c as { logoutDevice: () => Promise<unknown> }).logoutDevice();
    await drain();
    const runtime = c as {
      runtimeStatus: Record<string, unknown>;
      isSigningOut: boolean;
    };
    if (timing === "after logout completed") {
      await logout;
      assert.equal(runtime.runtimeStatus.enrolled, false);
    } else {
      assert.equal(runtime.isSigningOut, true);
    }

    response.resolve({
      data: {
        data: {
          company_id: "synthetic",
          employee: {
            id: "employee-B",
            name: "Synthetic B",
            email: "b@example.invalid",
          },
          device: { id: "B", name: "Synthetic device" },
          device_token: "synthetic-device-token",
        },
      },
    });
    const result = await enroll;
    (sync as { resolve: () => void }).resolve();
    await logout;

    assert.equal(writes, 0, "invalidated enrollment must not persist credentials");
    assert.equal(result.success, false, "invalidated enrollment must not report success");
    assert.equal(runtime.runtimeStatus.enrolled, false, "completed logout stays signed out");
  });
}

test("H2: a newer foreground delivery finishing first does not hide a still-pending predecessor from Quit", async () => {
  const oldUpload = deferred<Record<string, unknown>>();
  const read = deferred<{ applicationName: string; processName: string; siteDomain: null }>();
  let quit: ((event: { preventDefault: () => void }) => void) | undefined;
  let uploads = 0;
  let ends = 0;
  let reads = 0;
  const c = base({
    currentSessionId: "A",
    app: {
      on: (_event: string, cb: typeof quit) => {
        quit = cb;
      },
      quit: noop,
    },
    readForegroundActivity: () =>
      ++reads === 1
        ? read.promise
        : Promise.resolve({ applicationName: "Synthetic C", processName: "C", siteDomain: null }),
    sendActivityEvent: () => (++uploads === 1 ? oldUpload.promise : Promise.resolve({})),
    endSession: async () => {
      ends++;
      return { session };
    },
    heartbeatTick: async () => {},
  });
  functions(
    c,
    "hasTrackingSession",
    "clearRuntimeTimers",
    "flushForegroundActivitySegment",
    "uploadForegroundActivitySegment",
    "foregroundActivityTick",
    "sameForegroundActivity",
    "preserveTrackingBeforeUpdate",
  );
  const tick = c as {
    foregroundActivityTick: () => Promise<void>;
    preserveTrackingBeforeUpdate: () => Promise<void>;
    foregroundActivitySegment: { processName: string } | null;
    pendingForegroundActivityFlush: unknown;
  };
  // A periodic tick is waiting for native foreground metadata; update
  // preservation concurrently flushes the existing segment A and holds its upload.
  const firstTick = tick.foregroundActivityTick();
  const preserve = tick.preserveTrackingBeforeUpdate();
  await drain();
  assert.equal(uploads, 1);

  // The tick now creates segment B while A's upload remains outstanding.
  read.resolve({ applicationName: "Synthetic B", processName: "B", siteDomain: null });
  await firstTick;
  assert.equal(tick.foregroundActivitySegment?.processName, "B");

  // The next tick flushes B, whose faster upload completes before A's.
  const secondTick = tick.foregroundActivityTick();
  await drain();
  assert.equal(uploads, 2);

  statement(c, 'app.on("before-quit"');
  quit!({ preventDefault: noop });
  await drain();
  // End must NOT fire while the older upload A is still in flight, even though
  // the newer upload B already completed.
  assert.equal(ends, 0);

  oldUpload.resolve({});
  await preserve;
  await secondTick;
  await drain();
  assert.equal(ends, 1, "End proceeds once the older upload finally delivers");
});
