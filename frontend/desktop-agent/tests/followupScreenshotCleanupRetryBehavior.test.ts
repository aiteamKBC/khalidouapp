// Follow-up finding 5: when Windows cannot delete a terminal JPEG (EPERM / file in
// use), the queue row must be RETAINED so a later pass — including after a restart
// — retries the deletion, instead of purging the row and orphaning the file. Only
// rows whose owned file was removed (or was never ours) are retired. Drives the
// real removeOwnedScreenshotFile + cleanupTerminalScreenshotFiles.
import assert from "node:assert/strict";
import test from "node:test";
import { context, functions } from "./support/mainHarness.ts";

function cleanupContext(overrides: Record<string, unknown> = {}) {
  const c = context(overrides);
  functions(c, "removeOwnedScreenshotFile", "cleanupTerminalScreenshotFiles");
  return c as Record<string, unknown> & {
    cleanupTerminalScreenshotFiles: () => void;
    removeOwnedScreenshotFile: (p: string) => string;
  };
}

test("a locked file keeps its row and is retried on the next pass, then succeeds", () => {
  let rows: Array<{ screenshotId: string; filePath: string }> = [
    { screenshotId: "s1", filePath: "E:\\owned-review\\image.jpg" },
  ];
  let deletionAttempts = 0;
  let locked = true;
  const c = cleanupContext({
    getPendingScreenshotDirectory: () => "E:\\owned-review",
    listTerminalPendingScreenshots: () => rows,
    purgeTerminalScreenshotRows: (ids: string[]) => {
      rows = rows.filter((r) => !ids.includes(r.screenshotId));
    },
    purgeTerminalPendingEvents: () => {},
    fs: {
      rmSync: () => {
        deletionAttempts += 1;
        if (locked) {
          throw Object.assign(new Error("file locked"), { code: "EPERM" });
        }
      },
    },
  });

  c.cleanupTerminalScreenshotFiles();
  assert.equal(rows.length, 1, "a row whose file could not be deleted is retained");
  assert.equal(deletionAttempts, 1);

  c.cleanupTerminalScreenshotFiles();
  assert.equal(rows.length, 1, "still retained while the file stays locked");
  assert.equal(deletionAttempts, 2, "the next pass retries the deletion");

  locked = false;
  c.cleanupTerminalScreenshotFiles();
  assert.equal(deletionAttempts, 3);
  assert.equal(rows.length, 0, "once the file is removed the row is retired");
});

test("a terminal row whose file is already gone is retired without error", () => {
  let rows: Array<{ screenshotId: string; filePath: string }> = [
    { screenshotId: "s2", filePath: "E:\\owned-review\\gone.jpg" },
  ];
  const c = cleanupContext({
    getPendingScreenshotDirectory: () => "E:\\owned-review",
    listTerminalPendingScreenshots: () => rows,
    purgeTerminalScreenshotRows: (ids: string[]) => {
      rows = rows.filter((r) => !ids.includes(r.screenshotId));
    },
    purgeTerminalPendingEvents: () => {},
    // force:true makes rmSync a no-op on a missing file.
    fs: { rmSync: () => {} },
  });
  c.cleanupTerminalScreenshotFiles();
  assert.equal(rows.length, 0);
});

test("an external path is never deleted and does not loop forever", () => {
  let rows: Array<{ screenshotId: string; filePath: string }> = [
    { screenshotId: "s3", filePath: "E:\\somewhere-else\\secret.jpg" },
  ];
  let deletionAttempts = 0;
  const c = cleanupContext({
    getPendingScreenshotDirectory: () => "E:\\owned-review",
    listTerminalPendingScreenshots: () => rows,
    purgeTerminalScreenshotRows: (ids: string[]) => {
      rows = rows.filter((r) => !ids.includes(r.screenshotId));
    },
    purgeTerminalPendingEvents: () => {},
    fs: {
      rmSync: () => {
        deletionAttempts += 1;
      },
    },
  });
  const outcome = c.removeOwnedScreenshotFile("E:\\somewhere-else\\secret.jpg");
  assert.equal(outcome, "refused", "a path outside the owned directory is refused");
  assert.equal(deletionAttempts, 0, "the external file is never touched");
  c.cleanupTerminalScreenshotFiles();
  assert.equal(deletionAttempts, 0, "still never deletes the unrelated file");
  assert.equal(rows.length, 0, "the row is retired so it cannot loop forever");
});
