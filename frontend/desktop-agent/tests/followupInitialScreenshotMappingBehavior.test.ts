// Follow-up finding 4: the initial (direct) screenshot upload must use the durable
// local->server session mapping, exactly like queued replay. When a capture
// belongs to a local (offline) session, it must upload against the resolved
// server session, or — if the session is not promoted yet — be deferred to the
// queue rather than uploaded sessionless (which would permanently lose its
// association). A capture with no local session at all stays a legitimate
// sessionless enrolled-device policy capture. Drives the real captureAndUploadScreenshot.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { context, functions, moduleSource } from "./support/mainHarness.ts";

const image = {
  isEmpty: () => false,
  getSize: () => ({ width: 20, height: 20 }),
  toJPEG: () => Buffer.from("fake-jpeg"),
};

function captureContext(overrides: Record<string, unknown> = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "khaliduo-cap-"));
  const uploads: Array<{ sessionId: string | null | undefined }> = [];
  let enqueued:
    | { metadata: { sessionId?: string | null; localSessionId?: string | null } }
    | null = null;
  const c = context({
    trackingConfig: { screenshot_enabled: true, capture_during_idle: false },
    foregroundActivitySegment: null,
    observedIdleSeconds: () => 0,
    readForegroundActivity: async () => null,
    isWhatsAppScreenshotActivity: () => false,
    screen: {
      getAllDisplays: () => [{ id: 1, size: { width: 20, height: 20 } }],
    },
    desktopCapturer: {
      getSources: async () => [
        { name: "Screen", display_id: "1", thumbnail: image },
      ],
    },
    getPendingScreenshotDirectory: () => tempDir,
    enqueuePendingScreenshot: (o: {
      metadata: { sessionId?: string | null; localSessionId?: string | null };
    }) => {
      enqueued = o;
    },
    initiateScreenshot: async (metadata: { sessionId?: string | null }) => {
      uploads.push({ sessionId: metadata.sessionId });
    },
    uploadScreenshot: async () => {},
    completeScreenshot: async () => {},
    showScreenshotCapturedNotification: () => {},
    cleanupTerminalScreenshotFiles: () => {},
    ...overrides,
  });
  moduleSource(c, "electron/services/runtimePolicies.ts");
  moduleSource(c, "electron/services/screenshotCaptureGuard.ts");
  functions(c, "screenshotCaptureBlockReason", "captureAndUploadScreenshot");
  return {
    run: () =>
      (c as Record<string, unknown> & {
        captureAndUploadScreenshot: () => Promise<void>;
      }).captureAndUploadScreenshot(),
    uploads,
    enqueued: () => enqueued,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

test("an unpromoted local-session capture is deferred, never uploaded sessionless", async () => {
  const cap = captureContext({
    currentSessionId: null,
    localTrackingSessionId: "local-A",
    getServerSessionIdForLocalSession: () => null,
  });
  try {
    await cap.run();
    assert.equal(cap.uploads.length, 0, "no sessionless upload is attempted");
    const enqueued = cap.enqueued();
    assert.ok(enqueued, "the capture is deferred to the durable queue");
    assert.equal(enqueued!.metadata.sessionId, null);
    assert.equal(
      enqueued!.metadata.localSessionId,
      "local-A",
      "the local session id is retained so replay can resolve it",
    );
  } finally {
    cap.cleanup();
  }
});

test("a promoted local-session capture uploads against the resolved server session", async () => {
  const cap = captureContext({
    currentSessionId: null,
    localTrackingSessionId: "local-A",
    getServerSessionIdForLocalSession: () => "server-A",
  });
  try {
    await cap.run();
    assert.equal(cap.uploads.length, 1);
    assert.equal(
      cap.uploads[0].sessionId,
      "server-A",
      "the image keeps its original session association",
    );
    assert.equal(cap.enqueued(), null, "a resolved capture uploads directly");
  } finally {
    cap.cleanup();
  }
});

test("a capture with no local session remains a legitimate sessionless upload", async () => {
  const cap = captureContext({
    currentSessionId: null,
    localTrackingSessionId: null,
    getServerSessionIdForLocalSession: () => null,
  });
  try {
    await cap.run();
    assert.equal(cap.uploads.length, 1);
    assert.equal(
      cap.uploads[0].sessionId,
      null,
      "enrolled-device policy captures may still be sessionless",
    );
  } finally {
    cap.cleanup();
  }
});
