import { test, expect } from './fixture.ts';

const quoteKey = 'khaliduo:quote-reminders:v1:desktop-e2e';

test('sign out can be cancelled; failed login clears the password and valid login links the device', async ({ desktop: d }) => {
  await d.nav('Settings');
  const signOut = d.page.getByRole('button', { name: 'Sign out from this device', exact: true });
  await signOut.click();
  await d.page.getByRole('button', { name: 'Keep me signed in', exact: true }).click();
  expect((await d.status()).enrolled).toBe(true);
  await signOut.click();
  await d.page.locator('.swal2-popup').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(d.page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await d.page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(d.page.getByRole('status')).toContainText('Contact your admin');
  await d.page.getByLabel('Work email').fill('desktop@e2e.example.test');
  await d.page.getByLabel('Password', { exact: true }).fill('Wrong-password-1');
  await d.page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(d.page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await d.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(d.page.getByRole('alert')).toContainText('Invalid email or password');
  await expect(d.page.getByLabel('Password', { exact: true })).toHaveValue('');
  await d.page.getByLabel('Password', { exact: true }).fill('E2e-password-1');
  await d.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(d.page.locator('.tracker-frame')).toBeVisible();
  expect((await d.status()).enrolled).toBe(true);
});

for (const outside of [false, true]) test(`tracking start prompt ${outside ? 'outside' : 'inside'} the shift supports decline and confirmation`, async ({ desktop: d }) => {
  await d.control('start-prompt', outside);
  await expect(d.page.getByRole('heading', { name: outside ? 'Start extra time?' : 'Start work tracking?', exact: true })).toBeVisible();
  await d.page.getByRole('button', { name: 'Not working', exact: true }).click();
  expect((await d.status()).sessionStartedAt).toBeNull();
  await d.control('start-prompt', outside);
  await d.page.getByRole('button', { name: outside ? 'Start extra time' : 'Start work', exact: true }).click();
  await expect(d.page.locator('.swal2-popup')).toHaveCount(0);
  expect((await d.status()).trackingStatus).toBe('active');
});

test('all six appearance palettes apply and persist after renderer reload', async ({ desktop: d }) => {
  for (const [label, skin] of [['Orbit', 'violet'], ['Ember', 'ember'], ['Forest', 'forest']]) {
    for (const mode of ['Light', 'Dark']) {
      await d.page.getByLabel('Appearance', { exact: true }).click();
      await d.page.getByRole('button', { name: `${label} ${mode}`, exact: true }).click();
      await expect(d.page.locator('.tracker-frame')).toHaveAttribute('data-theme', mode.toLowerCase());
      await expect(d.page.locator('.tracker-frame')).toHaveAttribute('data-skin', skin);
    }
  }
  await d.page.reload();
  await expect(d.page.locator('.tracker-frame')).toHaveAttribute('data-skin', 'forest');
  await expect(d.page.locator('.tracker-frame')).toHaveAttribute('data-theme', 'dark');
});

test('all timer faces are selectable and the selected face survives reload', async ({ desktop: d }) => {
  for (const name of ['Split-flap', 'Progress ring', 'Semi arc', 'Segments', 'Numbers only']) {
    const button = d.page.getByRole('button', { name: `Use the ${name} face`, exact: true }).filter({ visible: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'true');
  }
  await d.page.reload();
  await expect(d.page.getByRole('button', { name: 'Use the Numbers only face', exact: true }).filter({ visible: true })).toHaveAttribute('aria-current', 'true');
});

test('quote interval validates its range, saves, and remembers the enabled switch', async ({ desktop: d }) => {
  await d.nav('Settings');
  const interval = d.page.getByLabel('Remind me every', { exact: true });
  for (const invalid of ['0', '1441', '1.5']) {
    await interval.fill(invalid);
    await expect.poll(() => interval.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false);
  }
  await interval.fill('1');
  await d.page.getByRole('button', { name: 'Save interval' }).click();
  await expect(d.page.getByRole('status')).toContainText('Your next quote is in 1 minute');
  await d.page.getByRole('switch', { name: 'Enable quote notifications' }).uncheck();
  await d.page.reload();
  await d.nav('Settings');
  await expect(d.page.getByRole('switch', { name: 'Enable quote notifications' })).not.toBeChecked();
  await expect(d.page.getByLabel('Remind me every', { exact: true })).toHaveValue('1');
});

test('due quotes use a separate bottom-right window, translate to Tajawal Arabic, and dismiss', async ({ desktop: d }) => {
  await d.nav('Settings');
  await d.page.getByLabel('Remind me every', { exact: true }).fill('1');
  await d.page.getByRole('button', { name: 'Save interval' }).click();
  const quoteWindow = d.app.waitForEvent('window');
  await d.advance(60);
  // The reminder interval uses the real renderer scheduler and the fixed clock.
  const quote = await quoteWindow;
  await expect(quote.getByLabel('Quote reminder', { exact: true })).toBeVisible();
  await expect(quote.locator('.native-quote-reminder p')).toHaveAttribute('lang', 'ar');
  await expect(quote.locator('.native-quote-reminder p')).toHaveCSS('font-family', /Tajawal/);
  await quote.getByRole('button', { name: 'Translate quote' }).click();
  await expect(quote.locator('cite')).toHaveText('Albert Einstein');
  await expect(quote.locator('.native-quote-reminder p')).toHaveAttribute('lang', 'en');
  await quote.getByRole('button', { name: 'Translate quote' }).click();
  await expect(quote.locator('.native-quote-reminder p')).toHaveAttribute('lang', 'ar');
  const nativeQuote = await d.app.browserWindow(quote);
  const bounds = await nativeQuote.evaluate(window => window.getBounds());
  const area = await d.app.evaluate(({ screen }, bounds) => screen.getDisplayMatching(bounds).workArea, bounds);
  expect(area.x + area.width - bounds.x - bounds.width).toBe(16);
  expect(area.y + area.height - bounds.y - bounds.height).toBe(16);
  expect(await nativeQuote.evaluate(window => window.isAlwaysOnTop())).toBe(true);
  await quote.getByRole('button', { name: 'Dismiss quote' }).click();
  await expect.poll(() => nativeQuote.evaluate(window => window.isVisible())).toBe(false);
  const settings = await d.page.evaluate(key => JSON.parse(localStorage.getItem(key)!), quoteKey);
  expect(settings.sequence).toBe(1);
  expect(settings.nextAt).toBeGreaterThan(Date.parse('2026-10-27T09:01:00Z'));
});

test('quotes continue while the main window is minimized and do not steal focus', async ({ desktop: d }) => {
  await d.nav('Settings');
  await d.page.getByLabel('Remind me every', { exact: true }).fill('1');
  await d.page.getByRole('button', { name: 'Save interval' }).click();
  await d.page.getByRole('button', { name: 'Minimize', exact: true }).filter({ visible: true }).click();
  const quoteWindow = d.app.waitForEvent('window');
  await d.advance(60);
  const quote = await quoteWindow;
  await expect(quote.getByLabel('Quote reminder', { exact: true })).toBeVisible();
  const nativeMain = await d.app.browserWindow(d.page);
  const nativeQuote = await d.app.browserWindow(quote);
  expect(await nativeMain.evaluate(window => window.isMinimized())).toBe(true);
  expect(await nativeQuote.evaluate(window => window.isFocused())).toBe(false);
});

test('disabled quotes do not create a reminder window when their previous deadline passes', async ({ desktop: d }) => {
  await d.nav('Settings');
  await d.page.getByRole('switch', { name: 'Enable quote notifications' }).uncheck();
  await d.advance(3601);
  await d.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(await d.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  const settings = await d.page.evaluate(key => JSON.parse(localStorage.getItem(key)!), quoteKey);
  expect(settings.nextAt).toBe(0);
  expect(settings.sequence).toBe(0);
});

test('close prompt deduplicates, survives reload, traps focus, and supports Escape', async ({ desktop: d }) => {
  const open = () => d.page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).click();
  await open();
  const dialog = d.page.getByRole('dialog', { name: 'Close Khaliduo?', exact: true });
  await expect(dialog.getByRole('button', { name: /Hide & Keep Tracking/ })).toBeFocused();
  await open();
  await expect(dialog).toHaveCount(1);
  await d.page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep app open', exact: true }).focus();
  await d.page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await d.page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await d.status()).trackingPaused).toBe(false);
});

test('close choices hide with the requested tracking state and explicit Quit is dispatched once', async ({ desktop: d }) => {
  const dialog = d.page.getByRole('dialog', { name: 'Close Khaliduo?', exact: true });
  const open = async () => { await d.control('show'); await d.page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).click(); };
  const isVisible = () => d.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  await open();
  await dialog.getByRole('button', { name: /Hide & Keep Tracking/ }).click();
  await expect.poll(isVisible).toBe(false);
  expect((await d.status()).trackingPaused).toBe(false);
  await open();
  await dialog.getByRole('button', { name: /Pause & Hide/ }).click();
  await expect.poll(isVisible).toBe(false);
  expect((await d.status()).trackingPaused).toBe(true);
  await open();
  await dialog.getByRole('button', { name: /Hide \(Keep Paused\)/ }).click();
  await expect.poll(isVisible).toBe(false);
  expect((await d.status()).trackingPaused).toBe(true);
  await open();
  await dialog.getByRole('button', { name: /Resume Tracking & Hide/ }).click();
  await expect.poll(isVisible).toBe(false);
  expect((await d.status()).trackingPaused).toBe(false);
  await open();
  await dialog.getByRole('button', { name: /Quit Khaliduo/ }).click();
  await expect(dialog).toHaveCount(0);
  expect((await d.control('inspect')).calls.filter((row: any) => row.method === 'app:quit')).toHaveLength(1);
});

