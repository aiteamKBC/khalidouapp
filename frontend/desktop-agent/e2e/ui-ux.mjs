// UI-only regression check against the production renderer and a fake IPC bridge.
// Run after `npm run build`: node e2e/ui-ux.mjs [--electron]
// No backend, real account, local agent profile, or user data is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { chromium, _electron, expect } from '@playwright/test';

const desktop = path.resolve(import.meta.dirname, '..');
const output = path.join(desktop, '.tmp', 'ui-ux-qa');
fs.mkdirSync(output, { recursive: true });
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(desktop, 'src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initial;
for (const statement of source.statements) if (ts.isVariableStatement(statement)) {
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(source) === 'fallbackStatus') initial = declaration.initializer.getText(source);
  }
}
assert.ok(initial, 'Renderer fallback status must be available for the isolated fixture');
const task = {
  id: 'qa-task', name: 'Review interface', description: null, stage: 'assigned', canUpdateStage: true,
  projectId: 'general', projectName: 'General Work', teamId: 'qa-team', teamName: 'Design',
  reviewNote: null, completionNote: null, checklist: [], activeSeconds: 0, idleSeconds: 0, trackedSeconds: 0,
};
const status = {
  ...Function('return (' + initial + ')')(), enrolled: true, employeeName: 'QA Preview',
  trackingStatus: 'paused', trackingPaused: true, connectionStatus: 'online',
  workedTodaySeconds: 3082, normalSeconds: 3082, activeSeconds: 3082, tasks: [task],
  projects: [
    { id: 'general', name: 'General Work', team_id: 'qa-team', team_name: 'Design' },
    { id: 'long', name: 'A very long project name '.repeat(12), team_id: 'qa-team', team_name: 'Design' },
  ],
  requestPolicy: { timezone: 'Africa/Cairo', shift_start: '10:00', shift_end: '18:00', working_days: [0,1,2,3,4,5,6], weekly_early_leave_minutes: 120, weekly_early_leave_remaining_minutes: 90, weekly_early_leave_used_minutes: 30 },
};
const built = path.join(desktop, 'dist-khaliduo');
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(built, pathname === '/' ? 'index.html' : '.' + pathname);
  if (!file.startsWith(built + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${server.address().port}`;
const engine = process.argv.includes('--electron') ? 'electron' : 'chromium';
let browser;
let electron;
let page;
try {
  if (engine === 'electron') {
    const harness = path.join(output, 'renderer-harness.cjs');
    const profile = fs.mkdtempSync(path.join(output, 'electron-profile-'));
    fs.writeFileSync(harness, `const {app,BrowserWindow}=require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
app.disableHardwareAcceleration();
app.whenReady().then(()=>{const window=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});window.loadURL('about:blank');});
app.on('window-all-closed',()=>app.quit());`);
    electron = await _electron.launch({
      executablePath: createRequire(import.meta.url)('electron'), args: [harness], cwd: desktop,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')),
    });
    page = await electron.firstWindow();
  } else {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.setDefaultTimeout(15_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Hidden Electron windows can stall CDP screenshots on Windows. Keep the
  // same behavioral assertions there; Chromium produces the visual evidence.
  const capture = name => engine === 'electron' ? Promise.resolve() : page.screenshot({ path: path.join(output, name), animations: 'disabled' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Ensure this fixture never contacts a real service.
  await page.context().route('**/*', route => route.request().url().startsWith(baseURL + '/') ? route.continue() : route.abort());
  await page.addInitScript(status => {
    window.previewStatus = status;
    window.qaCalls = [];
    window.localStorage.setItem('khaliduo-desktop-dark-default-applied', '1');
    window.khaliduo = {
      diagnosticsConfig: async () => ({ enabled: false }),
      getAgentStatus: async () => window.previewStatus,
      onStatusChanged: callback => { window.pushPreviewStatus = callback; return () => {}; },
      onIdleAlert: () => () => {}, getRecentScreenshots: async () => ({ success: true, screenshots: [] }),
      isWindowExpanded: async () => true, onWindowExpandedChanged: () => () => {},
      setIdleAlertAttention: () => {}, setUpdateAttention: () => {},
      setCurrentTask: async id => {
        window.qaCalls.push(['setCurrentTask', id]);
        window.previewStatus = { ...window.previewStatus, selectedTask: window.previewStatus.tasks.find(task => task.id === id) ?? null };
        return { success: true, status: window.previewStatus };
      },
      listShiftReschedules: async () => ({ success: true, data: { policy: { timezone: 'Africa/Cairo', notice_days: 2, earliest_date: '2026-11-21', working_days: [0,1,2,3,4,5,6], weekly_off_days: [] }, requests: [] } }),
      getShiftRescheduleDay: async date => ({ success: true, data: { date, scheduled_day: true, shift_start: '10:00', shift_end: '18:00', shift_minutes: 480 } }),
      createShiftReschedule: async input => { window.qaCalls.push(['reschedule', input]); return { success: true }; },
    };
  }, status);
  await page.goto(baseURL);
  const nav = name => page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name, exact: true }).click();
  const project = page.getByRole('combobox', { name: 'Project', exact: true });
  const taskSelect = page.getByRole('combobox', { name: 'Task', exact: true });
  const note = page.getByRole('textbox', { name: 'Session note' });
  await expect(project).toHaveValue('general');

  for (const mode of ['dark', 'light']) {
    await page.getByRole('button', { name: /^Change theme/ }).click();
    await page.getByRole('group', { name: 'Light or dark' }).getByRole('button', { name: mode, exact: false }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.k-app')).toHaveAttribute('data-theme', mode);
    for (const control of [project, taskSelect, note]) {
      for (const state of ['default', 'hover', 'focus']) {
        if (state === 'hover') await control.hover();
        if (state === 'focus') { await page.keyboard.press('Tab'); await control.focus(); }
        await expect.poll(() => control.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
        const dimensions = await control.evaluate(el => {
          const field = el.getBoundingClientRect(); const pill = el.closest('.tp-pill').getBoundingClientRect();
          return { inside: field.top >= pill.top && field.bottom <= pill.bottom, shadow: getComputedStyle(el).boxShadow };
        });
        assert.ok(dimensions.inside, `${mode}/${state}: field must fit inside its pill`);
        assert.equal(dimensions.shadow, 'none');
      }
      const focus = await control.evaluate(el => getComputedStyle(el.closest('.tp-pill')).boxShadow);
      assert.notEqual(focus, 'none', 'Keyboard focus must remain visible on the wrapper');
    }
    await note.fill('Session note stays editable');
    await expect(note).toHaveValue('Session note stays editable');
    assert.equal(await project.locator('option').count(), 3);
    assert.equal(await taskSelect.locator('option').count(), 2);
    await project.click();
    const picker = await project.evaluate(el => {
      const c = getComputedStyle(el, '::picker(select)');
      return { appearance: getComputedStyle(el).appearance, radius: c.borderRadius, width: parseFloat(c.width), background: c.backgroundColor };
    });
    assert.equal(picker.appearance, 'base-select', 'Supported Chromium must use the themed select');
    assert.equal(picker.radius, '11px');
    assert.ok(picker.width <= 420, 'Long options must wrap in the shared menu');
    await capture(`${engine}-project-${mode}.png`);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(project).toHaveValue('long');
    await expect(taskSelect.locator('option')).toHaveCount(1);
    await project.click();
    await page.getByRole('option', { name: 'General Work', exact: true }).click();
    await taskSelect.selectOption('qa-task');
    await expect(taskSelect).toHaveValue('qa-task');
    await taskSelect.selectOption('none');
    await expect(taskSelect).toHaveValue('none');
    assert.deepEqual((await page.evaluate(() => window.qaCalls)).filter(call => call[0] === 'setCurrentTask').slice(-2), [['setCurrentTask', 'qa-task'], ['setCurrentTask', null]]);
    await capture(`${engine}-tracker-${mode}.png`);
    console.log(`PASS UI-001/005/006: ${mode} menus, options, values, note typing, hover/focus and field containment`);
  }

  const styles = ['minimal', 'ring', 'flip', 'arc', 'segments', 'bar'];
  const labels = ['Numbers only', 'Progress ring', 'Split-flap', 'Semi arc', 'Segments', 'Linear bar'];
  const saved = () => page.evaluate(() => localStorage.getItem('khaliduo-timer-style'));
  const countersBefore = await page.evaluate(() => JSON.stringify(window.previewStatus));
  const callsBefore = await page.evaluate(() => window.qaCalls.length);
  for (let index = 0; index < styles.length; index++) {
    console.log(`CHECK UI-004: ${labels[index]}`);
    if (index > 0) await page.getByRole('button', { name: /^Next timer style:/ }).click();
    await expect.poll(saved).toBe(styles[index]);
    await expect(page.getByRole('button', { name: `Use the ${labels[index]} face` })).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: `Timer style: ${labels[index]}`, exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Timer style', exact: true }).getByRole('menuitemradio', { checked: true })).toContainText(labels[index]);
    await expect(page.getByRole('menu', { name: 'Timer style', exact: true }).getByRole('menuitemradio')).toHaveCount(6);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: /^Next timer style:/ }).click();
  await expect.poll(saved).toBe('minimal');
  await page.getByRole('button', { name: /^Previous timer style:/ }).click();
  await expect.poll(saved).toBe('bar');
  await page.getByRole('button', { name: /^Timer style:/ }).click();
  await page.getByRole('menuitemradio', { name: /Semi arc/ }).click();
  await expect.poll(saved).toBe('arc');
  await page.getByRole('button', { name: 'Use the Progress ring face' }).click();
  await expect.poll(saved).toBe('ring');
  await page.getByRole('group', { name: /^Timer face/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(saved).toBe('flip');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(saved).toBe('ring');
  const next = page.getByRole('button', { name: /^Next timer style:/ });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect.poll(saved).toBe('flip');
  assert.ok((await next.boundingBox()).width >= 44);
  assert.notEqual(await next.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  assert.equal(await page.evaluate(() => JSON.stringify(window.previewStatus)), countersBefore);
  assert.equal(await page.evaluate(() => window.qaCalls.length), callsBefore, 'Changing faces must not call tracking or task IPC');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Timer style: Split-flap', exact: true })).toBeVisible();
  console.log('PASS UI-004: six faces, both wraps, menu/dot/keyboard synchronization, persistence and unchanged counters');

  for (const width of [1440, 980]) {
    await page.setViewportSize({ width, height: 820 });
    await nav('Requests');
    const day = page.locator('.k-shift-reschedule select');
    await expect(day.locator('option')).toHaveCount(31);
    assert.equal(await day.evaluate(el => getComputedStyle(el.parentElement).gap), '8px');
    const labelGap = await day.evaluate(el => {
      const label = el.parentElement; const range = document.createRange(); range.selectNode(label.firstChild);
      return el.getBoundingClientRect().top - range.getBoundingClientRect().bottom;
    });
    assert.ok(labelGap >= 8);
    assert.equal(await page.locator('.app-page').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await capture(`${engine}-requests-${width}.png`);
    console.log(`PASS UI-003: working-day label/control spacing and no clipping at ${width}px`);
  }
  await page.locator('.k-shift-reschedule select').selectOption('2026-11-21');
  await page.getByLabel('New start time').fill('08:00');
  await page.getByLabel('Reason', { exact: true }).fill('UI regression check only');
  await page.getByRole('button', { name: 'Request shift reschedule', exact: true }).click();
  await expect(page.getByText('Shift reschedule sent to HR for review.', { exact: true })).toBeVisible();
  assert.deepEqual((await page.evaluate(() => window.qaCalls)).find(call => call[0] === 'reschedule')[1], { workDate: '2026-11-21', requestedStart: '08:00', requestedEnd: '16:00', reason: 'UI regression check only' });

  await nav('Tasks');
  const start = page.getByLabel('Start date', { exact: true });
  const deadline = page.getByLabel('Deadline', { exact: true });
  await start.fill('2026-11-21');
  await deadline.fill('2026-11-20');
  assert.equal(await deadline.evaluate(el => el.validity.rangeUnderflow), true);
  await deadline.fill('2026-11-22');
  assert.equal(await deadline.evaluate(el => el.checkValidity()), true);
  await deadline.fill('');
  await expect(deadline).toHaveValue('');
  for (const mode of ['light', 'dark']) {
    await page.getByRole('button', { name: /^Change theme/ }).click();
    await page.getByRole('group', { name: 'Light or dark' }).getByRole('button', { name: mode, exact: false }).click();
    await page.keyboard.press('Escape');
    assert.equal(await deadline.evaluate(el => getComputedStyle(el).colorScheme), mode);
    await deadline.fill('2026-11-22');
    await deadline.evaluate(el => el.showPicker());
    await capture(`${engine}-calendar-${mode}.png`);
    await page.keyboard.press('Escape');
  }
  console.log('PASS UI-002 (native limits): date entry, clearing, min validation, popup opening and light/dark color-scheme');
  // The desktop host enforces 980px minimum width. Record the existing mobile
  // preview limitation without disguising it by changing the shell for this task.
  await page.setViewportSize({ width: 390, height: 844 });
  await nav('Tracker');
  const mobile = await page.locator('.app-page').evaluate(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
  await capture(`${engine}-mobile-existing-limit.png`);
  console.log('LIMITATION: mobile preview (outside desktop minWidth=980)', JSON.stringify(mobile));
  assert.deepEqual(errors, []);
  console.log(`PASS: ${engine}; no renderer errors. Chromium screenshots: ${output}`);
} catch (error) {
  if (engine !== 'electron') await page?.screenshot({ path: path.join(output, `${engine}-failure.png`), animations: 'disabled' }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await electron?.close();
  server.close();
}
