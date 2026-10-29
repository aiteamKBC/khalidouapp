import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { _electron } from 'playwright-core';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(desktop, '.tmp', `quote-native-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(desktop, 'src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let fallback;
for (const statement of source.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
  if (declaration.name.getText(source) === 'fallbackStatus') fallback = declaration.initializer.getText(source);
}
assert.ok(fallback, 'The renderer status fixture exists');
const status = { ...Function(`return (${fallback})`)(), enrolled: true, employeeName: 'Quote test', deviceId: 'quote-native-test', trackingStatus: 'paused', trackingPaused: true, connectionStatus: 'offline' };
const harness = path.join(output, 'harness.mjs');
fs.writeFileSync(harness, `
import electron from 'electron/main';
import { pathToFileURL } from 'node:url';
const { app, BrowserWindow, ipcMain, screen } = electron;
app.setPath('userData', ${JSON.stringify(path.join(output, 'profile'))});
app.whenReady().then(async () => {
const { QuoteReminderWindow } = await import(pathToFileURL(${JSON.stringify(path.join(desktop, 'dist-electron-khaliduo/services/quoteReminderWindow.js'))}).href);
const status = ${JSON.stringify(status)};
const index = ${JSON.stringify(path.join(desktop, 'dist-khaliduo/index.html'))};
const preload = ${JSON.stringify(path.join(desktop, 'dist-electron-khaliduo/preload.js'))};
const main = new BrowserWindow({ width: 1040, height: 840, show: false, webPreferences: { preload, sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
let calls = 0;
let controller;
const errors = [];
controller = new QuoteReminderWindow({
  preload,
  createWindow: options => new BrowserWindow(options),
  getWorkArea: () => screen.getDisplayMatching(main.getBounds()).workArea,
  loadWindow: window => window.loadFile(index, { query: { window: 'quote' } }),
});
ipcMain.handle('agent:get-status', () => status);
ipcMain.handle('agent:get-recent-screenshots', () => ({ success: true, screenshots: [] }));
ipcMain.handle('window:is-expanded', () => false);
ipcMain.handle('quote:show', async (event, payload) => {
  if (event.sender !== main.webContents) throw new Error('Unexpected quote sender');
  calls++;
  try { await controller.show(payload); }
  catch (error) { errors.push(error.stack ?? String(error)); throw error; }
});
ipcMain.handle('quote:get', event => controller.getPayload(event.sender));
ipcMain.handle('quote:dismiss', event => {
  if (event.sender === main.webContents || controller.owns(event.sender)) controller.dismiss();
});
ipcMain.on('quote:resize', (event, height) => controller.resize(event.sender, height));
globalThis.quoteTest = { main, controller, status, errors, get calls() { return calls; } };
await main.loadFile(index);
app.on('before-quit', () => controller.dispose());
}).catch(error => { console.error(error); app.exit(1); });
`);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ args: [harness], cwd: desktop, env, timeout: 30000 });
try {
  const page = await app.firstWindow();
  await page.locator('.tracker-frame').waitFor();
  const key = 'khaliduo:quote-reminders:v1:quote-native-test';
  const schedule = () => page.evaluate(key => {
    const old = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...old, enabled: true, minutes: 1, language: 'both', nextAt: Date.now() - 1000, sequence: old?.sequence ?? 0 }));
  }, key);
  const waitVisible = async visible => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const value = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => globalThis.quoteTest.controller.owns(window.webContents) && window.isVisible()));
      if (value === visible) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Quote visible state did not become ${visible}`);
  };
  const quoteWindow = app.waitForEvent('window', { timeout: 15000 });
  await schedule();
  const quote = await quoteWindow;
  await quote.getByRole('status', { name: 'Quote reminder' }).waitFor();
  await waitVisible(true);
  const native = await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find(window => globalThis.quoteTest.controller.owns(window.webContents));
    const area = screen.getDisplayMatching(globalThis.quoteTest.main.getBounds()).workArea;
    const bounds = window.getBounds();
    return { independent: !window.getParentWindow(), alwaysOnTop: window.isAlwaysOnTop(), rightGap: area.x + area.width - bounds.x - bounds.width, bottomGap: area.y + area.height - bounds.y - bounds.height, mainVisible: globalThis.quoteTest.main.isVisible() };
  });
  assert.equal(native.independent, true);
  assert.equal(native.alwaysOnTop, true);
  assert.equal(native.rightGap, 16);
  assert.equal(native.bottomGap, 16);
  assert.equal(native.mainVisible, false);
  console.log('PASS: real quote window appears at the screen bottom right while the main app is hidden');
  assert.equal(await quote.locator('.native-quote-reminder p').getAttribute('lang'), 'ar');
  assert.equal(await quote.locator('.native-quote-author').innerText(), 'ألبرت أينشتاين');
  await quote.getByRole('button', { name: 'Translate quote', exact: true }).click();
  assert.equal(await quote.locator('.native-quote-reminder p').getAttribute('lang'), 'en');
  assert.equal(await quote.locator('.native-quote-author').innerText(), 'Albert Einstein');
  await quote.getByRole('button', { name: 'Translate quote', exact: true }).click();
  assert.equal(await quote.locator('.native-quote-reminder p').getAttribute('lang'), 'ar');
  assert.equal(await quote.locator('.native-quote-author').innerText(), 'ألبرت أينشتاين');
  await quote.evaluate(() => document.fonts.ready);
  await quote.screenshot({ path: path.join(output, 'native-quote.png'), omitBackground: true });
  await quote.getByRole('button', { name: 'Dismiss quote', exact: true }).click();
  await waitVisible(false);
  console.log('PASS: native IPC, Arabic and English translation, and dismiss action');
  await app.evaluate(() => { globalThis.quoteTest.main.showInactive(); globalThis.quoteTest.main.minimize(); });
  await schedule();
  await waitVisible(true);
  assert.equal(await app.evaluate(() => globalThis.quoteTest.main.isMinimized()), true);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
  console.log('PASS: reminder appears while minimized and reuses the existing quote window');
  await waitVisible(false);
  console.log('PASS: real native window automatically hides after 20 seconds');
  const calls = await app.evaluate(() => globalThis.quoteTest.calls);
  await page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...saved, enabled: false, nextAt: 0 }));
  }, key);
  await new Promise(resolve => setTimeout(resolve, 2200));
  assert.equal(await app.evaluate(() => globalThis.quoteTest.calls), calls);
  assert.deepEqual(await app.evaluate(() => globalThis.quoteTest.errors), []);
  console.log('PASS: opt-out prevents reminders and native delivery reported no errors');
  console.log('Evidence: ' + output);
} finally {
  await app.close();
}
