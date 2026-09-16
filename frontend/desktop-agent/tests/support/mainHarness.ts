// Behavior-test harness for electron/main.ts.
//
// The reliability defects live in top-level functions inside main.ts that
// import Electron and therefore cannot be imported directly under `node
// --test`. This harness extracts the *actual* current source of those functions
// with the TypeScript parser, then executes them in a sandbox with mocked
// Electron/API/clock dependencies — so a regression test exercises the real
// wired implementation, not a copy or a substring pattern.
//
// It mirrors docs/desktop-audit-repro.mjs (the diagnostic reproducer) but is
// reusable from the test suite and defaults to *fixed*-behavior assertions.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import ts from "typescript";
import initSqlJs from "sql.js";

const require = createRequire(import.meta.url);
const desktop = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const mainFile = path.join(desktop, "electron/main.ts");
const mainText = fs.readFileSync(mainFile, "utf8");
const mainAst = ts.createSourceFile(
  mainFile,
  mainText,
  ts.ScriptTarget.Latest,
  true,
);

const noop = () => {};
const log = { info: noop, warn: noop, error: noop };
export const FIXED_NOW = Date.parse("2026-09-10T12:00:00Z");

export function context(overrides: Record<string, unknown> = {}) {
  let clock = FIXED_NOW;
  class Clock extends Date {
    constructor(...args: unknown[]) {
      super(...((args.length ? args : [clock]) as []));
    }
    static now() {
      return clock;
    }
  }
  const c = vm.createContext({
    Date: Clock,
    Intl,
    Math,
    Set,
    Map,
    Buffer,
    console,
    randomUUID,
    createHash,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Promise,
    exports: {},
    log,
    path,
    fs,
    process: { platform: "win32", env: {}, cwd: () => desktop },
    setClock: (n: number) => {
      clock = n;
    },
    now: () => clock,
    runtimeStatus: {
      enrolled: true,
      deviceId: "device",
      agentVersion: "test",
      trackingStatus: "active",
      trackingPaused: false,
      sessionStartedAt: "2026-09-10T10:00:00Z",
      activeSeconds: 600,
      idleSeconds: 0,
      eligibleIdleSeconds: 0,
      workedTodaySeconds: 600,
      normalSeconds: 600,
      extraSeconds: 0,
      dailyTargetSeconds: 28800,
      paidPauseEndsAt: null,
      requestPolicy: null,
      lastSuccessfulSyncAt: null,
      connectionStatus: "online",
    },
    currentSessionId: "A",
    localTrackingSessionId: null,
    enrollmentGeneration: 0,
    screenshotCaptureGeneration: 0,
    // Physical presence and sign-out lifecycle state are tracked independently of
    // employee work intent (see D5/D6). Seed them so extracted functions that read
    // these module globals resolve them in the sandbox instead of ReferenceError-ing.
    isSigningOut: false,
    // Exclusive enrollment-operation ownership (I1): seed so the extracted
    // enrollment IPC callback resolves these module globals in the sandbox
    // instead of reading an undefined global (which would reject the first
    // enrollment) or throwing on assignment.
    enrollmentOperationSeq: 0,
    activeEnrollmentToken: null,
    // Sentinel created_at that sorts a durable finalization End last in its
    // session group (O1). Seeded so the extracted before-quit finalizer resolves
    // this module const in the sandbox.
    FINALIZATION_ORDER_SENTINEL: "9999-12-31T23:59:59.999Z",
    // Bounded shutdown finalization deadline (module const), seeded so the
    // extracted before-quit finalizer resolves it in the sandbox.
    SHUTDOWN_FINALIZATION_DEADLINE_MS: 15_000,
    // Injectable timers for the bounded shutdown/sign-out finalization deadline.
    // Default to real host timers (unref'd so they never keep a test process
    // alive); a deadline test overrides setTimeout to capture and fire the
    // callback deterministically without a real sleep.
    setTimeout: (cb: () => void, ms?: number) => {
      const handle = setTimeout(cb, ms);
      if (typeof handle?.unref === "function") handle.unref();
      return handle;
    },
    clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout),
    screenLocked: false,
    systemSleeping: false,
    // The in-flight foreground-activity flush that timer teardown initiates, so a
    // shutdown/finalization path can order End behind it (F1).
    pendingForegroundActivityFlush: null,
    activeCounterDate: "2026-09-10",
    workedTodayBaseSeconds: 0,
    trackingPausedByUser: false,
    unpaidPauseActive: false,
    isQuitting: false,
    onAcPower: true,
    isPromotingLocalTrackingSessions: false,
    lastLocalTrackingCheckpointAt: 0,
    lastDurationTickAt: FIXED_NOW - 1000,
    waitingForInputAfterIdleSessionClose: false,
    freshSessionStartPromptActive: false,
    idleSecondsBeforeCurrentIdle: 0,
    automaticIdleStartedDuringBreak: false,
    lastObservedSystemIdleSeconds: null,
    lastObservedOperatingSystemIdleSeconds: null,
    lastFullSummaryRefreshAt: FIXED_NOW,
    lastMetadataRefreshAt: FIXED_NOW,
    ensureCurrentCounterDate: noop,
    // Durable-outbox writes/removals for the durable-before-send contract (J1/J2,
    // O1). Seeded as noop so extracted finalizers/senders that now persist an event
    // up front and drop the row after a direct send resolve them in the sandbox.
    // databaseContext() reloads the REAL localDb implementations over these, so
    // real-DB tests are unaffected.
    enqueuePendingEvent: noop,
    markPendingEventUploaded: noop,
    // Operation-bound stale-startup cleanup (Gap 3). getDeviceToken supplies the
    // captured credential; endOrphanedStartupSession closes an orphaned session
    // under its original identity. Seeded so extracted startup code resolves them;
    // a Gap-3 test loads the real endOrphanedStartupSession over this noop.
    getDeviceToken: () => "synthetic-device-token",
    endOrphanedStartupSession: async () => {},
    notifyRendererStatus: noop,
    rebuildTrayMenu: noop,
    checkpointActiveLocalTrackingSession: noop,
    clearIdleReturnVerification: noop,
    selectRuntimeTask: noop,
    applyWorkdayState: noop,
    applyPauseState: noop,
    refreshWorkedTodayTotal: async () => {},
    refreshTrackingConfig: noop,
    refreshTasks: noop,
    resetDailyRuntimeCounters: noop,
    isInsideScheduledBreak: () => false,
    scheduledIdleIsCountable: () => true,
    activeTimeBucket: () => "normal",
    safeErrorForLog: (e: { message?: string }) => e?.message,
    inputIntegrityObservation: () => undefined,
    scheduleAutomaticTrackingRestart: noop,
    waitForInputAfterIdleSessionClose: noop,
    ...overrides,
  });
  return c;
}

