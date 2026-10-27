import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { _electron } from 'playwright-core';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(desktop, '.tmp', `close-dialog-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const mainSource = fs.readFileSync(path.join(desktop, 'electron/main.ts'), 'utf8');
const mainAst = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
const functions = ['isMainWindowExpanded', 'clearWindowClosePrompt', 'handleWindowCloseChoice', 'createMainWindow', 'showMainWindow'];
const selected = mainAst.statements.filter(node => (ts.isFunctionDeclaration(node) && functions.includes(node.name?.text)) || /^ipcMain\.handle\("window:(?:get-close-request|respond-close|close|is-expanded|minimize|toggle-maximize)"/.test(node.getText(mainAst)));
const implementation = ts.transpileModule(selected.map(node => node.getText(mainAst)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const appSource = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(desktop, 'src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let fallback;
for (const statement of appSource.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (declaration.name.getText(appSource) === 'fallbackStatus') fallback = declaration.initializer.getText(appSource);
const status = { ...Function(`return (${fallback})`)(), enrolled: true, employeeName: 'Close dialog test', deviceId: 'close-dialog-test', trackingStatus: 'paused', trackingPaused: true, connectionStatus: 'offline' };
const harness = path.join(output, 'harness.mjs');
fs.writeFileSync(harness, `
import electron from 'electron/main';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const { app, BrowserWindow, ipcMain, screen } = electron;
app.setPath('userData', ${JSON.stringify(path.join(output, 'profile'))});
const __dirname = ${JSON.stringify(path.join(desktop, 'dist-electron-khaliduo'))};
let mainWindow = null, windowCloseRequest = null, isHandlingWindowClose = false;
let isQuitting = false, isSigningOut = false, enrollmentGeneration = 0;
let trackingPausedByUser = true, unpaidPauseActive = false, idleAttentionTimer = null;
const idleAlertAttentionActive = false, updateAttentionActive = false;
const runtimeStatus = ${JSON.stringify(status)};
const calls = [], errors = [];
const log = { error: (...values) => errors.push(values) };
const safeErrorForLog = error => String(error);
const getAppIconPath = () => undefined;
const hasTrackingSession = () => true;
const rebuildTrayMenu = () => {};
const actualQuit = app.quit.bind(app);
app.quit = () => { calls.push('quit'); };
let failResume = false;
async function resumeTracking() {
  calls.push('resume');
  if (failResume) return { success: false, message: 'Could not resume. Please try again.' };
  trackingPausedByUser = false;
  runtimeStatus.trackingPaused = false;
  runtimeStatus.trackingStatus = 'active';
  return { success: true };
}
async function pauseTracking() {
  calls.push('pause');
  trackingPausedByUser = true;
  runtimeStatus.trackingPaused = true;
  runtimeStatus.trackingStatus = 'paused';
  return { success: true };
}
${implementation}
ipcMain.handle('agent:get-status', () => runtimeStatus);
ipcMain.handle('agent:get-recent-screenshots', () => ({ success: true, screenshots: [] }));
ipcMain.handle('quote:dismiss', () => {});
globalThis.closeTest = {
  calls, errors, getWindow: () => mainWindow, getRequest: () => windowCloseRequest,
  show: () => showMainWindow(), setFailResume: value => { failResume = value; },
  cleanup: () => { isQuitting = true; clearTimeout(idleAttentionTimer); app.quit = actualQuit; },
};
app.whenReady().then(async () => { await createMainWindow(); showMainWindow(); }).catch(error => { console.error(error); app.exit(1); });
`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const app = await _electron.launch({ args: [harness], cwd: desktop, env, timeout: 30000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.tracker-frame').waitFor();
  await page.evaluate(() => localStorage.setItem('khaliduo-theme', 'dark'));
  await page.reload();
  await page.locator('.tracker-frame').waitFor();
  const dialog = page.getByRole('dialog', { name: 'Close Khaliduo?', exact: true });
  const open = async () => { await app.evaluate(() => globalThis.closeTest.getWindow().close()); await dialog.waitFor(); };
  const show = () => app.evaluate(() => globalThis.closeTest.show());
  const visible = () => app.evaluate(() => globalThis.closeTest.getWindow().isVisible());
  const choose = name => dialog.getByRole('button', { name, exact: false }).click();
  await open();
  assert.equal(await dialog.getByRole('button', { name: /Hide \(Keep Paused\)/ }).evaluate(element => element === document.activeElement), true);
  const id = await app.evaluate(() => globalThis.closeTest.getRequest().id);
  await open();
  assert.equal(await app.evaluate(() => globalThis.closeTest.getRequest().id), id);
  assert.equal(await dialog.count(), 1);
  await page.reload();
  await dialog.waitFor();
  assert.equal(await app.evaluate(() => globalThis.closeTest.getRequest().id), id);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, 'dark-paused.png') });
  await dialog.getByRole('button', { name: 'Keep app open', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await visible(), true);
  console.log('PASS: native close opens one themed dialog; pending request survives renderer reload; focus trap and Escape keep the app open');
  await open();
  await choose('Hide (Keep Paused)');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await visible(), false);
  assert.deepEqual(await app.evaluate(() => globalThis.closeTest.calls), []);
  await show();
  await open();
  await app.evaluate(() => globalThis.closeTest.setFailResume(true));
  await choose('Resume Tracking & Hide');
  await dialog.getByRole('alert').waitFor();
  assert.equal(await visible(), true);
  await app.evaluate(() => globalThis.closeTest.setFailResume(false));
  await choose('Resume Tracking & Hide');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await visible(), false);
  assert.deepEqual(await app.evaluate(() => globalThis.closeTest.calls), ['resume', 'resume']);
  await show();
  await open();
  await page.screenshot({ path: path.join(output, 'dark-running.png') });
  await choose('Pause & Hide');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await visible(), false);
  assert.deepEqual(await app.evaluate(() => globalThis.closeTest.calls), ['resume', 'resume', 'pause']);
  console.log('PASS: real IPC preserves Hide state, keeps failed Resume visible for retry, then resumes/pauses before hiding');
  await show();
  await page.getByLabel('Appearance', { exact: true }).click();
  await page.getByRole('button', { name: 'Orbit Light', exact: true }).click();
  await page.locator('.tracker-frame').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await open();
  await page.screenshot({ path: path.join(output, 'light-paused.png') });
  const colors = await dialog.evaluate(element => ({ card: getComputedStyle(element).backgroundColor, ink: getComputedStyle(element).color, variable: getComputedStyle(element).getPropertyValue('--k-card').trim() }));
  assert.equal(colors.card, 'rgb(255, 255, 255)');
  for (const size of [{ width: 460, height: 720 }, { width: 520, height: 400 }, { width: 460, height: 360 }]) {
    await app.evaluate((_, size) => globalThis.closeTest.getWindow().setSize(size.width, size.height), size);
    const bounds = await dialog.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
    assert.ok(bounds.y >= 69 && bounds.y + bounds.height <= viewport.height + 1);
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    assert.equal(await cancel.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }), true);
  }
  await page.screenshot({ path: path.join(output, 'compact-light.png') });
  await choose('Quit Khaliduo');
  assert.equal(await app.evaluate(() => globalThis.closeTest.calls.filter(value => value === 'quit').length), 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(await app.evaluate(() => globalThis.closeTest.errors), []);
  console.log('PASS: selected light theme, compact windows down to 460×360, visible Cancel, and one explicit Quit action');
  console.log('Evidence: ' + output);
} finally {
  await app.evaluate(() => globalThis.closeTest.cleanup()).catch(() => {});
  await app.close();
}
