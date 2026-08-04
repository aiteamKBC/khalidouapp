import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldClearInstallRecoveryOnBeforeQuit,
  UPDATE_INSTALL_RECOVERY_MS,
} from "../electron/services/updateInstallPolicy.ts";

test("an update install keeps its recovery watchdog through before-quit", () => {
  assert.equal(shouldClearInstallRecoveryOnBeforeQuit(true), false);
  assert.equal(UPDATE_INSTALL_RECOVERY_MS, 30_000);
});

test("a regular application quit clears any stale install watchdog", () => {
  assert.equal(shouldClearInstallRecoveryOnBeforeQuit(false), true);
});
