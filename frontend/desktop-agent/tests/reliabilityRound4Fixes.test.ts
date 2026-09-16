// Round-4 lifecycle fixes (I1, I2, O1) from the 2026-09-16 independent
// verification of the H1/H2 fixes. As with the earlier reliability suites, the
// enrollment cases drive the REAL extracted main.ts enrollment IPC callback and
// the REAL extracted agentApi.ts helper through the parser sandbox with mocked
// Axios/persistence/clock. O1 has two layers: an extracted-finalizer check that
// the durable End is written BEFORE the predecessor wait, and a REAL sql.js
// localDb check that the sentinel-ordered End still delivers AFTER a predecessor
// (no causal inversion) and is excluded from its own direct-send gate.
//
//   I1 — two overlapping enrollments cannot both persist credentials; exactly one
//        owns persistence + activation + reported success (persistent identity ==
//        runtime identity).
//   I2 — an obsolete enrollment HTTP failure (invalidated by a completed logout)
//        must not mutate the current signed-out runtime/tray.
//   O1 — the final End is durably queued before in-flight predecessors are
//        awaited (kill-survival), ordered to deliver last so a predecessor's
//        later failure row is still delivered first.
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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
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
  const text = fs.readFileSync(
    new URL("../electron/services/agentApi.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile("agentApi.ts", text, ts.ScriptTarget.Latest, true);
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

const responseFor = (id: string) => ({
  data: {
    data: {
      company_id: "synthetic",
      employee: { id: `employee-${id}`, name: `Synthetic ${id}`, email: `${id}@example.invalid` },
      device: { id, name: `Synthetic device ${id}` },
      device_token: `synthetic-token-${id}`,
    },
  },
});

function enrollmentContext(overrides: Record<string, unknown> = {}) {
  let handler:
    | ((event: unknown, email: string, password: string) => Promise<{ success: boolean }>)
    | undefined;
  let stored: { deviceId: string } | null = null;
  const writes: string[] = [];
  const c = base({
    app: { getVersion: () => "test" },
    ipcMain: {
      handle: (_channel: string, cb: typeof handler) => {
        handler = cb;
      },
    },
    getApiBaseUrl: () => "http://synthetic.invalid",
    getDeviceInfo: () => ({}),
    saveEnrollmentIdentity: (identity: { deviceId: string }) => {
      writes.push(identity.deviceId);
      stored = identity;
      return identity;
    },
    clearEnrollmentIdentity: () => {
      stored = null;
    },
    getLocalNetworkInfo: () => ({}),
    startTrackingAutomatically: async () => {},
    refreshTasks: async () => {},
    refreshTimeAdjustmentRequests: async () => {},
    refreshLeaveRequests: async () => {},
    getUserFacingError: (_: unknown, fallback: string) => fallback,
    ...overrides,
  });
  apiFunction(c, "enrollDeviceWithCredentials");
  functions(c, "activateEnrolledDevice");
  statement(c, 'ipcMain.handle(\n  "agent:enroll-with-credentials"');
  return {
    c,
    enroll: (id: string) => handler!({}, `${id}@example.invalid`, "synthetic-test-only"),
    stored: () => stored,
    writes,
  };
}

test("I1: overlapping enrollments — exactly one owns persistence + runtime (A wins, B rejected)", async () => {
  const a = deferred<unknown>();
  const b = deferred<unknown>();
  const f = enrollmentContext({
    axios: {
      isAxiosError: () => false,
      post: async (url: string, body: { email: string }, options: { headers: { Authorization: string } }) => {
        if (url.endsWith("/employee-auth/login")) {
          return { data: { data: { access_token: body.email } } };
        }
        return options.headers.Authorization.includes("A@") ? a.promise : b.promise;
      },
    },
  });
  const first = f.enroll("A");
  const second = f.enroll("B");
  await drain();
  a.resolve(responseFor("A"));
  b.resolve(responseFor("B"));
  const results = await Promise.all([first, second]);
  const runtime = f.c as { runtimeStatus: Record<string, unknown> };
  assert.equal(results.filter((r) => r.success).length, 1, "exactly one overlapping enrollment succeeds");
  assert.deepEqual(f.writes, ["A"], "only the owning operation persisted credentials");
  assert.equal(f.stored()?.deviceId, "A");
  assert.equal(runtime.runtimeStatus.deviceId, "A", "runtime identity matches the persisted one");
});

test("I1: sequential enrollment still works after the first completes", async () => {
  const f = enrollmentContext({
    axios: {
      isAxiosError: () => false,
      post: async (url: string) =>
        url.endsWith("/employee-auth/login")
          ? { data: { data: { access_token: "synthetic" } } }
          : responseFor("A"),
    },
  });
  const first = await f.enroll("A");
  assert.equal(first.success, true);
  const second = await f.enroll("A");
  assert.equal(second.success, true, "a fresh enrollment after the first completes is admitted");
  assert.deepEqual(f.writes, ["A", "A"]);
});

test("I2: an obsolete enrollment network failure does not change signed-out runtime", async () => {
  const response = deferred<unknown>();
  const f = enrollmentContext({
    axios: {
      isAxiosError: () => false,
      post: async (url: string) =>
        url.endsWith("/employee-auth/login")
          ? { data: { data: { access_token: "synthetic" } } }
          : response.promise,
    },
  });
  const enrollment = f.enroll("A");
  await drain();
  await (f.c as { logoutDevice: () => Promise<unknown> }).logoutDevice();
  const runtime = f.c as { runtimeStatus: Record<string, unknown> };
  const before = runtime.runtimeStatus.trackingStatus;
  response.reject(new Error("synthetic obsolete network failure"));
  const result = await enrollment;
  assert.equal(result.success, false);
  assert.equal(runtime.runtimeStatus.trackingStatus, before, "obsolete error leaves signed-out state untouched");
  assert.notEqual(runtime.runtimeStatus.trackingStatus, "error");
});

test("O1: Quit writes a durable End before awaiting an in-flight predecessor", async () => {
  const pause = deferred<boolean>();
  let quit: ((event: { preventDefault: () => void }) => void) | undefined;
  let ends = 0;
  const queued: Array<{ endpoint: string; createdAt?: string }> = [];
  const c = base({
    currentSessionId: "A",
    manualPauseTransitionPromise: pause.promise,
    app: {
      on: (_event: string, cb: typeof quit) => {
        quit = cb;
      },
      quit: noop,
    },
    enqueuePendingEvent: (event: { endpoint: string; createdAt?: string }) => queued.push(event),
    endSession: async () => {
      ends++;
      return { session };
    },
  });
  statement(c, 'app.on("before-quit"');
  quit!({ preventDefault: noop });
  await drain();
  const durableEndsBeforeWait = queued.filter((e) => e.endpoint.endsWith("/end"));
  assert.equal(durableEndsBeforeWait.length, 1, "End is durably queued before the predecessor wait");
  assert.equal(
    durableEndsBeforeWait[0].createdAt,
    "9999-12-31T23:59:59.999Z",
    "the durable End is ordered last within its session group",
  );
  assert.equal(ends, 0, "End is not sent directly while the predecessor is still in flight");
  pause.resolve(true);
  await drain();
});

test("Deadline: a hung predecessor cannot block quit — End stays durable, finalization exits at the deadline", async () => {
  const pause = deferred<boolean>(); // never resolves: a hung predecessor
  let quit: ((event: { preventDefault: () => void }) => void) | undefined;
  let quitCalled = 0;
  let deadlineFire: (() => void) | undefined;
  const queued: Array<{ endpoint: string }> = [];
  const c = base({
    currentSessionId: "A",
    manualPauseTransitionPromise: pause.promise,
    app: {
      on: (_event: string, cb: typeof quit) => {
        quit = cb;
      },
      quit: () => {
        quitCalled++;
      },
    },
    // Capture the deadline timer instead of arming a real one, so we can fire it
    // deterministically without a real sleep.
    setTimeout: (cb: () => void) => {
      deadlineFire = cb;
      return 1;
    },
    clearTimeout: noop,
    enqueuePendingEvent: (event: { endpoint: string }) => queued.push(event),
    syncPendingQueues: async () => {},
    endSession: async () => ({ session }),
  });
  statement(c, 'app.on("before-quit"');
  quit!({ preventDefault: noop });
  await drain();
  // End is durable up front, and quit has NOT happened while the predecessor hangs.
  assert.equal(queued.filter((e) => e.endpoint.endsWith("/end")).length, 1, "End is durably queued before the wait");
  assert.equal(quitCalled, 0, "quit is withheld while finalization is still within its deadline");
  // Fire the deadline: finalization must give up waiting and let the app exit.
  assert.equal(typeof deadlineFire, "function", "a finalization deadline was armed");
  deadlineFire!();
  await drain();
  assert.equal(quitCalled, 1, "the app quits once the finalization deadline elapses despite the hung predecessor");
});

test("O1 (real sql.js DB): a sentinel-ordered End still delivers AFTER a later predecessor row", async () => {
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
    getDuePendingEvents: (limit?: number, options?: { force?: boolean }) => Array<{ endpoint: string }>;
    hasPendingEventsForSession: (id: string, exceptId?: string) => boolean;
    markPendingEventUploaded: (id: string) => void;
  };
  // The finalization End is written FIRST (as Quit does, before the wait) with the
  // sentinel created_at, then a predecessor Pause fails and enqueues LATER with a
  // real timestamp — the exact kill-window ordering hazard.
  db.enqueuePendingEvent({
    id: "end-1",
    method: "POST",
    endpoint: "/agent/sessions/S/end",
    payload: { event_id: "end-1" },
    idempotencyKey: "end-1",
    createdAt: "9999-12-31T23:59:59.999Z",
  });
  db.enqueuePendingEvent({
    id: "pause-1",
    method: "POST",
    endpoint: "/agent/sessions/S/events",
    payload: { event_id: "pause-1" },
    idempotencyKey: "pause-1",
    createdAt: "2026-09-10T11:00:00.000Z",
  });
  const due = db.getDuePendingEvents(10, { force: true });
  // Join to a primitive string: the array crosses the vm sandbox boundary and has
  // a different Array prototype than the host, so deepEqual would reject it.
  const order = due.map((e) => e.endpoint).join("|");
  assert.equal(
    order,
    "/agent/sessions/S/events|/agent/sessions/S/end",
    "predecessor delivers before the sentinel-ordered End despite End being enqueued first",
  );
  // While the pause is queued it is a genuine blocking predecessor even when the
  // End excludes itself.
  assert.equal(db.hasPendingEventsForSession("S", "end-1"), true, "the pause is a real predecessor");
  // Once the pause delivers, only the End remains — excluding itself, the session
  // has no blocking predecessor, so a direct send is permitted (no self-block).
  db.markPendingEventUploaded("pause-1");
  assert.equal(
    db.hasPendingEventsForSession("S", "end-1"),
    false,
    "the durable End does not count itself as a blocking predecessor",
  );
  assert.equal(db.hasPendingEventsForSession("S"), true, "without the exclusion the End still counts");
  cleanupTemporaryDirectories();
});
