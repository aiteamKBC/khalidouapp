// Behavior test for Bug 9: a screenshot captured during local-only tracking must
// acquire its recovered server session on replay — resolved from the durable
// local→server mapping, never from whichever session is current at upload time.
import assert from "node:assert/strict";
import test, { after } from "node:test";

import {
  databaseContext,
  functions,
  moduleSource,
  cleanupTemporaryDirectories,
} from "./support/mainHarness.ts";

after(cleanupTemporaryDirectories);

function screenshotDependencies(c: Record<string, unknown>) {
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 20, height: 20 }),
    toJPEG: () => Buffer.from("fake-jpeg"),
  };
  Object.assign(c, {
    screenshotCaptureGeneration: 0,
    trackingConfig: { screenshot_enabled: true, capture_during_idle: false },
    onAcPower: true,
    foregroundActivitySegment: null,
    observedIdleSeconds: () => 0,
    readForegroundActivity: async () => null,
    isWhatsAppScreenshotActivity: () => false,
    screen: { getAllDisplays: () => [{ id: 1, size: { width: 20, height: 20 } }] },
    desktopCapturer: {
      getSources: async () => [
        { name: "Screen", display_id: "1", thumbnail: image },
      ],
    },
    getPendingScreenshotDirectory: () =>
      (c as { testDirectory: string }).testDirectory,
    reportScreenshotSkip: async () => {},
    showScreenshotCapturedNotification: () => {},
    uploadScreenshot: async () => {},
    completeScreenshot: async () => {},
    sendQueuedRequest: async () => {},
    apiResponseStatus: (e: { status?: number }) => e?.status,
    apiErrorCode: (e: { code?: string }) => e?.code,
    rebuildTrayMenu: () => {},
  });
  moduleSource(c as never, "electron/services/runtimePolicies.ts");
  moduleSource(c as never, "electron/services/screenshotCaptureGuard.ts");
  moduleSource(c as never, "electron/services/pendingSyncPolicy.ts");
  functions(
    c as never,
    "removeOwnedScreenshotFile",
    "cleanupTerminalScreenshotFiles",
    "screenshotCaptureBlockReason",
    "captureAndUploadScreenshot",
    "syncPendingQueuesOnce",
  );
}

type Ctx = Record<string, unknown> & {
  captureAndUploadScreenshot: () => Promise<void>;
  syncPendingQueuesOnce: (force: boolean) => Promise<void>;
  createLocalTrackingSession: (o: Record<string, unknown>) => void;
  markLocalTrackingSessionSynced: (
    id: string,
    at: string | undefined,
    serverId: string,
  ) => void;
  initiateScreenshot: (m: { sessionId?: string | null }) => Promise<void>;
  currentSessionId: string | null;
  localTrackingSessionId: string | null;
};

test("an offline screenshot replays against its recovered server session", async () => {
  const c = (await databaseContext()) as unknown as Ctx;
  screenshotDependencies(c as never);
  // Establish the durable local→server mapping the promotion would write.
  c.createLocalTrackingSession({
    sessionId: "local",
    deviceId: "device",
    startedAt: "2026-09-10T10:00:00Z",
    status: "active",
  });
  c.markLocalTrackingSessionSynced("local", undefined, "recovered-server-session");

  // Capture while local-only; the initiate fails (offline) so it queues.
  c.currentSessionId = null;
  c.localTrackingSessionId = "local";
  c.initiateScreenshot = async () => {
    throw new Error("offline");
  };
  await c.captureAndUploadScreenshot();

  // Now online on a DIFFERENT current session; replay must not use it.
  c.currentSessionId = "some-other-current-session";
  c.localTrackingSessionId = null;
  let replayed: { sessionId?: string | null } | undefined;
  c.initiateScreenshot = async (metadata) => {
    replayed = metadata;
  };
  await c.syncPendingQueuesOnce(true);

  assert.equal(
    replayed?.sessionId,
    "recovered-server-session",
    "the screenshot must attach to its recovered session, not the current one",
  );
});

test("an offline screenshot is deferred (not uploaded sessionless) until promotion", async () => {
  const c = (await databaseContext()) as unknown as Ctx;
  screenshotDependencies(c as never);
  // No mapping exists for 'local' yet.
  c.currentSessionId = null;
  c.localTrackingSessionId = "local";
  c.initiateScreenshot = async () => {
    throw new Error("offline");
  };
  await c.captureAndUploadScreenshot();

  c.currentSessionId = "current-session";
  c.localTrackingSessionId = null;
  let replayed: { sessionId?: string | null } | undefined;
  c.initiateScreenshot = async (metadata) => {
    replayed = metadata;
  };
  await c.syncPendingQueuesOnce(true);

  assert.equal(
    replayed,
    undefined,
    "an unresolved offline screenshot must not upload against the current session",
  );
});
