import assert from "node:assert/strict";
import test, { after } from "node:test";
import { databaseContext, cleanupTemporaryDirectories } from "./support/mainHarness.ts";
import type { TrackingSyncSnapshot } from "../electron/services/trackingHealth.ts";

after(cleanupTemporaryDirectories);

test("queue health includes closed recovery sessions, backed-off events, and pending screenshots", async () => {
  const c = await databaseContext();
  const snapshot = (c.trackingSyncSnapshot as (device: string, session: string | null) => TrackingSyncSnapshot);
  assert.equal(snapshot("device", null).databaseReady, true);
  c.createLocalTrackingSession({ sessionId: "closed", deviceId: "device", startedAt: "2026-09-10T11:00:00Z", status: "active" });
  c.closeLocalTrackingSession({ sessionId: "closed", endedAt: "2026-09-10T11:30:00Z", status: "ended", activeSeconds: 1800, idleSeconds: 0 });
  c.createLocalTrackingSession({ sessionId: "other-device", deviceId: "other", startedAt: "2026-09-10T10:00:00Z", status: "active" });
  c.enqueuePendingEvent({ id: "waiting", method: "POST", endpoint: "/agent/sessions/A/heartbeat", payload: {}, idempotencyKey: "waiting" });
  c.markPendingEventFailed("waiting", 3);
  c.enqueuePendingEvent({ id: "delivered", method: "POST", endpoint: "/agent/sessions/A/events", payload: {}, idempotencyKey: "delivered" });
  c.markPendingEventUploaded("delivered");
  c.enqueuePendingScreenshot({ screenshotId: "shot", metadata: {}, filePath: "test.jpg" });
  const queued = snapshot("device", null);
  assert.equal(queued.pendingEvents, 1, "backoff does not make work disappear from health");
  assert.equal(queued.pendingScreenshots, 1);
  assert.equal(queued.pendingSessions, 1, "closed unsynced work counts; another device does not");
  assert.equal(queued.oldestPendingAt, "2026-09-10T11:00:00Z");
  c.markLocalTrackingSessionSynced("closed");
  c.markPendingEventUploaded("waiting");
  c.markPendingScreenshotUploaded("shot");
  const drained = snapshot("device", null);
  assert.equal(drained.pendingEvents + drained.pendingScreenshots + drained.pendingSessions, 0);
  assert.equal(drained.oldestPendingAt, null);
});

test("local-save confirmation comes from the current device's persisted checkpoint", async () => {
  const c = await databaseContext();
  c.createLocalTrackingSession({ sessionId: "local", deviceId: "device", startedAt: "2026-09-10T11:00:00Z", status: "active" });
  c.checkpointLocalTrackingSession({ sessionId: "local", status: "active", activeSeconds: 42, idleSeconds: 0, checkpointAt: "2026-09-10T11:00:42Z" });
  assert.equal(c.trackingSyncSnapshot("device", "local").localCheckpointAt, "2026-09-10T11:00:42Z");
  assert.equal(c.trackingSyncSnapshot("other", "local").localCheckpointAt, null);
});

test("a failed disk write is not described as a healthy saved checkpoint", async () => {
  const c = await databaseContext();
  c.fs = { ...c.fs, renameSync: () => { throw new Error("disk full"); } };
  assert.throws(() => c.createLocalTrackingSession({ sessionId: "local", deviceId: "device", startedAt: "2026-09-10T11:00:00Z", status: "active" }), /disk full/);
  assert.equal(c.trackingSyncSnapshot("device", "local").databaseReady, false);
});
