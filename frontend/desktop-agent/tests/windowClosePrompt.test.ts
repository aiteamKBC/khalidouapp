import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { context, evaluate, functions } from "./support/mainHarness.ts";

function fixture(paused = false) {
  const calls: string[] = [];
  const sent: unknown[] = [];
  const mainWindow = {
    isDestroyed: () => false,
    hide: () => calls.push("hide"),
    webContents: { isDestroyed: () => false, send: (_channel: string, payload: unknown) => sent.push(payload) },
  };
  const c = context({ mainWindow, windowCloseRequest: { id: "request-A", paused }, isHandlingWindowClose: false,
    app: { quit: () => calls.push("quit") },
    resumeTracking: async () => { calls.push("resume"); return { success: true }; },
    pauseTracking: async () => { calls.push("pause"); return { success: true }; },
    safeErrorForLog: (error: unknown) => String(error),
  });
  functions(c, "clearWindowClosePrompt", "handleWindowCloseChoice");
  const choose = (choice: unknown, id: unknown = "request-A") => c.handleWindowCloseChoice(id, choice) as Promise<{ success: boolean; message?: string }>;
  return { c, calls, sent, choose, mainWindow };
}

test("Hide preserves the current tracking state; Quit invokes the existing quit path", async () => {
  for (const paused of [true, false]) {
    const f = fixture(paused);
    assert.equal((await f.choose("hide")).success, true);
    assert.deepEqual(f.calls, ["hide"]);
    assert.equal(f.c.windowCloseRequest, null);
    assert.deepEqual(f.sent, [null]);
  }
  const f = fixture();
  assert.equal((await f.choose("quit")).success, true);
  assert.deepEqual(f.calls, ["quit"]);
});

test("the alternate close action resumes a paused timer or pauses a running timer before hiding", async () => {
  for (const paused of [true, false]) {
    const f = fixture(paused);
    assert.equal((await f.choose("toggle")).success, true);
    assert.deepEqual(f.calls, [paused ? "resume" : "pause", "hide"]);
  }
});

test("Cancel, invalid actions and stale requests cannot pause, resume, hide or quit", async () => {
  const f = fixture();
  for (const [choice, id] of [["quit", "old-request"], ["unexpected", "request-A"], [null, "request-A"]]) {
    assert.equal((await f.choose(choice, id)).success, false);
  }
  assert.deepEqual(f.calls, []);
  assert.equal((await f.choose("cancel")).success, true);
  assert.equal(f.c.windowCloseRequest, null);
  assert.equal((await f.choose("quit")).success, false);
  assert.deepEqual(f.calls, []);
});

test("a failed tracking action keeps the close dialog open for a retry", async () => {
  const f = fixture(true);
  f.c.resumeTracking = async () => ({ success: false, message: "Could not resume" });
  const result = await f.choose("toggle");
  assert.equal(result.success, false);
  assert.equal(result.message, "Could not resume");
  assert.equal(f.c.windowCloseRequest.id, "request-A");
  assert.equal(f.c.isHandlingWindowClose, false);
  assert.deepEqual(f.calls, []);
  f.c.resumeTracking = async () => { throw new Error("IPC failed"); };
  assert.equal((await f.choose("toggle")).success, false);
  assert.equal(f.c.isHandlingWindowClose, false);
  assert.deepEqual(f.calls, []);
});

test("duplicate clicks are serialized and sign-out during Resume prevents a stale hide", async () => {
  const f = fixture(true);
  let finish!: (value: { success: boolean }) => void;
  f.c.resumeTracking = () => new Promise(resolve => { finish = resolve; });
  const first = f.choose("toggle");
  assert.equal((await f.choose("quit")).success, false);
  f.c.enrollmentGeneration++;
  f.c.isSigningOut = true;
  f.c.clearWindowClosePrompt();
  finish({ success: true });
  assert.equal((await first).success, false);
  assert.deepEqual(f.calls, []);
});

test("only the main renderer can read or answer a close request", async () => {
  const f = fixture();
  const handlers = new Map<string, (...args: any[]) => any>();
  f.c.ipcMain = { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) };
  const source = fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (/^ipcMain\.handle\("window:(?:get-close-request|respond-close|close)"/.test(statement.getText(ast))) evaluate(f.c, statement.getText(ast));
  }
  assert.equal(handlers.size, 3);
  const other = { sender: {} };
  assert.equal(handlers.get("window:get-close-request")!(other), null);
  assert.equal((await handlers.get("window:respond-close")!(other, "request-A", "quit")).success, false);
  assert.equal(handlers.get("window:get-close-request")!({ sender: f.mainWindow.webContents }).id, "request-A");
  assert.deepEqual(f.calls, []);
});
