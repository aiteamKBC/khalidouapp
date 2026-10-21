import assert from "node:assert/strict";
import test from "node:test";

import {
  newWorkdayStartAction,
  requiresExplicitFreshSessionStart,
} from "../electron/services/trackingStartPolicy.ts";

test("a fresh session outside the shift requires employee confirmation", () => {
  assert.equal(
    requiresExplicitFreshSessionStart({
      hasExistingSession: false,
      confirmationAccepted: false,
    }),
    true,
  );
});

test("confirmation permits a fresh extra-time session", () => {
  assert.equal(
    requiresExplicitFreshSessionStart({
      hasExistingSession: false,
      confirmationAccepted: true,
    }),
    false,
  );
});

test("an existing session continues across the shift boundary", () => {
  assert.equal(
    requiresExplicitFreshSessionStart({
      hasExistingSession: true,
      confirmationAccepted: false,
    }),
    false,
  );
});

test("a fresh scheduled-shift session also requires presence confirmation", () => {
  assert.equal(
    requiresExplicitFreshSessionStart({
      hasExistingSession: false,
      confirmationAccepted: false,
    }),
    true,
  );
});

test("a new day with nothing running asks to start work on the first input", () => {
  assert.equal(
    newWorkdayStartAction({
      enrolled: true,
      hasTrackingSession: false,
      trackingStatus: "paused",
    }),
    "prompt_on_input",
  );
});

test("work already running past midnight is not interrupted by a start prompt", () => {
  assert.equal(
    newWorkdayStartAction({
      enrolled: true,
      hasTrackingSession: true,
      trackingStatus: "active",
    }),
    "already_working",
  );
});

test("an idle session left open overnight waits for the server to close it", () => {
  assert.equal(
    newWorkdayStartAction({
      enrolled: true,
      hasTrackingSession: true,
      trackingStatus: "idle",
    }),
    "wait",
  );
});

test("an unenrolled device never asks to start work", () => {
  assert.equal(
    newWorkdayStartAction({
      enrolled: false,
      hasTrackingSession: false,
      trackingStatus: "offline",
    }),
    "wait",
  );
});