test('a failed close action stays visible for retry', async ({ desktop: d }) => {
  await d.page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).click();
  const dialog = d.page.getByRole('dialog', { name: 'Close Khaliduo?', exact: true });
  await d.control('fail', { method: 'window:respond-close', message: 'Could not pause. Try again.' });
  await dialog.getByRole('button', { name: /Pause & Hide/ }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Could not pause. Try again.');
  await d.control('recover', 'window:respond-close');
  await dialog.getByRole('button', { name: /Pause & Hide/ }).click();
  await expect(dialog).toHaveCount(0);
  expect((await d.status()).trackingPaused).toBe(true);
});

test('maximize removes curved edges and restore returns the normal frame', async ({ desktop: d }) => {
  const maximize = d.page.getByRole('button', { name: 'Maximize or restore', exact: true }).filter({ visible: true });
  await maximize.click();
  await expect(d.page.locator('html')).toHaveAttribute('data-window-expanded', 'true');
  await expect(d.page.locator('.tracker-frame')).toHaveCSS('border-top-left-radius', '0px');
  await maximize.click();
  await expect(d.page.locator('html')).toHaveAttribute('data-window-expanded', 'false');
});

test('update controls show failures, progress, and dispatch installation without an installer', async ({ desktop: d }) => {
  await d.control('fail', { method: 'agent:check-for-updates', message: 'Update server unavailable' });
  await d.page.getByRole('button', { name: 'Check update', exact: true }).click();
  await expect(d.page.getByRole('heading', { name: 'Update check failed' })).toBeVisible();
  await d.page.getByRole('button', { name: 'OK', exact: true }).click();
  await d.control('patch', { updateRequired: true, updateStatus: 'downloading', updatePercent: 42, updateVersion: '9.9.9' });
  await expect(d.page.getByRole('button', { name: 'Updating 42%', exact: true })).toBeDisabled();
  await d.control('patch', { updateStatus: 'ready' });
  await d.page.locator('.app-nav-btn[aria-label="Install update"]').filter({ visible: true }).click();
  expect((await d.control('inspect')).calls.filter((row: any) => row.method === 'agent:install-update')).toHaveLength(1);
});

test('compact layouts keep navigation, tracker controls and close dialog accessible', async ({ desktop: d }) => {
  for (const size of [{ width: 460, height: 720 }, { width: 520, height: 400 }, { width: 460, height: 360 }]) {
    await d.control('size', size);
    await expect(d.page.getByRole('button', { name: 'Pause Tracker', exact: true })).toBeVisible();
    await d.page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).click();
    const dialog = d.page.getByRole('dialog', { name: 'Close Khaliduo?', exact: true });
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});
