import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { context, evaluate } from "./support/mainHarness.ts";

const source = ts.createSourceFile(
  "main.ts",
  fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const registration = source.statements.find((node) => {
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
  const call = node.expression;
  return ts.isPropertyAccessExpression(call.expression)
    && call.expression.getText(source) === "ipcMain.handle"
    && ts.isStringLiteral(call.arguments[0])
    && call.arguments[0].text === "agent:get-recent-screenshots";
});
assert.ok(registration, "the real recent-screenshots IPC handler must exist");

type Capture = { id: string; captured_at: string; display_name: string };
const captures: Capture[] = [
  { id: "screen-one", captured_at: "2026-10-29T10:00:00Z", display_name: "Screen 1" },
  { id: "screen-two", captured_at: "2026-10-29T10:00:00Z", display_name: "Screen 2" },
];

function recentScreenshots(options: { missingId?: string; failureStatus?: number } = {}) {
  let handler!: () => Promise<{
    success: boolean;
    screenshots: { id: string; capturedAt: string; displayName: string; dataUrl: string }[];
  }>;
  const downloads: string[] = [];
  const c = context({
    ipcMain: { handle: (_channel: string, callback: typeof handler) => { handler = callback; } },
    listAgentRecentScreenshots: async (limit: number) => {
      assert.equal(limit, 4);
      return captures;
    },
    downloadAgentScreenshot: async (id: string) => {
      downloads.push(id);
      const status = id === options.missingId ? 404 : options.failureStatus;
      if (status) throw Object.assign(new Error("Download failed"), { status });
      return { mimeType: "image/jpeg", content: Buffer.from(id) };
    },
    apiResponseStatus: (error: { status?: number }) => error.status,
    connectionStatusAfterApiFailure: () => "offline",
    getUserFacingError: (error: Error) => error.message,
  });
  evaluate(c, registration!.getText(source));
  return { handler, downloads };
}

test("recent screenshots return both monitors captured at the same instant", async () => {
  const { handler, downloads } = recentScreenshots();
  const result = await handler();
  assert.equal(result.success, true);
  assert.deepEqual(downloads, ["screen-one", "screen-two"]);
  assert.deepEqual(Array.from(result.screenshots, (shot) => ({
    id: shot.id, displayName: shot.displayName, capturedAt: shot.capturedAt,
    image: Buffer.from(shot.dataUrl.split(",")[1], "base64").toString(),
  })), captures.map((shot) => ({
    id: shot.id, displayName: shot.display_name, capturedAt: shot.captured_at, image: shot.id,
  })));
});

test("a missing monitor image does not hide the other monitor", async () => {
  const { handler, downloads } = recentScreenshots({ missingId: "screen-one" });
  const result = await handler();
  assert.equal(result.success, true);
  assert.deepEqual(downloads, ["screen-one", "screen-two"]);
  assert.deepEqual(Array.from(result.screenshots, (shot) => shot.id), ["screen-two"]);
});

test("download failures remain visible to the screenshot gallery", async () => {
  const { handler } = recentScreenshots({ failureStatus: 503 });
  const result = await handler();
  assert.equal(result.success, false);
  assert.equal(result.screenshots.length, 0);
});
