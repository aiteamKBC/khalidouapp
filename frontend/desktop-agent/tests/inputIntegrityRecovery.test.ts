import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { context, FIXED_NOW, functions, moduleSource } from "./support/mainHarness.ts";

type ProbeChild = EventEmitter & {
  killed: boolean;
  stdout: EventEmitter & { setEncoding: () => void };
  stderr: { resume: () => void };
  kill: () => void;
};

type Monitor = {
  stop: () => void;
  confirmPresence: (now?: number) => void;
  latestRealInputAt: () => number | null;
};

test("only isolated unpackaged UI tests may replace the native input probe", () => {
  for (const packaged of [false, true]) {
    const { c, children } = recoveryContext(42, {
      process: { platform: "win32", env: { KHALIDUO_E2E_DISABLE_INPUT_PROBE: "1", KHALIDUO_E2E_USER_DATA_DIR: "isolated-profile" } },
      app: { isPackaged: packaged },
    });
    assert.equal(c.observedIdleSeconds(), 42);
    assert.equal(children.length, packaged ? 1 : 0);
  }
});

function recoveryContext(initialOsIdleSeconds = 0, overrides: Record<string, unknown> = {}) {
  const children: ProbeChild[] = [];
  let osIdleSeconds = initialOsIdleSeconds;
  const c = context({
    spawn: () => {
      const child = new EventEmitter() as ProbeChild;
      child.killed = false;
      child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
      child.stderr = { resume: () => {} };
      child.kill = () => { child.killed = true; };
      children.push(child);
      return child;
    },
    fs: { existsSync: () => true },
    inputProbeExecutablePath: () => "mock-input-probe",
    powerMonitor: { getSystemIdleTime: () => osIdleSeconds },
    lastInputProbeStartAttemptAt: 0,
    lastInputProbeRestartAt: 0,
    inputProbeMissingWasLogged: false,
    ...overrides,
  }) as ReturnType<typeof context> & {
    exports: { InputIntegrityMonitor: new () => Monitor };
    inputIntegrityMonitor: Monitor;
    observedIdleSeconds: () => number;
    setClock: (now: number) => void;
  };
  moduleSource(c, "electron/services/inputIntegrity.ts");
  c.inputIntegrityMonitor = new c.exports.InputIntegrityMonitor();
  functions(c, "startInputIntegrityMonitoring", "restartBlindInputProbe", "observedIdleSeconds");

  function report(realMouse = 0, injectedMouse = 0, child = children.at(-1)!) {
    child.stdout.emit("data", JSON.stringify({
      real_mouse: realMouse, real_keyboard: 0,
      injected_mouse: injectedMouse, injected_keyboard: 0,
    }) + "\n");
  }
  return { c, children, report, setOsIdle: (seconds: number) => { osIdleSeconds = seconds; } };
}

test("thirteen hours of blind-probe restarts cannot conceal inactivity", () => {
  const { c, children, report } = recoveryContext();
  c.observedIdleSeconds();
  let atThreshold = 0;
  for (let seconds = 1; seconds <= 13 * 3600; seconds++) {
    c.setClock(FIXED_NOW + seconds * 1000);
    report();
    const idle = c.observedIdleSeconds();
    if (seconds === 900) atThreshold = idle;
  }
  assert.ok(children.length > 700, "exercise the real main.ts restart path");
  assert.equal(atThreshold, 900, "the fifteen-minute idle threshold must be reached");
  assert.equal(c.observedIdleSeconds(), 13 * 3600);
});

test("probe warmup and missing reports after a restart keep the trusted idle clock", () => {
  const { c, children, report } = recoveryContext();
  c.observedIdleSeconds();
  report();
  c.setClock(FIXED_NOW + 900_000);
  report();
  assert.equal(c.observedIdleSeconds(), 900);
  assert.equal(children.length, 2);
  c.setClock(FIXED_NOW + 910_000);
  assert.equal(c.observedIdleSeconds(), 910, "a silent replacement cannot reset idle to OS zero");
});

test("initial monitoring honors existing Windows inactivity", () => {
  const { c, report } = recoveryContext(1200);
  assert.equal(c.observedIdleSeconds(), 1200);
  report();
  assert.equal(c.observedIdleSeconds(), 1200);
});

