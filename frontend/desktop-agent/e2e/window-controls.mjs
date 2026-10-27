import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.KHALIDUO_TEST_OUTPUT || path.join(desktop, '.tmp/window-controls');
const profile = path.join(output, `profile-${Date.now()}`);
const env = {
  SYSTEMROOT: process.env.SYSTEMROOT, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP,
  APPDATA: path.join(profile, 'roaming'), LOCALAPPDATA: path.join(profile, 'local'), USERPROFILE: profile,
  KHALIDUO_E2E_USER_DATA_DIR: path.join(profile, 'userData'),
  VITE_API_BASE_URL: 'http://127.0.0.1:59998/api/v1', KHALIDUO_UPDATE_URL: 'http://127.0.0.1:59999',
  UPDATE_CHECK_INTERVAL_MINUTES: '1440', LOG_LEVEL: 'info',
};
for (const directory of [output, profile, env.APPDATA, env.LOCALAPPDATA, env.KHALIDUO_E2E_USER_DATA_DIR]) fs.mkdirSync(directory, { recursive: true });
const app = await _electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60000 });
app.process().on('exit', (code, signal) => console.log('Native process exited:', { code, signal }));
const checks = [];
const pass = label => { checks.push(label); console.log('PASS:', label); };
const windowState = () => app.evaluate(({ BrowserWindow }) => {
  const window = BrowserWindow.getAllWindows()[0];
  return { minimized: window.isMinimized(), maximized: window.isMaximized(), minimizable: window.isMinimizable(), closable: window.isClosable(), visible: window.isVisible(), hideEvents: globalThis.windowTestHideEvents || 0 };
});
async function waitState(key, expected) {
  for (let i = 0; i < 100; i++) {
    if ((await windowState())[key] === expected) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.equal((await windowState())[key], expected, key);
}
const restore = () => app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.restore(); window.show(); window.focus(); });

let exited = false;
try {
  await app.evaluate(({ app }, trace) => {
    const fs = process.getBuiltinModule('fs');
    const quit = app.quit.bind(app);
    app.quit = () => { fs.appendFileSync(trace, `${new Date().toISOString()} ${new Error('app.quit').stack}\n`); quit(); };
  }, path.join(output, 'quit-trace.log'));
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Sign in to your account', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => { globalThis.windowTestHideEvents = 0; BrowserWindow.getAllWindows()[0].on('hide', () => globalThis.windowTestHideEvents++); });
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await waitState('minimized', true);
  assert.equal((await windowState()).hideEvents, 0);
  await restore();
  pass('First minimize minimizes the native window without hiding it to the tray');

  // Use the real renderer, IPC bridge and BrowserWindow. Only employee status
  // is synthetic; the isolated native process remains signed out of all APIs.
  const originalStatus = await page.evaluate(() => window.khaliduo.getAgentStatus());
  await app.evaluate(({ ipcMain }, originalStatus) => {
    ipcMain.removeHandler('agent:get-status');
    ipcMain.handle('agent:get-status', () => ({ ...originalStatus, enrolled: true, employeeName: 'Window Test', deviceId: 'window-test', appearanceScope: null, trackingStatus: 'active', trackingPaused: false, sessionStartedAt: new Date().toISOString(), lastIdleAlert: null }));
  }, originalStatus);
  await page.locator('.tracker-frame').waitFor();
  const prompt = async id => {
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0].webContents.send('agent:idle-alert', { id, kind: 'idle_started', lostSeconds: 300, eligibleLostSeconds: 300, outsideScheduledShift: false, endedAt: new Date().toISOString() }), id);
    await page.getByRole('heading', { name: 'Are you still working?', exact: true }).waitFor();
    await page.locator('.native-modal-window-controls').waitFor();
  };
  await prompt('idle-window-test');
  assert.equal((await windowState()).minimizable, true);
  assert.equal((await windowState()).closable, true);
  await page.screenshot({ path: path.join(output, 'idle-controls-full.png'), omitBackground: true });
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await waitState('minimized', true);
  await restore();
  await page.getByRole('button', { name: 'Maximize or restore', exact: true }).click();
  await waitState('maximized', true);
  await page.getByRole('button', { name: 'Maximize or restore', exact: true }).click();
  await waitState('maximized', false);
  pass('Idle modal keeps actual minimize, maximize and restore controls clickable');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(520, 400));
  await page.screenshot({ path: path.join(output, 'idle-controls-compact.png'), omitBackground: true });
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await waitState('minimized', true);
  await restore();
  await page.getByRole('button', { name: 'Stop tracking', exact: true }).click();
  await page.locator('.swal2-container').waitFor({ state: 'detached' });
  pass('Compact modal allows minimize and keeps its decision available after restore');

  await page.evaluate(() => localStorage.setItem('khaliduo-theme', 'light'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tracker-frame[data-theme="light"]').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 840));
  await prompt('light-window-test');
  await page.screenshot({ path: path.join(output, 'idle-controls-light.png'), omitBackground: true });
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await waitState('minimized', true);
  await restore();
  await page.getByRole('button', { name: 'Stop tracking', exact: true }).click();
  await page.locator('.swal2-container').waitFor({ state: 'detached' });
  pass('Light theme keeps the same usable native controls over its idle modal');

  const soakSeconds = Number(process.env.KHALIDUO_WINDOW_SOAK_SECONDS || 90);
  const ipcTimes = [];
  await prompt('background-window-test');
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await waitState('minimized', true);
  for (let elapsed = 0; elapsed < soakSeconds; elapsed += 15) {
    await new Promise(resolve => setTimeout(resolve, Math.min(15, soakSeconds - elapsed) * 1000));
    const start = performance.now();
    await page.evaluate(() => window.khaliduo.getAgentStatus());
    ipcTimes.push(Math.round(performance.now() - start));
    const state = await windowState();
    assert.equal(state.minimizable, true);
    assert.equal(state.closable, true);
  }
  assert.equal((await windowState()).hideEvents, 0);
  pass(`Native IPC responds after ${soakSeconds}s of background polling with an idle prompt pending`);
  await restore();
  assert.equal((await windowState()).closable, true);
  const closing = app.waitForEvent('close');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await closing;
  exited = true;
  pass('Close exits the isolated native process even with an idle modal pending');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ scope: 'Built Electron app, real native window and IPC, synthetic employee status, isolated profile and no production API', checks, javascript_errors: errors, soak_seconds: soakSeconds, status_ipc_ms: ipcTimes }, null, 2));
} finally {
  if (!exited) await app.close();
}
