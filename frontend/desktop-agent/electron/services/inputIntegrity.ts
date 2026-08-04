import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export type InputIntegrityObservation = {
  sensor: "windows_low_level_input";
  sensor_available: boolean;
  observed_seconds: number;
  real_mouse_events: number;
  real_keyboard_events: number;
  injected_mouse_events: number;
  injected_keyboard_events: number;
};

type ProbeReport = {
  real_mouse: number;
  real_keyboard: number;
  injected_mouse: number;
  injected_keyboard: number;
};

const SENSOR_STALE_AFTER_MS = 5_000;
const MAX_EVENT_COUNT = 1_000_000;

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_EVENT_COUNT, Math.max(0, Math.floor(value)))
    : 0;
}

export function parseProbeReport(line: string): ProbeReport | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return {
      real_mouse: safeCount(parsed.real_mouse),
      real_keyboard: safeCount(parsed.real_keyboard),
      injected_mouse: safeCount(parsed.injected_mouse),
      injected_keyboard: safeCount(parsed.injected_keyboard),
    };
  } catch {
    return null;
  }
}

export function effectiveTrustedIdleSeconds(options: {
  sensorAvailable: boolean;
  lastTrustedInputAt: number;
  systemIdleSeconds: number;
  now: number;
}) {
  if (!options.sensorAvailable) {
    return Math.max(0, Math.floor(options.systemIdleSeconds));
  }
  return Math.max(
    0,
    Math.floor((options.now - options.lastTrustedInputAt) / 1_000),
  );
}

export function hasRealInput(
  report: Pick<ProbeReport, "real_mouse" | "real_keyboard">,
) {
  return report.real_mouse > 0 || report.real_keyboard > 0;
}

export class InputIntegrityMonitor {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stdoutBuffer = "";
  private lastReportAt = 0;
  private lastTrustedInputAt = Date.now();
  private observationStartedAt = Date.now();
  private realMouseEvents = 0;
  private realKeyboardEvents = 0;
  private injectedMouseEvents = 0;
  private injectedKeyboardEvents = 0;
  private lastRealInputAt = 0;

  get running() {
    return Boolean(this.child && !this.child.killed);
  }

  start(executablePath: string, initialSystemIdleSeconds: number) {
    if (this.running) return true;
    const now = Date.now();
    this.lastTrustedInputAt =
      now - Math.max(0, Math.floor(initialSystemIdleSeconds)) * 1_000;
    this.lastReportAt = 0;
    this.stdoutBuffer = "";
    this.lastRealInputAt = 0;
    try {
      const child = spawn(executablePath, [], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.consumeOutput(chunk));
      child.stderr.resume();
      child.once("error", () => {
        if (this.child === child) this.child = null;
      });
      child.once("exit", () => {
        if (this.child === child) this.child = null;
      });
      return true;
    } catch {
      this.child = null;
      return false;
    }
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.lastRealInputAt = 0;
    if (child && !child.killed) child.kill();
  }

  sensorAvailable(now = Date.now()) {
    return this.running && now - this.lastReportAt <= SENSOR_STALE_AFTER_MS;
  }

  idleSeconds(systemIdleSeconds: number, now = Date.now()) {
    return effectiveTrustedIdleSeconds({
      sensorAvailable: this.sensorAvailable(now),
      lastTrustedInputAt: this.lastTrustedInputAt,
      systemIdleSeconds,
      now,
    });
  }

  latestRealInputAt(now = Date.now()) {
    return this.sensorAvailable(now) && this.lastRealInputAt > 0
      ? this.lastRealInputAt
      : null;
  }

  takeObservation(now = Date.now()): InputIntegrityObservation {
    const observation: InputIntegrityObservation = {
      sensor: "windows_low_level_input",
      sensor_available: this.sensorAvailable(now),
      observed_seconds: Math.min(
        300,
        Math.max(0, Math.floor((now - this.observationStartedAt) / 1_000)),
      ),
      real_mouse_events: this.realMouseEvents,
      real_keyboard_events: this.realKeyboardEvents,
      injected_mouse_events: this.injectedMouseEvents,
      injected_keyboard_events: this.injectedKeyboardEvents,
    };
    this.observationStartedAt = now;
    this.realMouseEvents = 0;
    this.realKeyboardEvents = 0;
    this.injectedMouseEvents = 0;
    this.injectedKeyboardEvents = 0;
    return observation;
  }

  private consumeOutput(chunk: string) {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      const report = parseProbeReport(line);
      if (!report) continue;
      const now = Date.now();
      this.lastReportAt = now;
      this.realMouseEvents += report.real_mouse;
      this.realKeyboardEvents += report.real_keyboard;
      this.injectedMouseEvents += report.injected_mouse;
      this.injectedKeyboardEvents += report.injected_keyboard;
      if (hasRealInput(report)) {
        this.lastRealInputAt = now;
        // One physical mouse or keyboard event is real presence. Requiring
        // activity across several reports made a quick mouse move look ignored
        // and pushed employees to type unnecessarily. Injected events stay
        // excluded because the native probe reports them in separate counters.
        this.lastTrustedInputAt = now;
      }
    }
  }
}