test("Windows idle remains the fallback before any probe report", () => {
  const { c, setOsIdle } = recoveryContext(42);
  assert.equal(c.observedIdleSeconds(), 42);
  c.setClock(FIXED_NOW + 10_000);
  setOsIdle(52);
  assert.equal(c.observedIdleSeconds(), 52);
});

test("fresh physical input after recovery resets idle immediately", () => {
  const { c, report } = recoveryContext();
  c.observedIdleSeconds();
  report();
  c.setClock(FIXED_NOW + 900_000);
  report();
  c.observedIdleSeconds();
  c.setClock(FIXED_NOW + 901_000);
  report(1);
  assert.equal(c.observedIdleSeconds(), 0);
  assert.equal(c.inputIntegrityMonitor.latestRealInputAt(), FIXED_NOW + 901_000);
});

test("injected input after recovery does not erase previous inactivity", () => {
  const { c, report } = recoveryContext();
  c.observedIdleSeconds();
  report();
  c.setClock(FIXED_NOW + 900_000);
  report();
  c.observedIdleSeconds();
  c.setClock(FIXED_NOW + 901_000);
  report(0, 1);
  assert.equal(c.observedIdleSeconds(), 901);
});

test("late reports from the stopped probe cannot manufacture fresh presence", () => {
  const { c, children, report } = recoveryContext();
  c.observedIdleSeconds();
  const oldChild = children[0];
  report();
  c.setClock(FIXED_NOW + 900_000);
  report();
  c.observedIdleSeconds();
  c.setClock(FIXED_NOW + 901_000);
  report(1, 0, oldChild);
  report();
  assert.equal(c.observedIdleSeconds(), 901);
  assert.equal(c.inputIntegrityMonitor.latestRealInputAt(), null);
});

test("an explicit Continue working confirmation can reset preserved inactivity", () => {
  const { c, report } = recoveryContext();
  c.observedIdleSeconds();
  report();
  c.setClock(FIXED_NOW + 900_000);
  report();
  c.observedIdleSeconds();
  c.inputIntegrityMonitor.confirmPresence();
  report();
  assert.equal(c.observedIdleSeconds(), 0);
});

test("the real idle monitor stops banking work despite repeated blind-probe recovery", () => {
  let poll = () => {};
  const { c, report } = recoveryContext(0, {
    idleTimer: null,
    setInterval: (callback: () => void) => { poll = callback; return 1; },
    maybeAutoEndMeeting: () => {},
    maybeShowManualPauseReminder: () => {},
    idleReturnVerification: null,
    idleResumedAt: null,
    idleWallClockStartedAt: null,
    eligibleIdleSecondsBeforeCurrentIdle: 0,
    lastHandledIdleReturnInputAt: 0,
    automaticIdleStartPromise: null,
    savedBreakCover: null,
    activeMeeting: null,
    trackingConfig: { idle_threshold_minutes: 15 },
    showIdleStartedReview: () => {},
    showAutomaticIdleReturnReview: () => {},
    savedBreakSecondsLeft: () => 0,
    immediateIdleReturnInputDetected: () => false,
  });
  c.runtimeStatus.activeSeconds = 0;
  c.lastDurationTickAt = FIXED_NOW;
  c.sendStateEvent = async (_type: string, status: string) => {
    c.runtimeStatus.trackingStatus = status;
    return true;
  };
  moduleSource(c, "electron/services/idlePolicy.ts");
  moduleSource(c, "electron/services/trackingTick.ts");
  moduleSource(c, "electron/services/powerTransitionPolicy.ts");
  functions(c, "hasTrackingSession", "recalculateWorkedTime", "startIdleMonitor");
  c.startIdleMonitor();
  c.observedIdleSeconds();
  for (let seconds = 1; seconds <= 3600; seconds++) {
    c.setClock(FIXED_NOW + seconds * 1000);
    report();
    poll();
    c.recalculateWorkedTime();
  }
  assert.equal(c.runtimeStatus.trackingStatus, "idle");
  assert.equal(c.runtimeStatus.activeSeconds, 900);
  assert.equal(c.runtimeStatus.idleSeconds, 2700);
});
