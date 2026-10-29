import { test, expect } from './fixture.ts';

test('scheduled quotes alternate Arabic with external English quotes and rotate a cached API batch', async ({ desktop: d }) => {
  await d.control('quote-feed', [
    { q: 'Keep exploring new ideas.', a: 'External author one' },
    { q: 'Patient effort makes progress.', a: 'External author two' },
  ]);
  await d.nav('Settings');
  await d.page.getByLabel('Remind me every', { exact: true }).fill('1');
  await d.page.getByRole('button', { name: 'Save interval' }).click();
  const created = d.app.waitForEvent('window');
  await d.advance(60);
  const quote = await created;
  await expect(quote.locator('.native-quote-reminder p')).toHaveAttribute('lang', 'ar');
  expect((await d.control('inspect')).calls.filter((row: any) => row.method === 'quote:http' && row.url.includes('zenquotes.io'))).toHaveLength(0);
  await quote.getByRole('button', { name: 'Dismiss quote' }).click();
  await d.advance(60);
  await expect(quote.locator('.native-quote-reminder p')).toHaveText('Keep exploring new ideas.');
  await expect(quote.locator('cite')).toHaveText('External author one');
  await expect(quote.getByRole('button', { name: 'Translate quote' })).toHaveCount(0);
  await quote.getByRole('button', { name: 'Quotes via ZenQuotes' }).click();
  expect((await d.control('inspect')).calls.some((row: any) => row.method === 'quote:open-source')).toBe(true);
  await quote.getByRole('button', { name: 'Dismiss quote' }).click();
  await d.advance(60);
  await expect(quote.locator('.native-quote-reminder p')).toHaveAttribute('lang', 'ar');
  await quote.getByRole('button', { name: 'Dismiss quote' }).click();
  await d.advance(60);
  await expect(quote.locator('.native-quote-reminder p')).toHaveText('Patient effort makes progress.');
  await expect(quote.locator('cite')).toHaveText('External author two');
  expect((await d.control('inspect')).calls.filter((row: any) => row.method === 'quote:http' && row.url.includes('zenquotes.io'))).toHaveLength(1);
});

test('an unavailable external API preserves scheduled reminders and the offline translation', async ({ desktop: d }) => {
  await d.nav('Settings');
  await d.page.getByLabel('Remind me every', { exact: true }).fill('1');
  await d.page.getByRole('button', { name: 'Save interval' }).click();
  const created = d.app.waitForEvent('window');
  await d.advance(60);
  const quote = await created;
  await expect(quote.getByLabel('Quote reminder', { exact: true })).toBeVisible();
  await quote.getByRole('button', { name: 'Dismiss quote' }).click();
  await d.advance(60);
  await expect(quote.locator('cite')).toHaveText('Albert Einstein');
  await expect(quote.locator('.native-quote-reminder p')).toHaveAttribute('lang', 'en');
  await expect(quote.getByRole('button', { name: 'Quotes via ZenQuotes' })).toHaveCount(0);
  await quote.getByRole('button', { name: 'Translate quote' }).click();
  await expect(quote.locator('.native-quote-reminder p')).toHaveAttribute('lang', 'ar');
  await expect(quote.locator('.native-quote-reminder p')).toHaveCSS('font-family', /Tajawal/);
  await expect(d.page.getByRole('alert')).toHaveCount(0);
  expect((await d.control('inspect')).calls.filter((row: any) => row.method === 'quote:http' && row.url.includes('zenquotes.io'))).toHaveLength(1);
});

test('the additional source supplies Arabic and English with author, Tajawal and source credit', async ({ desktop: d }) => {
  await d.control('quote-feed-extra', { language: 'ar', rows: [{ text: 'التعلّم المستمر يفتح آفاقًا جديدة.', source: 'كاتب عربي' }] });
  await d.control('quote-feed-extra', { language: 'en', rows: [{ text: 'Curiosity opens new horizons.', source: 'Another author' }] });
  await d.nav('Settings');
  await d.page.getByLabel('Remind me every', { exact: true }).fill('1');
  await d.page.getByRole('button', { name: 'Save interval' }).click();
  const created = d.app.waitForEvent('window');
  await d.advance(60);
  const quote = await created;
  await expect(quote.locator('.native-quote-reminder p')).toHaveText('التعلّم المستمر يفتح آفاقًا جديدة.');
  await expect(quote.locator('.native-quote-reminder p')).toHaveAttribute('lang', 'ar');
  await expect(quote.locator('.native-quote-reminder p')).toHaveCSS('font-family', /Tajawal/);
  await expect(quote.locator('cite')).toHaveText('كاتب عربي');
  await expect(quote.getByRole('button', { name: 'Quotes via Quote Unquote' })).toBeVisible();
  await quote.getByRole('button', { name: 'Dismiss quote' }).click();
  await d.advance(60);
  // ZenQuotes is unavailable: the other English provider keeps the reminder working.
  await expect(quote.locator('.native-quote-reminder p')).toHaveText('Curiosity opens new horizons.');
  await expect(quote.locator('.native-quote-reminder p')).toHaveAttribute('lang', 'en');
  await expect(quote.locator('cite')).toHaveText('Another author');
  await quote.getByRole('button', { name: 'Quotes via Quote Unquote' }).click();
  expect((await d.control('inspect')).calls.some((row: any) => row.method === 'quote:open-source')).toBe(true);
});