export function evaluate(c: vm.Context, source: string) {
  vm.runInContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    c,
  );
}

export function functions(c: vm.Context, ...names: string[]) {
  for (const name of names) {
    const node = mainAst.statements.find(
      (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
    );
    assert.ok(node, `Missing source function ${name}`);
    evaluate(c, node!.getText(mainAst));
  }
}

export function moduleSource(c: vm.Context, relativePath: string) {
  const filename = path.join(desktop, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const ast = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  evaluate(
    c,
    ast.statements
      .filter((n) => !ts.isImportDeclaration(n))
      .map((n) => n.getText(ast))
      .join("\n"),
  );
}

const temporaryDirectories: string[] = [];

export async function databaseContext(overrides: Record<string, unknown> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "khaliduo-test-"));
  temporaryDirectories.push(directory);
  const c = context({
    initSqlJs,
    electronMain: {
      app: { getPath: () => directory, getAppPath: () => desktop },
    },
    ...overrides,
  });
  // localDb imports these helpers; the sandbox strips imports, so load their
  // definitions into the context first.
  moduleSource(c, "electron/services/pendingEventOrdering.ts");
  moduleSource(c, "electron/services/localDb.ts");
  await (c as unknown as { initializeLocalDatabase: () => Promise<void> })
    .initializeLocalDatabase();
  (c as Record<string, unknown>).testDirectory = directory;
  return c;
}

export function cleanupTemporaryDirectories() {
  for (const directory of temporaryDirectories.splice(0)) {
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) === path.resolve(os.tmpdir()) &&
      path.basename(resolved).startsWith("khaliduo-test-")
    ) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}
