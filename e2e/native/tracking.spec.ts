import { test, expect } from './fixture.ts';

test('idle threshold counts only the period after fifteen complete minutes', async ({ desktop: d }) => {
  await d.advance(899, true);
  expect((await d.status()).trackingStatus).toBe('active');
  await expect(d.page.locator('.swal2-popup')).toHaveCount(0);
  await d.advance(1, true);
  await expect(d.page.getByRole('heading', { name: 'Are you still working?' })).toBeVisible();
  expect((await d.status()).idleSeconds).toBe(0);
  await d.advance(75, true);
  const status = await d.status();
  expect(status.idleSeconds).toBe(75);
  expect(status.currentIdleSeconds).toBe(75);
  expect(status.activeSeconds).toBe(900);
  expect((await d.control('inspect')).events.filter((e: any) => e.event === 'idle_started')).toHaveLength(1);
});

test('Continue working ends idle once, preserves the gap, and requires a fresh threshold', async ({ desktop: d }) => {
  await d.advance(960, true);
  await d.page.getByRole('button', { name: 'Continue working', exact: true }).click();
  await expect(d.page.locator('.swal2-popup')).toHaveCount(0);
  expect((await d.status()).trackingStatus).toBe('active');
  expect((await d.status()).idleSeconds).toBe(60);
  await d.advance(10);
  expect((await d.status()).activeSeconds).toBeGreaterThan(900);
  await expect(d.page.locator('.swal2-popup')).toHaveCount(0);
  await d.advance(899, true);
  await expect(d.page.locator('.swal2-popup')).toHaveCount(0);
  expect((await d.control('inspect')).events.filter((e: any) => e.event === 'idle_ended')).toHaveLength(1);
});

test('idle can stop tracking through the review dialog', async ({ desktop: d }) => {
  await d.advance(901, true);
  await d.page.getByRole('button', { name: 'Stop tracking', exact: true }).click();
  await expect(d.page.locator('.swal2-popup')).toHaveCount(0);
  expect((await d.status()).trackingPaused).toBe(true);
});

test('manual pause freezes work counters and blocks captures until Resume', async ({ desktop: d }) => {
  await d.advance(12);
  await d.page.getByRole('button', { name: 'Pause Tracker', exact: true }).click();
  const before = await d.status();
  await d.advance(120, true);
  expect((await d.status()).activeSeconds).toBe(before.activeSeconds);
  expect((await d.status()).idleSeconds).toBe(before.idleSeconds);
  expect((await d.control('inspect')).screenshotBlockReason).toBe('tracking_paused');
  await expect(d.page.locator('.tracker-break-timer').filter({ visible: true })).toHaveCount(0);
  await d.page.getByRole('button', { name: 'Resume Tracker', exact: true }).click();
  await d.advance(6);
  expect((await d.status()).activeSeconds).toBeGreaterThan(before.activeSeconds);
  expect((await d.control('inspect')).screenshotBlockReason).toBeNull();
});

test('Take Break accumulates separate breaks and persists the paused total', async ({ desktop: d }) => {
  await d.page.getByRole('button', { name: 'Take Break', exact: true }).click();
  await d.advance(1200, true);
  await expect(d.page.locator('.tracker-break-timer').filter({ visible: true })).toContainText('20:00');
  expect((await d.status()).activeSeconds).toBe(0);
  await d.page.getByRole('button', { name: 'Resume Tracker', exact: true }).click();
  await d.advance(60);
  await expect(d.page.locator('.tracker-break-timer').filter({ visible: true })).toContainText('Paused');
  expect((await d.status()).breakElapsedSeconds).toBe(1200);
  await d.control('restore-break');
  expect((await d.status()).breakElapsedSeconds).toBe(1200);
  await d.page.reload();
  await expect(d.page.locator('.tracker-break-timer').filter({ visible: true })).toContainText('20:00');
  await d.page.getByRole('button', { name: 'Take Break', exact: true }).click();
  await d.advance(60, true);
  await expect(d.page.locator('.tracker-break-timer').filter({ visible: true })).toContainText('21:00');
  expect((await d.control('inspect')).events.filter((e: any) => e.event === 'session_ended')).toHaveLength(0);
});

