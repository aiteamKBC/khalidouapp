import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import fc from "fast-check";
import { TrackingClock } from "../electron/services/trackingClock.ts";
import { context, FIXED_NOW, functions, moduleSource } from "./support/mainHarness.ts";

type Model = { elapsed: number; trustedInput: number; active: number; idle: number; status: string; paused: boolean; stopped: boolean };

function setup() {
  let elapsed = FIXED_NOW;
  let wall = FIXED_NOW;
  const clock = new TrackingClock(() => wall, () => elapsed);
  const children: any[] = [];
  const c = context({
    trackingNowMs: () => clock.nowMs(), trackingNowDate: () => new Date(clock.nowMs()),
    trackingElapsedMs: () => clock.elapsedMs(),
    spawn: () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: Object.assign(new EventEmitter(), { setEncoding() {} }),
        stderr: { resume() {} }, killed: false,
        kill() { this.killed = true; },
      });
      children.push(child);
      return child;
    },
  });
  moduleSource(c, "electron/services/trackingTick.ts");
  c.trackingTick = c.exports.trackingTick;
  moduleSource(c, "electron/services/powerTransitionPolicy.ts");
  c.shouldAccrueTrackedTime = c.exports.shouldAccrueTrackedTime;
  moduleSource(c, "electron/services/inputIntegrity.ts");
  const monitor = new c.exports.InputIntegrityMonitor();
  functions(c, "hasTrackingSession", "recalculateWorkedTime");
  c.runtimeStatus.activeSeconds = c.runtimeStatus.idleSeconds = c.runtimeStatus.eligibleIdleSeconds = 0;
  c.lastDurationTickAt = elapsed;
  const report = (physical = false, injected = false, child = children.at(-1)) =>
    child.stdout.emit("data", JSON.stringify({ real_mouse: Number(physical), injected_mouse: Number(injected) }) + "\n");
  monitor.start("fake-probe", 0);
  report();
  return {
    c, clock, monitor, report, children,
    advance(ms: number) { elapsed += ms; wall += ms; },
    jump(ms: number) { wall += ms; },
  };
}

type Real = ReturnType<typeof setup>;
type Operation =
  | { kind: "advance"; seconds: number }
  | { kind: "wall"; milliseconds: number }
  | { kind: "sync"; milliseconds: number }
  | { kind: "state"; status: string; paused: boolean; stopped: boolean }
  | { kind: "input"; physical: boolean }
  | { kind: "restart" }
  | { kind: "confirm" };

class Command implements fc.Command<Model, Real> {
  readonly operation: Operation;
  constructor(operation: Operation) { this.operation = operation; }
  check() { return true; }
  run(m: Model, r: Real) {
    const op = this.operation;
    switch (op.kind) {
      case "advance": {
        r.advance(op.seconds * 1000);
        m.elapsed += op.seconds * 1000;
        if (!m.paused && !m.stopped && op.seconds <= 60) {
          if (["active", "starting"].includes(m.status)) m.active += op.seconds;
          if (m.status === "idle") m.idle += op.seconds;
        }
        r.report();
        break;
      }
      case "wall": r.jump(op.milliseconds); break;
      case "sync": r.clock.observeServerTime(new Date(m.elapsed + op.milliseconds).toISOString()); break;
      case "state":
        m.status = r.c.runtimeStatus.trackingStatus = op.status;
        m.paused = r.c.unpaidPauseActive = op.paused;
        m.stopped = r.c.trackingPausedByUser = op.stopped;
        break;
      case "input":
        r.report(op.physical, !op.physical);
        if (op.physical) m.trustedInput = m.elapsed;
        break;
      case "confirm":
        r.monitor.confirmPresence();
        m.trustedInput = m.elapsed;
        break;
      case "restart": {
        const old = r.children.at(-1);
        r.monitor.stop();
        r.monitor.start("fake-probe", 0);
        r.report(true, false, old); // old-process input must be discarded
        r.report();
        break;
      }
    }
    r.c.recalculateWorkedTime();
    // Prime after a deliberate pause/stop so the next real interval starts now.
    if (op.kind === "state" && !m.paused && !m.stopped) r.c.recalculateWorkedTime();
    assert.equal(r.c.runtimeStatus.activeSeconds, m.active);
    assert.equal(r.c.runtimeStatus.idleSeconds, m.idle);
    assert.equal(r.monitor.idleSeconds(0), (m.elapsed - m.trustedInput) / 1000);
    assert.ok(Number.isFinite(r.clock.nowMs()));
  }
  toString() { return JSON.stringify(this.operation); }
}

test("generated time, presence, pause, freeze and clock-calibration sequences preserve work", () => {
  const commands = [
    fc.oneof(fc.integer({ min: 1, max: 60 }), fc.constantFrom(61, 3600, 86400)).map(seconds => new Command({ kind: "advance", seconds })),
    fc.integer({ min: -7 * 86400_000, max: 7 * 86400_000 }).map(milliseconds => new Command({ kind: "wall", milliseconds })),
    fc.integer({ min: -86400_000, max: 86400_000 }).map(milliseconds => new Command({ kind: "sync", milliseconds })),
    fc.record({ status: fc.constantFrom("active", "starting", "idle", "locked", "sleeping"), paused: fc.boolean(), stopped: fc.boolean() }).map(state => new Command({ kind: "state", ...state })),
    fc.boolean().map(physical => new Command({ kind: "input", physical })),
    fc.constant(new Command({ kind: "restart" })),
    fc.constant(new Command({ kind: "confirm" })),
  ];
  const nightly = process.env.KHALIDUO_TEST_PROFILE === "nightly";
  fc.assert(fc.property(fc.commands(commands, {
    maxCommands: nightly ? 100 : 40,
    ...(process.env.FC_REPLAY_PATH ? { replayPath: process.env.FC_REPLAY_PATH } : {}),
  }), sequence => {
    const real = setup();
    fc.modelRun(() => ({
      model: { elapsed: FIXED_NOW, trustedInput: FIXED_NOW, active: 0, idle: 0, status: "active", paused: false, stopped: false },
      real,
    }), sequence);
  }), {
    numRuns: nightly ? 1000 : 100,
    ...(process.env.FC_SEED ? { seed: Number(process.env.FC_SEED) } : {}),
    ...(process.env.FC_PATH ? { path: process.env.FC_PATH } : {}),
  });
});
