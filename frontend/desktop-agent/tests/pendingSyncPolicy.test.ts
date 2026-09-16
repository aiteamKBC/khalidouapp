import assert from "node:assert/strict";
import test from "node:test";

import {
  isAuthPendingEventSyncFailure,
  isPermanentPendingEventSyncFailure,
} from "../electron/services/pendingSyncPolicy.ts";

test("keeps queued activity after connection and server failures", () => {
  assert.equal(isPermanentPendingEventSyncFailure(null), false);
  assert.equal(isPermanentPendingEventSyncFailure(undefined), false);
  assert.equal(isPermanentPendingEventSyncFailure(500), false);
  assert.equal(isPermanentPendingEventSyncFailure(503), false);
});

test("keeps queued activity after retryable client responses", () => {
  assert.equal(isPermanentPendingEventSyncFailure(408), false);
  assert.equal(isPermanentPendingEventSyncFailure(425), false);
  assert.equal(isPermanentPendingEventSyncFailure(429), false);
});

test("authentication failures are recoverable, never permanent (Bug 5)", () => {
  // A 401/403 means the token needs repair (re-enrollment), not that the
  // recorded work should be discarded.
  assert.equal(isPermanentPendingEventSyncFailure(401), false);
  assert.equal(isPermanentPendingEventSyncFailure(403), false);
  assert.equal(isAuthPendingEventSyncFailure(401), true);
  assert.equal(isAuthPendingEventSyncFailure(403), true);
  assert.equal(isAuthPendingEventSyncFailure(400), false);
  assert.equal(isAuthPendingEventSyncFailure(500), false);
  assert.equal(isAuthPendingEventSyncFailure(null), false);
});

test("retires events only after a definitive payload rejection", () => {
  assert.equal(isPermanentPendingEventSyncFailure(400), true);
  assert.equal(isPermanentPendingEventSyncFailure(404), true);
  assert.equal(isPermanentPendingEventSyncFailure(409), true);
  assert.equal(isPermanentPendingEventSyncFailure(422), true);
});
