import assert from "node:assert/strict";
import test from "node:test";

import {
  crashRecoveryAttempt,
  crashRecoveryShouldContinue,
  isCrashRecoveryLaunch,
  MAX_CRASH_RECOVERY_ATTEMPTS,
  nextCrashRecoveryArgument,
  shouldRestartAfterCrash,
} from "../electron/services/crashRecovery.ts";

test("a normal launch has no crash-recovery attempt", () => {
  assert.equal(crashRecoveryAttempt(["Khaliduo.exe"]), 0);
  assert.equal(isCrashRecoveryLaunch(["Khaliduo.exe"]), false);
});

test("a recovery launch preserves its bounded attempt number", () => {
  const argv = ["Khaliduo.exe", "--crash-recovery-attempt=2"];
  assert.equal(crashRecoveryAttempt(argv), 2);
  assert.equal(isCrashRecoveryLaunch(argv), true);
  assert.equal(nextCrashRecoveryArgument(2), "--crash-recovery-attempt=3");
});

test("rapid crash recovery stops after three attempts", () => {
  assert.equal(shouldRestartAfterCrash(0), true);
  assert.equal(shouldRestartAfterCrash(MAX_CRASH_RECOVERY_ATTEMPTS - 1), true);
  assert.equal(shouldRestartAfterCrash(MAX_CRASH_RECOVERY_ATTEMPTS), false);
});

test("crash recovery continues for an enrolled online session with no local row (Bug 4)", () => {
  // The core regression: an online session has no open local-only row, yet
  // recovery must continue into normal startup to reconcile it with the server.
  assert.equal(
    crashRecoveryShouldContinue({
      enrolled: true,
      hasDeviceId: true,
      trackingStoppedByUser: false,
    }),
    true,
  );
});

test("crash recovery exits for logout and explicit stop, not a crash", () => {
  assert.equal(
    crashRecoveryShouldContinue({
      enrolled: false,
      hasDeviceId: false,
      trackingStoppedByUser: false,
    }),
    false,
    "a not-enrolled device (post-logout) has nothing to recover",
  );
  assert.equal(
    crashRecoveryShouldContinue({
      enrolled: true,
      hasDeviceId: true,
      trackingStoppedByUser: true,
    }),
    false,
    "an explicit Stop is not a crash and must not resurrect tracking",
  );
});
