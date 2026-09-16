import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRestoreFailure,
  refreshFailureClears,
  shouldClearSavedSession,
} from "./auth-restore-policy.ts";

// W7: only an authenticated-but-rejected response clears the saved login; a
// transient network/server failure keeps it so recovery needs no re-login.

test("a revoked session (401/403) clears the saved login", () => {
  assert.equal(shouldClearSavedSession({ status: 401 }), true);
  assert.equal(shouldClearSavedSession({ status: 403 }), true);
  assert.equal(classifyRestoreFailure({ status: 401 }), "revoked");
});

test("a transient failure keeps the saved login", () => {
  assert.equal(shouldClearSavedSession({ status: 500 }), false);
  assert.equal(shouldClearSavedSession({ status: 503 }), false);
  assert.equal(shouldClearSavedSession({ status: 0 }), false);
  assert.equal(shouldClearSavedSession(new Error("Failed to fetch")), false);
  assert.equal(shouldClearSavedSession(undefined), false);
  assert.equal(classifyRestoreFailure({ status: 503 }), "transient");
});

// W7 (refresh path): a token-refresh HTTP failure clears the session only on a
// genuine auth rejection; a transient outage keeps the tokens for retry.

test("refresh 401/403 clears the saved session", () => {
  assert.equal(refreshFailureClears(401), true);
  assert.equal(refreshFailureClears(403), true);
});

test("a transient refresh failure keeps the saved session", () => {
  assert.equal(refreshFailureClears(500), false);
  assert.equal(refreshFailureClears(503), false);
  assert.equal(refreshFailureClears(0), false);
  assert.equal(refreshFailureClears(429), false);
});
