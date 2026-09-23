import assert from "node:assert/strict";
import test from "node:test";

import {
  connectionStatusAfterApiFailure,
  isPermanentScreenshotSyncFailure,
  screenshotCaptureBlockReasonForState,
} from "../electron/services/runtimePolicies.ts";

const activeScreenshotState = {
  enrolled: true,
  screenshotsEnabled: true,
  hasActiveSession: true,
  manualPauseActive: false,
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

test("no screenshot is captured during a manual unpaid pause", () => {
  assert.equal(
    screenshotCaptureBlockReasonForState({
      ...activeScreenshotState,
      manualPauseActive: true,
    }),
    "tracking_paused",
  );
});

test("a paid pause keeps capturing (independent company policy)", () => {
  // A paid pause marks tracking as paused but does not set manualPauseActive,
  // so screenshot capture continues.
  assert.equal(
    screenshotCaptureBlockReasonForState({
      ...activeScreenshotState,
      manualPauseActive: false,
    }),
    null,
  );
});

test("sign-out / stop keeps capturing (independent company policy)", () => {
  // Stop/sign-out also pauses tracking but deliberately keeps screenshot
  // monitoring active for an enrolled device; manualPauseActive stays false.
  assert.equal(
    screenshotCaptureBlockReasonForState({
      ...activeScreenshotState,
      manualPauseActive: false,
      trackingStatus: "paused",
    }),
    null,
  );
});

test("no screenshot is captured after fifteen minutes without input", () => {
  assert.equal(
    screenshotCaptureBlockReasonForState({
      ...activeScreenshotState,
      systemIdleSeconds: 900,
    }),
    "no_user_activity",
  );
  // Just below the 15-minute threshold the device is still considered active.
  assert.equal(
    screenshotCaptureBlockReasonForState({
      ...activeScreenshotState,
      systemIdleSeconds: 600,
    }),
    null,
  );
});

test("screenshot eligibility follows the last synced company idle threshold", () => {
  assert.equal(
    screenshotCaptureBlockReasonForState({
      ...activeScreenshotState,
      systemIdleSeconds: 420,
      idleThresholdMinutes: 7,
    }),
    "no_user_activity",
  );
});

test("an HTTP rejection does not make the whole agent appear offline", () => {
  assert.equal(connectionStatusAfterApiFailure(409), "online");
  assert.equal(connectionStatusAfterApiFailure(503), "online");
  assert.equal(connectionStatusAfterApiFailure(undefined), "offline");
});

test("an AC-power rejection is quarantined instead of retried forever", () => {
  assert.equal(
    isPermanentScreenshotSyncFailure({
      responseStatus: 409,
      apiErrorCode: "SCREENSHOT_AC_POWER_REQUIRED",
    }),
    true,
  );
  assert.equal(
    isPermanentScreenshotSyncFailure({ responseStatus: 409 }),
    false,
  );
});

test("server and authentication failures remain retryable", () => {
  assert.equal(
    isPermanentScreenshotSyncFailure({ responseStatus: 401 }),
    false,
  );
  assert.equal(
    isPermanentScreenshotSyncFailure({ responseStatus: 503 }),
    false,
  );
  assert.equal(
    isPermanentScreenshotSyncFailure({ responseStatus: undefined }),
    false,
  );
});
