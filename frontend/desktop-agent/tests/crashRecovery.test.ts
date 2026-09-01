import assert from "node:assert/strict";
import test from "node:test";

import {
  crashRecoveryAttempt,
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
