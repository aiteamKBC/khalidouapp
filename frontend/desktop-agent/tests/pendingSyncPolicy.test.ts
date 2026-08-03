import assert from "node:assert/strict";
import test from "node:test";

import { isPermanentPendingEventSyncFailure } from "../electron/services/pendingSyncPolicy.ts";

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

test("retires events only after a definitive client rejection", () => {
  assert.equal(isPermanentPendingEventSyncFailure(400), true);
  assert.equal(isPermanentPendingEventSyncFailure(401), true);
  assert.equal(isPermanentPendingEventSyncFailure(404), true);
  assert.equal(isPermanentPendingEventSyncFailure(422), true);
});
