import assert from "node:assert/strict";
import test from "node:test";

import {
  screenshotSyncLabel,
  shouldReloadScreenshotsAfterRecovery,
} from "../src/screenshotRecovery.ts";

test("screenshots reload once the connection recovers from a load failure", () => {
  assert.equal(
    shouldReloadScreenshotsAfterRecovery({
      previousConnectionStatus: "offline",
      connectionStatus: "online",
      hasLoadError: true,
    }),
    true,
  );
});

test("screenshots do not reload continuously while the connection stays online", () => {
  assert.equal(
    shouldReloadScreenshotsAfterRecovery({
      previousConnectionStatus: "online",
      connectionStatus: "online",
      hasLoadError: true,
    }),
    false,
  );
});

test("an older screenshot is not labeled as currently synced while offline", () => {
  assert.equal(screenshotSyncLabel("offline"), "Last synced");
  assert.equal(screenshotSyncLabel("online"), "Synced");
});
