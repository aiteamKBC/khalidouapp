import assert from "node:assert/strict";
import test from "node:test";
import { TrackingHealthMonitor } from "../electron/services/trackingHealth.ts";
import { unconfirmedTrackingHealth } from "../src/trackingHealthPresentation.ts";

test("a stale runtime cannot keep a green recording or synced badge", () => {
  const now = Date.parse("2026-11-27T12:00:00Z");
  const healthy = new TrackingHealthMonitor().sample({
    identityKey: "device:1", enrolled: true, trackingExpected: true,
    trackingPaused: false, trackingStatus: "active", hasTrackingSession: true,
    lastTrackingTickAgeMs: 1000, connectionStatus: "online",
    lastSuccessfulSyncAt: new Date(now).toISOString(),
    sync: { databaseReady: true, pendingEvents: 0, pendingScreenshots: 0,
      pendingSessions: 0, oldestPendingAt: null, localCheckpointAt: null },
  }, now, 0);
  const stale = unconfirmedTrackingHealth(healthy);
  assert.equal(stale.tracking.state, "interrupted");
  assert.equal(stale.sync.state, "checking");
  assert.equal(stale.lastServerContactAt, healthy.lastServerContactAt);
  assert.equal(healthy.tracking.state, "recording", "the previous confirmed snapshot stays intact");
});