test('45 total break minutes warn; 60 end the shift exactly once', async ({ desktop: d }) => {
  await d.page.getByRole('button', { name: 'Take Break', exact: true }).click();
  await d.advance(2699, true);
  await expect(d.page.locator('.tracker-break-timer').filter({ visible: true })).not.toHaveClass(/is-warning/);
  await d.advance(1, true);
  await expect(d.page.locator('.tracker-break-timer').filter({ visible: true })).toHaveClass(/is-warning/);
  await d.advance(899, true);
  expect((await d.status()).sessionStartedAt).not.toBeNull();
  await d.advance(1, true);
  expect((await d.status()).sessionStartedAt).toBeNull();
  expect((await d.status()).breakStartedAt).toBeNull();
  expect((await d.status()).breakElapsedSeconds).toBe(0);
  await d.advance(5, true);
  expect((await d.control('inspect')).events.filter((e: any) => e.event === 'session_ended')).toHaveLength(1);
});

test('scheduled break inactivity is paid and does not open an idle popup', async ({ desktop: d }) => {
  await d.control('scheduled', true);
  await d.advance(970, true);
  expect((await d.status()).trackingStatus).toBe('idle');
  expect((await d.status()).idleSeconds).toBe(0);
  await expect(d.page.locator('.swal2-popup')).toHaveCount(0);
  expect((await d.control('inspect')).calls.some((c: any) => c.method === 'scheduled-break-notification')).toBe(true);
});

test('saved break credit suppresses idle until it is exhausted', async ({ desktop: d }) => {
  await d.control('patch', { breakBank: { policy_active: true, remaining_seconds: 60, earned_seconds: 60, used_seconds: 0, approved_seconds: 0, paid_late_allowance_seconds: 0 } });
  await d.advance(959, true);
  await expect(d.page.locator('.swal2-popup')).toHaveCount(0);
  expect((await d.status()).idleSeconds).toBe(0);
  await d.advance(1, true);
  await expect(d.page.getByRole('heading', { name: 'Are you still working?' })).toBeVisible();
  await d.advance(10, true);
  expect((await d.status()).idleSeconds).toBe(10);
});

test('End shift needs confirmation and saves the stop intent', async ({ desktop: d }) => {
  await d.page.getByRole('button', { name: 'End Shift', exact: true }).click();
  await d.page.locator('.swal2-popup').getByRole('button', { name: 'Keep working', exact: true }).click();
  expect((await d.status()).trackingPaused).toBe(false);
  await d.page.getByRole('button', { name: 'End Shift', exact: true }).click();
  await d.page.locator('.swal2-popup').getByRole('button', { name: 'End shift', exact: true }).click();
  await expect(d.page.getByRole('button', { name: 'Resume Tracker' })).toBeVisible();
  expect((await d.status()).sessionStartedAt).toBeNull();
  expect((await d.control('inspect')).events.at(-1).reason).toBe('Employee ended shift');
});

for (const state of ['locked', 'sleeping'] as const) test(`${state} stops accrual and blocks screenshot capture`, async ({ desktop: d }) => {
  await d.advance(5);
  await d.control('power', state);
  const before = (await d.status()).activeSeconds;
  await d.advance(20, true);
  expect((await d.status()).activeSeconds).toBe(before);
  expect((await d.control('inspect')).screenshotBlockReason).toBe(state === 'locked' ? 'screen_locked' : 'system_sleeping');
  await d.control('power', 'active');
  await d.advance(3);
  expect((await d.status()).activeSeconds).toBeGreaterThan(before);
});

test('battery power blocks screenshots; AC power restores eligibility', async ({ desktop: d }) => {
  await d.control('battery', true);
  expect((await d.control('inspect')).screenshotBlockReason).toBe('battery_power');
  await d.control('battery', false);
  expect((await d.control('inspect')).screenshotBlockReason).toBeNull();
});

test('offline pause and resume stay responsive and sync queued transport replies once', async ({ desktop: d }) => {
  await d.control('network', false);
  await d.page.getByRole('button', { name: 'Pause Tracker' }).click();
  await d.page.getByRole('button', { name: 'Resume Tracker' }).click();
  const offline = await d.control('inspect');
  expect(offline.queued.map((row: any) => row.event)).toEqual(['manual_pause_started', 'manual_pause_ended']);
  await d.control('network', true);
  await d.page.getByRole('button', { name: 'Sync now', exact: true }).click();
  expect((await d.control('inspect')).queued).toHaveLength(0);
  expect((await d.control('inspect')).delivered.map((row: any) => row.event)).toEqual(['manual_pause_started', 'manual_pause_ended']);
});

