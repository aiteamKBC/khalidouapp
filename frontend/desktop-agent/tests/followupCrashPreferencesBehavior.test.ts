// Follow-up finding 1: a crash-recovery relaunch must preserve the employee's
// saved Pause/Stop. Previously the startup wiring passed the crash-recovery flag
// into loadTrackingPreferences, which reset BOTH persisted flags to false and
// saved them, so the recovery gate could never observe an explicit Stop and the
// watchdog silently resumed ended work. These behavior tests drive the real
// loadTrackingPreferences + loadLaunchTrackingPreferences (the extracted startup
// decision) with the real crashRecoveryShouldContinue helper.
import assert from "node:assert/strict";
import test from "node:test";
import {
  context,
  functions,
  moduleSource,
} from "./support/mainHarness.ts";

function launchContext(preferences: Record<string, unknown>) {
  let saved: { stop: boolean; pause: boolean } | null = null;
  const c = context({
    getTrackingPreferencesPath: () => "mock-only",
    fs: { readFileSync: () => JSON.stringify(preferences) },
    saveTrackingPreferences: () => {
      saved = {
        stop: (c as Record<string, unknown>).trackingPausedByUser as boolean,
        pause: (c as Record<string, unknown>).unpaidPauseActive as boolean,
      };
    },
  });
  functions(c, "loadTrackingPreferences", "loadLaunchTrackingPreferences");
  moduleSource(c, "electron/services/crashRecovery.ts");
  return {
    c: c as Record<string, unknown> & {
      loadLaunchTrackingPreferences: (o: {
        launchedByWindowsStartup: boolean;
        launchedForCrashRecovery: boolean;
      }) => boolean;
    },
    savedAfter: () => saved,
  };
}

test("crash recovery preserves a saved Stop and exits without recovering", () => {
  const { c, savedAfter } = launchContext({
    paused_by_user: true,
    unpaid_pause_active: true,
  });
  const hasWork = c.loadLaunchTrackingPreferences({
    launchedByWindowsStartup: false,
    launchedForCrashRecovery: true,
  });
  assert.equal(hasWork, false, "an explicit Stop must abort silent recovery");
  assert.equal(c.trackingPausedByUser, true, "saved Stop must be preserved");
  assert.equal(c.unpaidPauseActive, true, "saved Pause must be preserved");
  // Intent is never overwritten with a reset on a crash-recovery launch.
  assert.equal(savedAfter(), null, "crash recovery must not rewrite preferences");
});

test("crash recovery preserves a Pause-only session and keeps recovering", () => {
  const { c } = launchContext({
    paused_by_user: false,
    unpaid_pause_active: true,
  });
  const hasWork = c.loadLaunchTrackingPreferences({
    launchedByWindowsStartup: false,
    launchedForCrashRecovery: true,
  });
  // Not stopped, so recovery continues into normal startup...
  assert.equal(hasWork, true);
  // ...but the Pause is preserved so the auto-start gate (automaticTrackingIsExpected)
  // will not silently resume work.
  assert.equal(c.unpaidPauseActive, true, "saved Pause must survive recovery");
});

test("crash recovery of an active online session still recovers", () => {
  const { c } = launchContext({
    paused_by_user: false,
    unpaid_pause_active: false,
  });
  const hasWork = c.loadLaunchTrackingPreferences({
    launchedByWindowsStartup: false,
    launchedForCrashRecovery: true,
  });
  assert.equal(hasWork, true, "an active session must still recover");
  assert.equal(c.trackingPausedByUser, false);
});

test("a Windows-login launch intentionally resets a saved pause", () => {
  const { c, savedAfter } = launchContext({
    paused_by_user: true,
    unpaid_pause_active: true,
  });
  const hasWork = c.loadLaunchTrackingPreferences({
    launchedByWindowsStartup: true,
    launchedForCrashRecovery: false,
  });
  assert.equal(hasWork, true);
  assert.equal(c.trackingPausedByUser, false, "login resets Stop");
  assert.equal(c.unpaidPauseActive, false, "login resets Pause");
  assert.deepEqual(
    savedAfter(),
    { stop: false, pause: false },
    "the reset intent is persisted only on a login launch",
  );
});
