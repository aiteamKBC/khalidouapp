import assert from "node:assert/strict";
import test from "node:test";

import {
  BREAK_IDLE_THRESHOLD_MINUTES,
  BREAK_IDLE_THRESHOLD_SECONDS,
  hasReachedIdleThreshold,
  idleDurationAfterThreshold,
  IDLE_THRESHOLD_MINUTES,
  IDLE_THRESHOLD_SECONDS,
  inputResumedAfterIdle,
  shouldWaitForInputBeforeRestart,
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

test("a scheduled break uses a three-minute idle threshold", () => {
  assert.equal(BREAK_IDLE_THRESHOLD_MINUTES, 3);
  assert.equal(BREAK_IDLE_THRESHOLD_SECONDS, 180);
  assert.equal(hasReachedIdleThreshold(179, true), false);
  assert.equal(hasReachedIdleThreshold(180, true), true);
  assert.equal(idleDurationAfterThreshold(180, true), 0);
  assert.equal(idleDurationAfterThreshold(185, true), 5);
});

test("returning early from a break is detected from fresh input", () => {
  assert.equal(inputResumedAfterIdle(181, 180), false);
  assert.equal(inputResumedAfterIdle(0, 240), true);
  assert.equal(inputResumedAfterIdle(3, 240), true);
});

test("an idle server close waits for input instead of opening empty sessions", () => {
  assert.equal(shouldWaitForInputBeforeRestart("idle", true), true);
  assert.equal(shouldWaitForInputBeforeRestart("locked", true), true);
  assert.equal(shouldWaitForInputBeforeRestart("sleeping", true), true);
  assert.equal(shouldWaitForInputBeforeRestart("active", true), false);
  assert.equal(shouldWaitForInputBeforeRestart("idle", false), false);
});
