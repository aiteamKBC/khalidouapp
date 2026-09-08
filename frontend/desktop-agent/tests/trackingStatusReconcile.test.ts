import assert from "node:assert/strict";
import test from "node:test";

import { reconcileTrackingStatusAfterSync } from "../electron/services/trackingStatusReconcile.ts";

test("a posted resume wins over a stale server echo of idle", () => {
  // User clicked Continue: we posted "active"; no concurrent local change; the
  // server snapshot still reads idle. The resume must stick.
  const resolved = reconcileTrackingStatusAfterSync({
    postedStatus: "active",
    localStatusBeforeSync: "active",
    sessionEndedServerSide: false,
  });
  assert.equal(resolved, "active");
});

test("a heartbeat does not bounce an active session back to idle", () => {
  const resolved = reconcileTrackingStatusAfterSync({
    postedStatus: "active",
    localStatusBeforeSync: "active",
    sessionEndedServerSide: false,
  });
  assert.equal(resolved, "active");
});

test("a concurrent local transition during the round-trip wins", () => {
  // The screen locked mid-request after we posted active.
  const resolved = reconcileTrackingStatusAfterSync({
    postedStatus: "active",
    localStatusBeforeSync: "locked",
    sessionEndedServerSide: false,
  });
  assert.equal(resolved, "locked");
});

test("a server-ended session is respected (no override)", () => {
  const resolved = reconcileTrackingStatusAfterSync({
    postedStatus: "active",
    localStatusBeforeSync: "active",
    sessionEndedServerSide: true,
  });
  assert.equal(resolved, null);
});
