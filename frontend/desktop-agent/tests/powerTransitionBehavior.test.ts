// Behavior tests for Bug 1: an explicit unpaid Pause must survive a Windows
// unlock / system resume. These execute the *real* main.ts functions extracted
// from source, so they fail against the pre-fix implementation for the intended
// reason (active time accrued after unlock while paused).
import assert from "node:assert/strict";
import test from "node:test";

import {
  context,
  evaluate,
  functions,
  moduleSource,
  FIXED_NOW,
} from "./support/mainHarness.ts";

function pausedUnlockContext() {
  const handlers: Record<string, () => void> = {};
  const c = context({
    unpaidPauseActive: true,
    powerMonitor: {
      isOnBatteryPower: () => false,
      on: (name: string, cb: () => void) => {
        handlers[name] = cb;
      },
      getSystemIdleTime: () => 0,
    },
    resumeAfterIdleSessionClose: () => false,
    // A never-resolving delivery models an in-flight state update.
    sendActivityEvent: () => new Promise(() => {}),
    sendStateEvent: () => new Promise(() => {}),
    startTimers: () => {},
    startScreenshotMonitoring: () => {},
  });
  const cx = c as unknown as Record<string, unknown> & {
    runtimeStatus: Record<string, unknown>;
  };
  cx.runtimeStatus.trackingPaused = true;
  cx.runtimeStatus.trackingStatus = "idle";
  moduleSource(c, "electron/services/trackingTick.ts");
  moduleSource(c, "electron/services/powerTransitionPolicy.ts");
  functions(
    c,
    "hasTrackingSession",
    "sendStateEvent",
    "recalculateWorkedTime",
    "wireSystemEvents",
  );
  return { c, cx, handlers };
}

test("unlock while unpaid-paused does not resume work or credit active time", () => {
  const { c, cx, handlers } = pausedUnlockContext();
  (c as unknown as { wireSystemEvents: () => void }).wireSystemEvents();
  handlers["unlock-screen"]();
  (c as unknown as { setClock: (n: number) => void }).setClock(FIXED_NOW + 5000);
  (c as unknown as { recalculateWorkedTime: () => void }).recalculateWorkedTime();

  assert.equal(cx.unpaidPauseActive, true, "pause intent must survive unlock");
  assert.equal(cx.runtimeStatus.trackingPaused, true);
  assert.equal(
    cx.runtimeStatus.trackingStatus,
    "idle",
    "unlock must not flip a paused session to active",
  );
  assert.equal(
    cx.runtimeStatus.activeSeconds,
    600,
    "no active time may accrue while paused",
  );
});

test("system resume while unpaid-paused does not resume work or credit active time", () => {
  const { c, cx, handlers } = pausedUnlockContext();
  (c as unknown as { wireSystemEvents: () => void }).wireSystemEvents();
  handlers["resume"]();
  (c as unknown as { setClock: (n: number) => void }).setClock(FIXED_NOW + 5000);
  (c as unknown as { recalculateWorkedTime: () => void }).recalculateWorkedTime();

  assert.equal(cx.runtimeStatus.trackingStatus, "idle");
  assert.equal(cx.runtimeStatus.activeSeconds, 600);
});

test("defensive accrual guard blocks active time even if status is 'active' while paused", () => {
  const { c, cx } = pausedUnlockContext();
  // Simulate a raced/stale transition that left status active while paused.
  cx.runtimeStatus.trackingStatus = "active";
  (c as unknown as { setClock: (n: number) => void }).setClock(FIXED_NOW + 5000);
  (c as unknown as { recalculateWorkedTime: () => void }).recalculateWorkedTime();
  assert.equal(
    cx.runtimeStatus.activeSeconds,
    600,
    "the accrual guard must not credit time while unpaidPauseActive",
  );
});

test("without any pause, an unlock still posts an active transition", () => {
  const handlers: Record<string, () => void> = {};
  let posted: string | null = null;
  const c = context({
    unpaidPauseActive: false,
    trackingPausedByUser: false,
    powerMonitor: {
      isOnBatteryPower: () => false,
      on: (name: string, cb: () => void) => {
        handlers[name] = cb;
      },
      getSystemIdleTime: () => 0,
    },
    resumeAfterIdleSessionClose: () => false,
    sendStateEvent: (_type: string, status: string) => {
      posted = status;
      return Promise.resolve(true);
    },
  });
  moduleSource(c, "electron/services/trackingTick.ts");
  moduleSource(c, "electron/services/powerTransitionPolicy.ts");
  functions(c, "hasTrackingSession", "recalculateWorkedTime", "wireSystemEvents");
  (c as unknown as { wireSystemEvents: () => void }).wireSystemEvents();
  handlers["unlock-screen"]();
  assert.equal(posted, "active", "normal unlock must resume active tracking");
});
