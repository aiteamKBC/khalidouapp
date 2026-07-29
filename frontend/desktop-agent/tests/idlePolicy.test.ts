import assert from "node:assert/strict";
import test from "node:test";

import {
  hasReachedIdleThreshold,
  idleDurationAfterThreshold,
  IDLE_THRESHOLD_MINUTES,
  IDLE_THRESHOLD_SECONDS,
} from "../electron/services/idlePolicy.ts";

test("idle starts only after ten complete minutes without input", () => {
  assert.equal(IDLE_THRESHOLD_MINUTES, 10);
  assert.equal(IDLE_THRESHOLD_SECONDS, 600);
  assert.equal(hasReachedIdleThreshold(599), false);
  assert.equal(hasReachedIdleThreshold(600), true);
  assert.equal(hasReachedIdleThreshold(601), true);
});

test("idle duration starts at zero after the ten-minute grace period", () => {
  assert.equal(idleDurationAfterThreshold(599), 0);
  assert.equal(idleDurationAfterThreshold(600), 0);
  assert.equal(idleDurationAfterThreshold(601), 1);
  assert.equal(idleDurationAfterThreshold(900), 300);
});
