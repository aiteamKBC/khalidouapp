import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { TrackingClock } from "../electron/services/trackingClock.ts";
import { context, FIXED_NOW, functions, moduleSource } from "./support/mainHarness.ts";

for (const offsetSeconds of [-259200, -40, -6, 6, 40, 259200]) {
  for (const status of ["active", "idle"]) {
    test(`${status}: server calibration of ${offsetSeconds}s credits only real elapsed time`, () => {
      let elapsed = FIXED_NOW;
      const clock = new TrackingClock(() => FIXED_NOW, () => elapsed);
      const c = context({
        trackingNowMs: () => clock.nowMs(),
        trackingElapsedMs: () => clock.elapsedMs(),
      });
      moduleSource(c, "electron/services/trackingTick.ts");
      c.trackingTick = c.exports.trackingTick;
      moduleSource(c, "electron/services/powerTransitionPolicy.ts");
      c.shouldAccrueTrackedTime = c.exports.shouldAccrueTrackedTime;
      functions(c, "hasTrackingSession", "recalculateWorkedTime");
      c.runtimeStatus.trackingStatus = status;
      c.lastDurationTickAt = elapsed;
      const activeBefore = c.runtimeStatus.activeSeconds;
      const idleBefore = c.runtimeStatus.idleSeconds;
      elapsed += 1000;
      clock.observeServerTime(new Date(FIXED_NOW + offsetSeconds * 1000).toISOString());
      c.recalculateWorkedTime();
      assert.equal(c.runtimeStatus.activeSeconds - activeBefore, status === "active" ? 1 : 0);
      assert.equal(c.runtimeStatus.idleSeconds - idleBefore, status === "idle" ? 1 : 0);
    });
  }

  test(`calibration of ${offsetSeconds}s cannot reset or inflate trusted inactivity`, () => {
    let elapsed = FIXED_NOW;
    const clock = new TrackingClock(() => FIXED_NOW, () => elapsed);
    const child = Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { setEncoding() {} }),
      stderr: { resume() {} }, killed: false,
      kill() { this.killed = true; },
    });
    const c = context({
      trackingNowMs: () => clock.nowMs(), trackingElapsedMs: () => clock.elapsedMs(),
      spawn: () => child,
    });
    moduleSource(c, "electron/services/inputIntegrity.ts");
    const monitor = new c.exports.InputIntegrityMonitor();
    monitor.start("test-probe", 0);
    const report = () => child.stdout.emit("data", '{"real_mouse":0}\n');
    report();
    elapsed += 900_000;
    clock.observeServerTime(new Date(FIXED_NOW + offsetSeconds * 1000).toISOString());
    report();
    assert.equal(monitor.idleSeconds(0), 900);
    monitor.confirmPresence();
    elapsed += 1000;
    report();
    assert.equal(monitor.idleSeconds(0), 1);
  });
}

test("all work states respect pause, stop, teardown and identity guards online and offline", () => {
  const c = context();
  moduleSource(c, "electron/services/trackingTick.ts");
  c.trackingTick = c.exports.trackingTick;
  moduleSource(c, "electron/services/powerTransitionPolicy.ts");
  c.shouldAccrueTrackedTime = c.exports.shouldAccrueTrackedTime;
  functions(c, "hasTrackingSession", "recalculateWorkedTime");
  for (const status of ["active", "starting", "idle", "locked", "sleeping", "paused", "offline"]) {
    for (const online of [true, false]) {
      for (let flags = 0; flags < 64; flags++) {
        c.runtimeStatus.trackingStatus = status;
        c.runtimeStatus.enrolled = !(flags & 1);
        c.currentSessionId = flags & 2 ? null : "session";
        c.isSigningOut = Boolean(flags & 4);
        c.isQuitting = Boolean(flags & 8);
        c.trackingPausedByUser = Boolean(flags & 16);
        c.unpaidPauseActive = Boolean(flags & 32);
        c.runtimeStatus.connectionStatus = online ? "online" : "offline";
        c.runtimeStatus.activeSeconds = 0;
        c.runtimeStatus.idleSeconds = 0;
        c.lastDurationTickAt = FIXED_NOW - 1000;
        c.recalculateWorkedTime();
        const label = `${status}, online=${online}, guard flags=${flags}`;
        assert.equal(c.runtimeStatus.activeSeconds, !flags && ["active", "starting"].includes(status) ? 1 : 0, label);
        assert.equal(c.runtimeStatus.idleSeconds, !flags && status === "idle" ? 1 : 0, label);
      }
    }
  }
});

test("timer jitter preserves fractional seconds and a frozen process earns no work", () => {
  let elapsed = FIXED_NOW;
  const c = context({ trackingElapsedMs: () => elapsed });
  moduleSource(c, "electron/services/trackingTick.ts");
  c.trackingTick = c.exports.trackingTick;
  moduleSource(c, "electron/services/powerTransitionPolicy.ts");
  c.shouldAccrueTrackedTime = c.exports.shouldAccrueTrackedTime;
  functions(c, "hasTrackingSession", "recalculateWorkedTime");
  c.runtimeStatus.activeSeconds = 0;
  c.lastDurationTickAt = elapsed;
  for (let i = 0; i < 10_000; i++) {
    elapsed += 37;
    c.recalculateWorkedTime();
  }
  assert.equal(c.runtimeStatus.activeSeconds, 370);
  for (const gap of [60_001, 3_600_000, 3 * 86400_000]) {
    elapsed += gap;
    c.recalculateWorkedTime();
    assert.equal(c.runtimeStatus.activeSeconds, 370);
  }
  elapsed += 1000;
  c.recalculateWorkedTime();
  assert.equal(c.runtimeStatus.activeSeconds, 371);
});
