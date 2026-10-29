// Behavior tests for Bug 8: a Pause / lock / power change during the async
// capture pipeline must cancel the image. Runs the real captureAndUploadScreenshot
// and screenshotCaptureBlockReason extracted from main.ts.
import assert from "node:assert/strict";
import test from "node:test";

import {
  context,
  functions,
  moduleSource,
} from "./support/mainHarness.ts";

type Ctx = Record<string, unknown> & {
  captureAndUploadScreenshot: () => Promise<void>;
  runtimeStatus: Record<string, unknown>;
};

function screenshotContext(overrides: Record<string, unknown> = {}) {
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 20, height: 20 }),
    toJPEG: () => Buffer.from("fake-jpeg"),
  };
  let captures = 0;
  let uploads = 0;
  const c = context({
    screenshotCaptureGeneration: 0,
    trackingConfig: { screenshot_enabled: true, capture_during_idle: false },
    onAcPower: true,
    foregroundActivitySegment: null,
    observedIdleSeconds: () => 0,
    readForegroundActivity: async () => null,
    isWhatsAppScreenshotActivity: () => false,
    screen: { getAllDisplays: () => [{ id: 1, size: { width: 20, height: 20 } }] },
    desktopCapturer: {
      getSources: async () => {
        captures += 1;
        return [{ name: "Screen", display_id: "1", thumbnail: image }];
      },
    },
    getPendingScreenshotDirectory: () => ".",
    reportScreenshotSkip: async () => {},
    showScreenshotCapturedNotification: () => {},
    initiateScreenshot: async () => {},
    uploadScreenshot: async () => {
      uploads += 1;
    },
    completeScreenshot: async () => {},
    apiResponseStatus: (e: { status?: number }) => e?.status,
    apiErrorCode: (e: { code?: string }) => e?.code,
    ...overrides,
  });
  moduleSource(c, "electron/services/runtimePolicies.ts");
  moduleSource(c, "electron/services/screenshotCaptureGuard.ts");
  functions(c, "screenshotCaptureBlockReason", "captureAndUploadScreenshot");
  return {
    c: c as unknown as Ctx,
    counts: () => ({ captures, uploads }),
  };
}

test("Pause during foreground detection cancels the capture before acquiring the screen", async () => {
  let release!: (value: unknown) => void;
  const { c, counts } = screenshotContext({
    readForegroundActivity: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = c.captureAndUploadScreenshot();
  // Employee pauses while foreground detection is in flight.
  (c as Record<string, unknown>).unpaidPauseActive = true;
  c.runtimeStatus.trackingPaused = true;
  release(null);
  await pending;
  assert.deepEqual(
    counts(),
    { captures: 0, uploads: 0 },
    "no screen was acquired and nothing was uploaded after Pause",
  );
});

test("Pause during screen acquisition discards the pixels instead of uploading", async () => {
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 20, height: 20 }),
    toJPEG: () => Buffer.from("fake-jpeg"),
  };
  let acquisitionStarted!: () => void;
  const acquisitionReached = new Promise<void>((resolve) => {
    acquisitionStarted = resolve;
  });
  let releaseSources!: () => void;
  const { c, counts } = screenshotContext({
    desktopCapturer: {
      getSources: () =>
        new Promise((resolve) => {
          acquisitionStarted();
          releaseSources = () =>
            resolve([{ name: "Screen", display_id: "1", thumbnail: image }]);
        }),
    },
  });
  const pending = c.captureAndUploadScreenshot();
  await acquisitionReached;
  // Employee pauses while the screen image is being acquired.
  (c as Record<string, unknown>).unpaidPauseActive = true;
  c.runtimeStatus.trackingPaused = true;
  releaseSources();
  await pending;
  assert.equal(counts().uploads, 0, "acquired pixels must not upload after Pause");
});

test("a pause→resume cycle during acquisition still cancels via the generation token", async () => {
  let release!: (value: unknown) => void;
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 20, height: 20 }),
    toJPEG: () => Buffer.from("fake-jpeg"),
  };
  const { c, counts } = screenshotContext({
    readForegroundActivity: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = c.captureAndUploadScreenshot();
  // Pause then resume entirely within the await: block reason reads eligible
  // again, but the generation bump records that eligibility was lost.
  (c as Record<string, unknown>).screenshotCaptureGeneration = 1;
  release(null);
  await pending;
  void image;
  assert.deepEqual(
    counts(),
    { captures: 0, uploads: 0 },
    "the capture must cancel because the generation changed mid-flight",
  );
});

test("an eligible capture with no interruption uploads normally", async () => {
  const { c, counts } = screenshotContext();
  await c.captureAndUploadScreenshot();
  assert.deepEqual(counts(), { captures: 1, uploads: 1 });
});

test("one capture uploads both monitors with distinct images and the correct display identities", async () => {
  const metadata: Record<string, unknown>[] = [];
  const uploads: { id: string; content: string }[] = [];
  const completed: string[] = [];
  const { c } = screenshotContext({
    screen: { getAllDisplays: () => [
      { id: 10, size: { width: 1920, height: 1080 } },
      { id: 20, size: { width: 2560, height: 1440 } },
    ] },
    desktopCapturer: {
      getSources: async (options: { types: string[]; thumbnailSize: { width: number; height: number } }) => {
        assert.deepEqual(Array.from(options.types), ["screen"]);
        assert.equal(options.thumbnailSize.width, 2560);
        assert.equal(options.thumbnailSize.height, 1440);
        // Electron's source order can differ from screen.getAllDisplays().
        return [20, 10].map((id) => ({
          display_id: String(id), name: `Monitor ${id}`,
          thumbnail: {
            isEmpty: () => false,
            getSize: () => ({ width: id === 20 ? 2560 : 1920, height: id === 20 ? 1440 : 1080 }),
            toJPEG: () => Buffer.from(`monitor-${id}-jpeg`),
          },
        }));
      },
    },
    initiateScreenshot: async (value: Record<string, unknown>) => { metadata.push(value); },
    uploadScreenshot: async (id: string, content: Buffer) => { uploads.push({ id, content: content.toString() }); },
    completeScreenshot: async (value: { screenshotId: string }) => { completed.push(value.screenshotId); },
  });
  await c.captureAndUploadScreenshot();
  assert.equal(metadata.length, 2);
  assert.equal(new Set(metadata.map((shot) => shot.screenshotId)).size, 2);
  assert.equal(new Set(metadata.map((shot) => shot.capturedAt)).size, 1);
  assert.deepEqual(metadata.map((shot) => shot.displayId), ["20", "10"]);
  assert.deepEqual(metadata.map((shot) => shot.displayName), ["Monitor 20", "Monitor 10"]);
  assert.ok(metadata.every((shot) => shot.displayCount === 2 && shot.sessionId === "A"));
  assert.deepEqual(uploads.map((shot) => shot.content), ["monitor-20-jpeg", "monitor-10-jpeg"]);
  assert.deepEqual(uploads.map((shot) => shot.id), metadata.map((shot) => shot.screenshotId));
  assert.deepEqual(completed, uploads.map((shot) => shot.id));
});
