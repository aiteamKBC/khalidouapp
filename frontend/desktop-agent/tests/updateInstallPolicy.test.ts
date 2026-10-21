import assert from "node:assert/strict";
import test from "node:test";

import {
  SILENT_INSTALL_ATTEMPTS,
  compareVersions,
  installAttemptOutcome,
  shouldClearInstallRecoveryOnBeforeQuit,
  silentInstallAllowed,
  updateDownloadStalled,
  UPDATE_INSTALL_RECOVERY_MS,
} from "../electron/services/updateInstallPolicy.ts";

test("an update install keeps its recovery watchdog through before-quit", () => {
  assert.equal(shouldClearInstallRecoveryOnBeforeQuit(true), false);
  assert.equal(UPDATE_INSTALL_RECOVERY_MS, 30_000);
});

test("a regular application quit clears any stale install watchdog", () => {
  assert.equal(shouldClearInstallRecoveryOnBeforeQuit(false), true);
});

test("a download with no progress for ten minutes counts as stuck", () => {
  const now = 10 * 60_000;
  assert.equal(
    updateDownloadStalled({ status: "downloading", lastProgressAt: 0, now }),
    true,
  );
  assert.equal(
    updateDownloadStalled({ status: "available", lastProgressAt: 1, now }),
    false,
  );
  // Only an in-flight download can stall.
  assert.equal(
    updateDownloadStalled({ status: "ready", lastProgressAt: 0, now }),
    false,
  );
  assert.equal(
    updateDownloadStalled({ status: "downloading", lastProgressAt: null, now }),
    false,
  );
});

test("versions compare numerically, not as text", () => {
  assert.ok(compareVersions("1.1.101", "1.1.99") > 0);
  assert.ok(compareVersions("1.1.99", "1.1.101") < 0);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
});

test("the old build running after an install means the install failed", () => {
  const attempt = {
    version: "1.1.102",
    failedAttempts: 0,
    attemptedAt: "2026-10-21T10:00:00.000Z",
  };
  assert.equal(installAttemptOutcome(attempt, "1.1.101"), "failed");
  assert.equal(installAttemptOutcome(attempt, "1.1.102"), "installed");
  assert.equal(installAttemptOutcome(attempt, "1.1.103"), "installed");
});

test("repeated silent failures switch to the visible installer", () => {
  const attempt = (failedAttempts: number) => ({
    version: "1.1.102",
    failedAttempts,
    attemptedAt: "",
  });
  assert.equal(silentInstallAllowed(null, "1.1.102"), true);
  assert.equal(silentInstallAllowed(attempt(1), "1.1.102"), true);
  assert.equal(
    silentInstallAllowed(attempt(SILENT_INSTALL_ATTEMPTS), "1.1.102"),
    false,
  );
  // A newer release starts again with silent installs.
  assert.equal(
    silentInstallAllowed(attempt(SILENT_INSTALL_ATTEMPTS), "1.1.103"),
    true,
  );
});
