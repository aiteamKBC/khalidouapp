import assert from "node:assert/strict";
import test from "node:test";
import {
  TrackingHealthMonitor,
  SYNC_DELAY_WARNING_MS,
  TRACKING_INTERRUPTION_GRACE_MS,
  type TrackingHealthInput,
} from "../electron/services/trackingHealth.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const iso = (offset = 0) => new Date(NOW + offset).toISOString();

function input(overrides: Partial<TrackingHealthInput> = {}): TrackingHealthInput {
  return {
    identityKey: "employee-device:1",
    enrolled: true,
    trackingExpected: true,
    trackingPaused: false,
    trackingStatus: "active",
    hasTrackingSession: true,
    lastTrackingTickAgeMs: 1_000,
    connectionStatus: "online",
    lastSuccessfulSyncAt: iso(),
    sync: {
      databaseReady: true,
      pendingEvents: 0,
      pendingScreenshots: 0,
      pendingSessions: 0,
      oldestPendingAt: null,
      localCheckpointAt: null,
    },
    ...overrides,
  };
}

test("online connectivity does not label a nonempty outbox as synced", () => {
  const value = input();
  value.sync.pendingEvents = 3;
  value.sync.pendingScreenshots = 1;
  value.sync.oldestPendingAt = iso(-30_000);
  const health = new TrackingHealthMonitor().sample(value, NOW, 0);
  assert.equal(health.tracking.state, "recording");
  assert.equal(health.sync.state, "pending");
  assert.equal(health.pendingEvents, 3);
});

test("an actual recent offline checkpoint shows saved-on-device while recording continues", () => {
  const value = input({ connectionStatus: "offline" });
  value.sync.pendingSessions = 1;
  value.sync.oldestPendingAt = iso(-20_000);
  value.sync.localCheckpointAt = iso(-2_000);
  const health = new TrackingHealthMonitor().sample(value, NOW, 0);
  assert.equal(health.tracking.state, "recording");
  assert.equal(health.sync.label, "Saved on this device");
  assert.equal(health.alerts.length, 0);
});

test("offline status alone never promises a local save", () => {
  const health = new TrackingHealthMonitor().sample(input({ connectionStatus: "offline" }), NOW, 0);
  assert.equal(health.sync.state, "offline");
  assert.doesNotMatch(health.sync.detail, /saved/i);
});

test("an empty outbox with no successful contact waits for first sync", () => {
  const health = new TrackingHealthMonitor().sample(input({ lastSuccessfulSyncAt: null }), NOW, 0);
  assert.equal(health.sync.state, "checking");
});

test("a fully drained outbox after server contact is up to date", () => {
  const health = new TrackingHealthMonitor().sample(input(), NOW, 0);
  assert.equal(health.sync.state, "synced");
  assert.equal(health.alerts.length, 0);
});

test("a backed-off item warns after five minutes even while other requests succeed", () => {
  const value = input();
  value.sync.pendingEvents = 1;
  value.sync.oldestPendingAt = iso(-SYNC_DELAY_WARNING_MS);
  const health = new TrackingHealthMonitor().sample(value, NOW, 0);
  assert.equal(health.sync.state, "delayed");
  assert.equal(health.alerts[0].key, "sync_delayed");
});

test("a missing timer gets a startup grace period then an interruption warning", () => {
  const monitor = new TrackingHealthMonitor();
  const value = input({ hasTrackingSession: false, lastTrackingTickAgeMs: null, trackingStatus: "starting" });
  assert.equal(monitor.sample(value, NOW, 0).tracking.state, "starting");
  assert.equal(monitor.sample(value, NOW + 29_999, 29_999).tracking.state, "starting");
  assert.equal(monitor.sample(value, NOW + 30_000, 30_000).tracking.state, "interrupted");
});

test("a stalled accumulator cannot keep showing a green running timer", () => {
  const health = new TrackingHealthMonitor().sample(input({ lastTrackingTickAgeMs: TRACKING_INTERRUPTION_GRACE_MS }), NOW, 0);
  assert.equal(health.tracking.state, "interrupted");
});

