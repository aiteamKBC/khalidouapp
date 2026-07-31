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
export const TRUSTED_ACTIVITY_CONFIRMATION_WINDOW_MS = 8_000;
export const TRUSTED_ACTIVITY_MIN_REPORTS = 3;
export const TRUSTED_ACTIVITY_MIN_SPAN_MS = 1_500;

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

export function hasSustainedTrustedActivity(
  reportTimes: number[],
  now: number,
) {
  const recentReports = reportTimes
    .filter(
      (reportedAt) =>
        Number.isFinite(reportedAt) &&
        reportedAt <= now &&
        now - reportedAt <= TRUSTED_ACTIVITY_CONFIRMATION_WINDOW_MS,
    )
    .sort((left, right) => left - right);
  if (recentReports.length < TRUSTED_ACTIVITY_MIN_REPORTS) {
    return false;
  }
  return (
    recentReports[recentReports.length - 1] - recentReports[0] >=
    TRUSTED_ACTIVITY_MIN_SPAN_MS
  );
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
  private realInputReportTimes: number[] = [];
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
    this.realInputReportTimes = [];
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
    this.realInputReportTimes = [];
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

  sustainedActivitySince(startedAt: number, now = Date.now()) {
    if (!this.sensorAvailable(now)) {
      return null;
    }
    return hasSustainedTrustedActivity(
      this.realInputReportTimes.filter(
        (reportedAt) => reportedAt >= startedAt,
      ),
      now,
    );
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
      if (report.real_mouse + report.real_keyboard > 0) {
        this.lastRealInputAt = now;
        this.realInputReportTimes = [
          ...this.realInputReportTimes.filter(
            (reportedAt) =>
              now - reportedAt <= TRUSTED_ACTIVITY_CONFIRMATION_WINDOW_MS,
          ),
          now,
        ];
        if (hasSustainedTrustedActivity(this.realInputReportTimes, now)) {
          this.lastTrustedInputAt = now;
        }
      }
    }
  }
}
