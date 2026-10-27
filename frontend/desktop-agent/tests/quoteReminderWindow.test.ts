import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { BrowserWindow, BrowserWindowConstructorOptions, WebContents } from "electron";
import { QuoteReminderWindow } from "../electron/services/quoteReminderWindow.ts";

const quote = { text: "Give one task your full attention.", colors: { "--k-card": "#fff" } };

function fixture(load = async () => {}) {
  const windows: FakeWindow[] = [];
  class FakeWindow extends EventEmitter {
    visible = false;
    destroyed = false;
    shown = 0;
    options: BrowserWindowConstructorOptions;
    bounds: { x: number; y: number; width: number; height: number };
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: () => {},
      send: (_channel: string, _payload: unknown) => {},
    });
    constructor(options: BrowserWindowConstructorOptions) {
      super();
      this.options = options;
      this.bounds = { x: options.x!, y: options.y!, width: options.width!, height: options.height! };
    }
    setMenuBarVisibility() {}
    isDestroyed() { return this.destroyed; }
    setBounds(bounds: typeof this.bounds) { this.bounds = bounds; }
    getBounds() { return this.bounds; }
    showInactive() { this.visible = true; this.shown++; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.emit("closed"); }
  }
  const controller = new QuoteReminderWindow({
    createWindow: options => {
      const window = new FakeWindow(options);
      windows.push(window);
      return window as unknown as BrowserWindow;
    },
    loadWindow: load,
    getWorkArea: () => ({ x: -1920, y: 100, width: 1920, height: 1040 }),
    preload: "/app/preload.js",
  });
  return { controller, windows, sender: () => windows[0].webContents as unknown as WebContents };
}

test("quotes appear at the display's bottom right above the taskbar without activating the app", async () => {
  const f = fixture();
  try {
    await f.controller.show(quote);
    const window = f.windows[0];
    assert.deepEqual(window.bounds, { x: -396, y: 924, width: 380, height: 200 });
    assert.equal(window.visible, true);
    assert.equal(window.shown, 1);
    assert.equal(window.options.alwaysOnTop, true);
    assert.equal(window.options.skipTaskbar, true);
    assert.equal(window.options.parent, undefined);
    assert.equal(window.options.webPreferences?.nodeIntegration, false);
  } finally { f.controller.dispose(); }
});

test("resizing to fit translated text preserves the bottom-right anchor and rejects other windows", async () => {
  const f = fixture();
  try {
    await f.controller.show(quote);
    f.controller.resize({} as WebContents, 300);
    assert.equal(f.windows[0].bounds.height, 200);
    assert.equal(f.controller.getPayload({} as WebContents), null);
    f.controller.resize(f.sender(), 260);
    assert.deepEqual(f.windows[0].bounds, { x: -396, y: 864, width: 380, height: 260 });
    f.controller.resize(f.sender(), Infinity);
    assert.equal(f.windows[0].bounds.height, 260);
    f.controller.resize(f.sender(), 10000);
    assert.equal(f.windows[0].bounds.height, 420);
  } finally { f.controller.dispose(); }
});

test("quotes disappear after 20 seconds and reuse a single window for the next reminder", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    await f.controller.show(quote);
    t.mock.timers.tick(19_999);
    assert.equal(f.windows[0].visible, true);
    t.mock.timers.tick(1);
    assert.equal(f.windows[0].visible, false);
    assert.equal(f.controller.getPayload(f.sender()), null);
    await f.controller.show({ ...quote, text: "Quiet progress is still progress." });
    assert.equal(f.windows.length, 1);
    assert.equal(f.windows[0].visible, true);
    f.controller.dismiss();
    assert.equal(f.windows[0].visible, false);
  } finally { f.controller.dispose(); }
});

test("turning reminders off or signing out during loading cannot reopen a stale quote", async () => {
  let finish!: () => void;
  const f = fixture(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = f.controller.show(quote);
  f.controller.dismiss();
  finish();
  await pending;
  assert.equal(f.windows[0].shown, 0);
  const again = f.controller.show(quote);
  f.controller.dispose();
  await again;
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.windows[0].shown, 0);
});

test("the latest reminder wins when two arrive before the window finishes loading", async () => {
  let finish!: () => void;
  const f = fixture(() => new Promise<void>(resolve => { finish = resolve; }));
  try {
    const first = f.controller.show(quote);
    const second = f.controller.show({ ...quote, text: "Quiet progress is still progress." });
    finish();
    await Promise.all([first, second]);
    assert.equal(f.windows.length, 1);
    assert.equal(f.windows[0].shown, 1);
    assert.equal(f.controller.getPayload(f.sender())?.text, "Quiet progress is still progress.");
  } finally { f.controller.dispose(); }
});
