// Behavior tests for Bug 10: a permanently-rejected first upload must not leave
// an orphan JPEG on disk, and the terminal-cleanup must be restart-safe and
// restricted to owned files. Runs the real capture + cleanup from main.ts.
import assert from "node:assert/strict";
import fs from "node:fs";
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
    initiateScreenshot: async () => {},
    uploadScreenshot: async () => {},
    completeScreenshot: async () => {},
    apiResponseStatus: (e: { status?: number }) => e?.status,
    apiErrorCode: (e: { code?: string }) => e?.code,
  });
  moduleSource(c as never, "electron/services/runtimePolicies.ts");
  moduleSource(c as never, "electron/services/screenshotCaptureGuard.ts");
  // getPendingScreenshotDirectory is intentionally left as the context override
  // (returns testDirectory) so writes and the owned-path guard agree on one dir.
  functions(
    c as never,
    "removeOwnedScreenshotFile",
    "cleanupTerminalScreenshotFiles",
    "screenshotCaptureBlockReason",
    "captureAndUploadScreenshot",
  );
}

test("a permanently-rejected first upload leaves no orphan JPEG and no pending row", async () => {
  const c = (await databaseContext()) as unknown as Record<string, unknown> & {
    captureAndUploadScreenshot: () => Promise<void>;
    getDuePendingScreenshots: (
      limit: number,
      opts: { force: boolean },
    ) => unknown[];
    testDirectory: string;
  };
  screenshotDependencies(c);
  c.initiateScreenshot = async () => {
    throw Object.assign(new Error("company capture disabled"), { status: 403 });
  };

  await c.captureAndUploadScreenshot();

  assert.equal(
    c.getDuePendingScreenshots(10, { force: true }).length,
    0,
    "no retryable screenshot row should remain",
  );
  const images = fs
    .readdirSync(c.testDirectory)
    .filter((name) => name.endsWith(".jpg"));
  assert.equal(images.length, 0, "no orphan JPEG should remain on disk");
});

test("a transient failure keeps the image and a retryable row", async () => {
  const c = (await databaseContext()) as unknown as Record<string, unknown> & {
    captureAndUploadScreenshot: () => Promise<void>;
    getDuePendingScreenshots: (
      limit: number,
      opts: { force: boolean },
    ) => unknown[];
    testDirectory: string;
  };
  screenshotDependencies(c);
  c.initiateScreenshot = async () => {
    throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" });
  };

  await c.captureAndUploadScreenshot();

  assert.equal(
    c.getDuePendingScreenshots(10, { force: true }).length,
    1,
    "a transient failure must retain the row for retry",
  );
  const images = fs
    .readdirSync(c.testDirectory)
    .filter((name) => name.endsWith(".jpg"));
  assert.equal(images.length, 1, "the image is retained for retry");
});

test("terminal cleanup refuses to delete files outside the owned directory", async () => {
  const c = (await databaseContext()) as unknown as Record<string, unknown> & {
    removeOwnedScreenshotFile: (p: string) => void;
    testDirectory: string;
  };
  screenshotDependencies(c);
  const outside = `${c.testDirectory}-outside-secret.txt`;
  fs.writeFileSync(outside, "keep me");
  try {
    c.removeOwnedScreenshotFile(outside);
    assert.equal(
      fs.existsSync(outside),
      true,
      "a path outside the owned directory must never be deleted",
    );
  } finally {
    fs.rmSync(outside, { force: true });
  }
});
