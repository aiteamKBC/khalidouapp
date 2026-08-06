import assert from "node:assert/strict";
import test from "node:test";

import {
  automaticIdleReturnAction,
  BREAK_IDLE_THRESHOLD_MINUTES,
  BREAK_IDLE_THRESHOLD_SECONDS,
  hasReachedIdleThreshold,
  idleDurationAfterThreshold,
  idleReturnInputDetected,
  idleReturnVerificationExpired,
  IDLE_RETURN_VERIFICATION_SECONDS,
  IDLE_THRESHOLD_MINUTES,
  IDLE_THRESHOLD_SECONDS,
  inputResumedAfterIdle,
  reclassifyVerifiedReturnCounters,
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

test("a stale keyboard probe timestamp cannot hide a later mouse return", () => {
  assert.equal(
    idleReturnInputDetected({
      latestRealInputAt: 10_000,
      lastHandledRealInputAt: 10_000,
      systemIdleSeconds: 0,
      previousSystemIdleSeconds: 900,
    }),
    true,
  );
  assert.equal(
    idleReturnInputDetected({
      latestRealInputAt: 10_000,
      lastHandledRealInputAt: 10_000,
      systemIdleSeconds: 901,
      previousSystemIdleSeconds: 900,
    }),
    false,
  );
});

test("fresh low-level mouse input still opens the return review", () => {
  assert.equal(
    idleReturnInputDetected({
      latestRealInputAt: 10_001,
      lastHandledRealInputAt: 10_000,
      systemIdleSeconds: 900,
      previousSystemIdleSeconds: 899,
    }),
    true,
  );
});

test("input opens a review and explicit confirmation resumes immediately", () => {
  assert.equal(
    automaticIdleReturnAction({
      trackingStatus: "idle",
      immediateInputDetected: true,
      confirmationAccepted: false,
      sustainedInputConfirmed: false,
    }),
    "review",
  );
  assert.equal(
    automaticIdleReturnAction({
      trackingStatus: "idle",
      immediateInputDetected: true,
      confirmationAccepted: true,
      sustainedInputConfirmed: false,
    }),
    "resume",
  );
  assert.equal(
    automaticIdleReturnAction({
      trackingStatus: "idle",
      immediateInputDetected: true,
      confirmationAccepted: true,
      sustainedInputConfirmed: true,
    }),
    "resume",
  );
  assert.equal(
    automaticIdleReturnAction({
      trackingStatus: "active",
      immediateInputDetected: true,
      confirmationAccepted: true,
      sustainedInputConfirmed: true,
    }),
    "wait",
  );
});

test("an unconfirmed return expires after three minutes", () => {
  assert.equal(IDLE_RETURN_VERIFICATION_SECONDS, 180);
  assert.equal(idleReturnVerificationExpired(1_000, 180_999), false);
  assert.equal(idleReturnVerificationExpired(1_000, 181_000), true);
});

test("verified return time moves from idle to active exactly once", () => {
  assert.deepEqual(
    reclassifyVerifiedReturnCounters({
      activeSeconds: 100,
      idleSeconds: 63,
      eligibleIdleSeconds: 53,
      idleSecondsAtVerificationStart: 60,
      eligibleIdleSecondsAtVerificationStart: 50,
      verifiedSeconds: 3,
    }),
    {
      activeSeconds: 103,
      idleSeconds: 60,
      eligibleIdleSeconds: 50,
    },
  );
});

test("verified return never removes unrelated server idle counters", () => {
  assert.deepEqual(
    reclassifyVerifiedReturnCounters({
      activeSeconds: 100,
      idleSeconds: 70,
      eligibleIdleSeconds: 65,
      idleSecondsAtVerificationStart: 60,
      eligibleIdleSecondsAtVerificationStart: 60,
      verifiedSeconds: 2,
    }),
    {
      activeSeconds: 102,
      idleSeconds: 68,
      eligibleIdleSeconds: 63,
    },
  );
});

test("failed return verification does not create payable time", () => {
  assert.deepEqual(
    reclassifyVerifiedReturnCounters({
      activeSeconds: 100,
      idleSeconds: 240,
      eligibleIdleSeconds: 200,
      idleSecondsAtVerificationStart: 60,
      eligibleIdleSecondsAtVerificationStart: 20,
      verifiedSeconds: 0,
    }),
    {
      activeSeconds: 100,
      idleSeconds: 240,
      eligibleIdleSeconds: 200,
    },
  );
});

test("an idle server close waits for input instead of opening empty sessions", () => {
  assert.equal(shouldWaitForInputBeforeRestart("idle", true), true);
  assert.equal(shouldWaitForInputBeforeRestart("locked", true), true);
  assert.equal(shouldWaitForInputBeforeRestart("sleeping", true), true);
  assert.equal(shouldWaitForInputBeforeRestart("active", true), false);
  assert.equal(shouldWaitForInputBeforeRestart("idle", false), false);
});