test("manual pause, another device, idle, lock, sleep and waiting for input are intentional", () => {
  for (const options of [
    { trackingExpected: false, trackingPaused: true, trackingStatus: "paused" },
    { trackingExpected: false, trackingMovedToDevice: "Office PC", trackingPaused: true },
    { trackingStatus: "idle" },
    { trackingStatus: "locked" },
    { trackingStatus: "sleeping" },
    { trackingExpected: false, trackingStatus: "starting" },
  ]) {
    const monitor = new TrackingHealthMonitor();
    const value = input({ ...options, hasTrackingSession: false, lastTrackingTickAgeMs: null });
    monitor.sample(value, NOW, 0);
    const health = monitor.sample(value, NOW + 60_000, 60_000);
    assert.notEqual(health.tracking.state, "interrupted", JSON.stringify(options));
    assert.equal(health.alerts.length, 0);
  }
});

test("no first contact warns after five elapsed minutes despite a wall clock jump", () => {
  const monitor = new TrackingHealthMonitor();
  const value = input({ connectionStatus: "offline", lastSuccessfulSyncAt: null });
  monitor.sample(value, NOW, 0);
  assert.notEqual(monitor.sample(value, NOW + 86400_000, 1_000).sync.state, "delayed");
  assert.equal(monitor.sample(value, NOW + 86400_000, SYNC_DELAY_WARNING_MS).sync.state, "delayed");
});

test("an intentional pause without pending work does not demand background uploads", () => {
  const monitor = new TrackingHealthMonitor();
  const value = input({ trackingExpected: false, trackingPaused: true,
    trackingStatus: "paused", lastSuccessfulSyncAt: iso(-SYNC_DELAY_WARNING_MS) });
  const health = monitor.sample(value, NOW, 0);
  assert.equal(health.sync.label, "No pending uploads");
  assert.equal(health.alerts.length, 0);
  value.sync.pendingEvents = 1;
  value.sync.oldestPendingAt = iso(-SYNC_DELAY_WARNING_MS);
  assert.equal(monitor.sample(value, NOW, 1).sync.state, "delayed", "pause cannot hide an actual backlog");
});

test("notifications fire once per issue and rearm after actual recovery", () => {
  const monitor = new TrackingHealthMonitor();
  const offline = input({ connectionStatus: "offline", lastSuccessfulSyncAt: iso(-SYNC_DELAY_WARNING_MS) });
  const health = monitor.sample(offline, NOW, 0);
  assert.equal(monitor.takeNotification(health)?.key, "sync_delayed");
  assert.equal(monitor.takeNotification(monitor.sample(offline, NOW, 1_000)), null);
  monitor.sample(input(), NOW, 2_000);
  assert.equal(monitor.takeNotification(monitor.sample(offline, NOW, 3_000))?.key, "sync_delayed");
});

test("logout and a new identity clear warning history and startup grace", () => {
  const monitor = new TrackingHealthMonitor();
  const broken = input({ hasTrackingSession: false, lastTrackingTickAgeMs: null });
  monitor.sample(broken, NOW, 0);
  assert.equal(monitor.sample(broken, NOW + 30_000, 30_000).tracking.state, "interrupted");
  const next = input({ ...broken, identityKey: "new-device:2" });
  assert.equal(monitor.sample(next, NOW + 40_000, 40_000).tracking.state, "starting");
  assert.deepEqual(monitor.sample(input({ enrolled: false }), NOW + 60_000, 60_000).alerts, []);
});

test("unavailable local storage cannot be shown as successfully saved or synced", () => {
  const value = input();
  value.sync.databaseReady = false;
  const health = new TrackingHealthMonitor().sample(value, NOW, 0);
  assert.equal(health.sync.state, "unavailable");
  assert.equal(health.alerts[0].key, "local_storage_unavailable");
});
