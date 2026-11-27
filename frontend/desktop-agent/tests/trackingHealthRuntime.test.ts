import assert from "node:assert/strict";
import test from "node:test";
import { TrackingHealthMonitor, type TrackingHealth } from "../electron/services/trackingHealth.ts";
import { context, functions, FIXED_NOW } from "./support/mainHarness.ts";

const sync = {
  databaseReady: true, pendingEvents: 1, pendingScreenshots: 0, pendingSessions: 0,
  oldestPendingAt: new Date(FIXED_NOW - 360_000).toISOString(), localCheckpointAt: null,
};

test("the runtime reads actual session/tick/queue evidence without changing counters or intent", () => {
  const c = context({
    trackingHealthMonitor: new TrackingHealthMonitor(),
    trackingSyncSnapshot: () => sync,
    isInstallingUpdate: false,
  });
  functions(c, "automaticTrackingIsExpected", "hasTrackingSession", "currentTrackingHealth");
  const before = JSON.stringify(c.runtimeStatus);
  const health: TrackingHealth = c.currentTrackingHealth();
  assert.equal(health.tracking.state, "recording");
  assert.equal(health.sync.state, "delayed");
  assert.equal(JSON.stringify(c.runtimeStatus), before);
  assert.equal(c.currentSessionId, "A");
  c.isInstallingUpdate = true;
  c.lastDurationTickAt = null;
  c.setClock(FIXED_NOW + 60_000);
  assert.notEqual(c.currentTrackingHealth().tracking.state, "interrupted", "installation is an intentional restart");
});

test("background notifications are deduplicated, open the app on click, and stop on quit", () => {
  const monitor = new TrackingHealthMonitor();
  const health: TrackingHealth = monitor.sample({
    identityKey: "device", enrolled: true, trackingExpected: true, trackingPaused: false,
    trackingStatus: "active", hasTrackingSession: true, lastTrackingTickAgeMs: 1000,
    connectionStatus: "online", lastSuccessfulSyncAt: new Date(FIXED_NOW).toISOString(), sync,
  }, FIXED_NOW, 0);
  let tick: () => void;
  let onQuit: () => void;
  let clicked: () => void;
  let shown = 0;
  let opened = 0;
  let cleared = false;
  class TestNotification {
    static isSupported() { return true; }
    on(event: string, callback: () => void) { if (event === "click") clicked = callback; }
    show() { shown++; }
  }
  const c = context({
    trackingHealthMonitor: monitor, currentTrackingHealth: () => health,
    Notification: TestNotification, getAppIconPath: () => "preview-icon.png",
    showMainWindow: () => { opened++; },
    setInterval: (callback: () => void) => { tick = callback; return "health-timer"; },
    clearInterval: (timer: string) => { assert.equal(timer, "health-timer"); cleared = true; },
    app: { once: (event: string, callback: () => void) => { assert.equal(event, "will-quit"); onQuit = callback; } },
  });
  functions(c, "startTrackingHealthMonitoring");
  c.startTrackingHealthMonitoring();
  tick!();
  tick!();
  assert.equal(shown, 1);
  clicked!();
  assert.equal(opened, 1);
  assert.equal(c.trackingPausedByUser, false, "opening a notice cannot change tracking intent");
  c.isQuitting = true;
  tick!();
  assert.equal(shown, 1);
  onQuit!();
  assert.equal(cleared, true);
});
