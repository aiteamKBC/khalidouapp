import assert from "node:assert/strict";
import test from "node:test";

import {
  screenshotCaptureBlockReasonForState,
} from "../electron/services/runtimePolicies.ts";

const activeScreenshotState = {
  enrolled: true,
  screenshotsEnabled: true,
  hasActiveSession: true,
  trackingPaused: false,
  onAcPower: true,
  trackingStatus: "active" as const,
  systemIdleSeconds: 0,
};

test("active off-shift work remains eligible for screenshots", () => {
  assert.equal(
    screenshotCaptureBlockReasonForState(activeScreenshotState),
    null,
  );
});

test("no screenshot is captured when the employee has no active session", () => {
  assert.equal(
    screenshotCaptureBlockReasonForState({
      ...activeScreenshotState,
      hasActiveSession: false,
    }),
    "no_active_session",
  );
});

test("no screenshot is captured during a pause", () => {
  assert.equal(
    screenshotCaptureBlockReasonForState({
      ...activeScreenshotState,
      trackingPaused: true,
    }),
    "tracking_paused",
  );
});

test("no screenshot is captured after ten minutes without input", () => {
  assert.equal(
    screenshotCaptureBlockReasonForState({
      ...activeScreenshotState,
      systemIdleSeconds: 600,
    }),
    "no_user_activity",
  );
});
