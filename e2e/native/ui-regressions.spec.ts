import { test, expect } from './fixture.ts';

const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6p8AAAAASUVORK5CYII=';

test('the idle clock shows the current gap while daily progress keeps worked time', async ({ desktop: d }) => {
  await d.page.getByRole('button', { name: 'Use the Numbers only face', exact: true }).click();
  await d.advance(975, true);
  await expect(d.page.locator('.v211-timer-face .tp-clock')).toHaveAttribute('aria-label', 'Elapsed 00:01:15');
  await expect(d.page.locator('.v211-hero .tp-tag')).toContainText('Shift idle');
  await expect(d.page.locator('.v211-goal strong')).toHaveText('3%');
});

test('paid breaks appear on the work clock and overtime does not inflate the daily goal', async ({ desktop: d }) => {
  await d.page.getByRole('button', { name: 'Use the Numbers only face', exact: true }).click();
  await d.control('patch', {
    workedTodaySeconds: 3600, normalSeconds: 3600, dailyTargetSeconds: 7200,
    todayTimeline: { date: '2026-10-27', timezone: 'Africa/Cairo', intervals: [
      { type: 'break', break_paid: true, started_at: '2026-10-27T08:00:00Z', duration_seconds: 1200, is_current: false },
    ] },
  });
  await expect(d.page.locator('.v211-timer-face .tp-clock')).toHaveAttribute('aria-label', 'Elapsed 01:20:00');
  await d.control('patch', {
    workedTodaySeconds: 5400, normalSeconds: 3600, extraSeconds: 1800,
    requestPolicy: { ...(await d.status()).requestPolicy, shift_start: '01:00', shift_end: '02:00' },
  });
  await expect(d.page.locator('.v211-timer-face .tp-clock')).toHaveAttribute('aria-label', 'Elapsed 00:30:00');
  await expect(d.page.locator('.v211-goal strong')).toHaveText('50%');
});

test('offline screenshot previews describe the last sync rather than a current sync', async ({ desktop: d }) => {
  await d.control('screenshots', [{ id: 'shot', displayName: 'Screen 1', capturedAt: '2026-10-27T09:00:00Z', dataUrl }]);
  await d.nav('Shots');
  await d.page.getByRole('button', { name: 'Refresh screenshots' }).click();
  await d.control('network', false);
  await d.nav('Tracker');
  await expect(d.page.locator('.v216-shot-meta')).toContainText('Last synced');
});

test('All projects stays selected and exposes tasks from every project', async ({ desktop: d }) => {
  const project = d.page.getByRole('button', { name: 'Project', exact: true });
  await project.click();
  await d.page.getByRole('option', { name: 'All projects', exact: true }).click();
  await expect(project).toHaveText('All projects');
  await d.page.getByRole('button', { name: 'Task', exact: true }).click();
  await expect(d.page.getByRole('option', { name: 'Prepare client delivery', exact: true })).toBeVisible();
  await expect(d.page.getByRole('option', { name: 'Improve internal tools', exact: true })).toBeVisible();
});

test('switching enrollment clears the previous employee screenshot cache', async ({ desktop: d }) => {
  await d.control('screenshots', [{ id: 'old-shot', displayName: 'Previous employee screen', capturedAt: '2026-10-27T08:00:00Z', dataUrl }]);
  await d.nav('Shots');
  await d.page.getByRole('button', { name: 'Refresh screenshots' }).click();
  await expect(d.page.getByRole('img', { name: 'Previous employee screen' })).toBeVisible();
  await d.control('patch', { enrolled: false });
  await expect(d.page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await d.control('screenshots', [{ id: 'new-shot', displayName: 'Current employee screen', capturedAt: '2026-10-27T09:00:00Z', dataUrl }]);
  await d.control('patch', { enrolled: true, deviceId: 'another-device', employeeEmail: 'another@e2e.example.test' });
  await d.nav('Shots');
  await expect(d.page.getByRole('img', { name: 'Current employee screen' })).toBeVisible();
  await expect(d.page.getByRole('img', { name: 'Previous employee screen' })).toHaveCount(0);
});

test('a delayed screenshot response cannot replace the new employee images', async ({ desktop: d }) => {
  await d.nav('Shots');
  await expect(d.page.getByRole('button', { name: 'Refresh screenshots' })).toBeEnabled();
  await d.app.evaluate(({ ipcMain }, image) => {
    ipcMain.removeHandler('agent:get-recent-screenshots');
    let requests = 0;
    ipcMain.handle('agent:get-recent-screenshots', () => {
      requests++;
      if (requests === 1) return new Promise(resolve => {
        (globalThis as any).releaseOldScreenshots = () => resolve({ success: true, screenshots: [
          { id: 'old-shot', displayName: 'Previous employee screen', capturedAt: '2026-10-27T08:00:00Z', dataUrl: image },
        ] });
      });
      return { success: true, screenshots: [
        { id: 'new-shot', displayName: 'Current employee screen', capturedAt: '2026-10-27T09:00:00Z', dataUrl: image },
      ] };
    });
  }, dataUrl);
  await d.page.getByRole('button', { name: 'Refresh screenshots' }).click();
  await expect(d.page.getByRole('button', { name: /Loading/ })).toBeDisabled();
  await d.control('patch', { enrolled: false });
  await expect(d.page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await d.control('patch', { enrolled: true, deviceId: 'another-device', employeeEmail: 'another@e2e.example.test' });
  await expect(d.page.getByRole('img', { name: 'Current employee screen' })).toBeVisible();
  await d.app.evaluate(() => (globalThis as any).releaseOldScreenshots());
  // Complete a renderer round trip after the old IPC reply has been handled.
  await d.nav('Tracker');
  await d.nav('Shots');
  await expect(d.page.getByRole('img', { name: 'Previous employee screen' })).toHaveCount(0);
  await expect(d.page.getByRole('img', { name: 'Current employee screen' })).toBeVisible();
});

test('the progress ring stays valid when there is no daily target', async ({ desktop: d }) => {
  await d.control('patch', { dailyTargetSeconds: 0 });
  await d.page.getByRole('button', { name: 'Use the Progress ring face', exact: true }).click();
  const ring = d.page.locator('.v211-timer-face circle[stroke-dashoffset]');
  await expect.poll(() => ring.getAttribute('stroke-dashoffset').then(value => Number.isFinite(Number(value)))).toBe(true);
  await expect(d.page.locator('.v211-goal strong')).toHaveText('—');
});
