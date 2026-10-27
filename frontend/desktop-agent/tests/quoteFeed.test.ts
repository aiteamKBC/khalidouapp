import assert from "node:assert/strict";
import test from "node:test";
import { QuoteFeed, QuoteSources, quoteFeedUrl, QUOTE_FEED_RETRY_MS, QUOTE_FEED_TTL_MS, QUOTE_FEED_URL, type FeedQuote } from "../electron/services/quoteFeed.ts";

const rows = Array.from({ length: 50 }, (_, index) => ({ q: `Inspiration number ${index + 1}.`, a: `Author ${index + 1}` }));
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("fetches one unauthenticated batch and rotates through fifty distinct quotes", async () => {
  const calls: { url: unknown; options: RequestInit | undefined }[] = [];
  const feed = new QuoteFeed({
    now: () => 1_000, random: () => 0.999,
    fetch: async (url, options) => { calls.push({ url, options }); return response(rows); },
  });
  const quotes = [];
  for (let index = 0; index < 50; index++) quotes.push(await feed.next());
  assert.equal(new Set(quotes.map(quote => quote!.text)).size, 50);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, QUOTE_FEED_URL);
  assert.equal(calls[0].options?.credentials, "omit");
  assert.deepEqual(calls[0].options?.headers, { Accept: "application/json" });
  assert.ok(calls[0].options?.signal instanceof AbortSignal);
  assert.equal(quotes[0]?.provider, "zenquotes");
  assert.deepEqual(await feed.next(), quotes[0]);
});

test("persists the batch and cursor across restarts without fetching again", async () => {
  let cache: unknown;
  let requests = 0;
  const options = {
    now: () => 1_000, random: () => 0.999,
    readCache: () => cache,
    writeCache: (value: unknown) => { cache = structuredClone(value); },
    fetch: async () => { requests++; return response(rows); },
  };
  const first = await new QuoteFeed(options).next();
  const second = await new QuoteFeed(options).next();
  assert.notEqual(first?.text, second?.text);
  assert.equal(requests, 1);
});

test("refreshes after an hour and does not immediately repeat the previous quote", async () => {
  let now = 1_000;
  let requests = 0;
  const feed = new QuoteFeed({ now: () => now, random: () => 0.999, fetch: async () => { requests++; return response(rows); } });
  const first = await feed.next();
  now += QUOTE_FEED_TTL_MS - 1;
  await feed.next();
  assert.equal(requests, 1);
  now++;
  const fresh = await feed.next();
  assert.equal(requests, 2);
  assert.equal(fresh?.text, first?.text);
  const tiny = new QuoteFeed({ now: () => now, random: () => 0.999, fetch: async () => response(rows.slice(0, 2)) });
  const previous = await tiny.next();
  now += QUOTE_FEED_TTL_MS;
  assert.notEqual((await tiny.next())?.text, previous?.text);
});

test("concurrent reminders share a request and consume different quotes", async () => {
  let requests = 0;
  const feed = new QuoteFeed({ fetch: async () => { requests++; return response(rows); } });
  const results = await Promise.all([feed.next(), feed.next(), feed.next()]);
  assert.equal(requests, 1);
  assert.equal(new Set(results.map(row => row!.text)).size, 3);
});

test("HTTP failures fall back without hammering the provider and retry later", async () => {
  let now = 1_000;
  let requests = 0;
  const feed = new QuoteFeed({ now: () => now, fetch: async () => { requests++; return requests === 1 ? response({}, 429) : response(rows); } });
  assert.equal(await feed.next(), null);
  assert.equal(await feed.next(), null);
  now += QUOTE_FEED_RETRY_MS - 1;
  assert.equal(await feed.next(), null);
  assert.equal(requests, 1);
  now++;
  assert.ok(await feed.next());
  assert.equal(requests, 2);
});

test("expired cached quotes remain available when the provider is offline", async () => {
  let now = 1_000;
  let online = true;
  const feed = new QuoteFeed({ now: () => now, fetch: async () => { if (!online) throw new Error("offline"); return response(rows); } });
  const first = await feed.next();
  online = false;
  now += QUOTE_FEED_TTL_MS;
  const offline = await feed.next();
  assert.ok(offline);
  assert.notEqual(offline.text, first!.text);
});

test("rejects unusable/provider-error entries and deduplicates the response", async () => {
  const feed = new QuoteFeed({ random: () => 0.999, fetch: async () => response([
    null, {}, { q: "", a: "Author" }, { q: "x".repeat(501), a: "Author" },
    { q: "Too many requests", a: "zenquotes.io" },
    { q: "  Keep   learning.  ", a: " Scientist " },
    { q: "Keep learning.", a: "Scientist" },
  ]) });
  assert.deepEqual(await feed.next(), { text: "Keep learning.", author: "Scientist", provider: "zenquotes" });
  assert.deepEqual(await feed.next(), { text: "Keep learning.", author: "Scientist", provider: "zenquotes" });
});

test("invalid JSON, empty batches, and aborted requests use the local fallback", async () => {
  for (const fetcher of [
    async () => new Response("not json"),
    async () => response([]),
    async () => { throw new DOMException("Request timed out", "AbortError"); },
  ]) assert.equal(await new QuoteFeed({ fetch: fetcher }).next(), null);
});

test("a missing/corrupt cache or a read-only profile cannot stop reminders", async () => {
  for (const readCache of [() => { throw new Error("missing"); }, () => ({ version: 1, quotes: [], fetchedAt: -1 })]) {
    const feed = new QuoteFeed({ readCache, writeCache: () => { throw new Error("read only"); }, fetch: async () => response(rows) });
    assert.ok(await feed.next());
  }
});

test("the additional provider parses Arabic and English collections with separate cache identities", async () => {
  for (const [language, text, author] of [['ar', 'العلم يفتح آفاقًا جديدة.', 'كاتب عربي'], ['en', 'Learning opens new horizons.', 'An author']] as const) {
    let cache: unknown;
    let requestedUrl: unknown;
    const options = { provider: 'quote-unquote' as const, language, now: () => 1_000,
      writeCache: (value: unknown) => { cache = structuredClone(value); },
      readCache: () => cache,
      fetch: async (url: unknown) => { requestedUrl = url; return response([{ text, source: author }]); },
    };
    assert.deepEqual(await new QuoteFeed(options).next(), { text, author, provider: 'quote-unquote' });
    assert.equal(requestedUrl, quoteFeedUrl('quote-unquote', language));
    const restored = new QuoteFeed({ ...options, fetch: async () => { throw new Error('offline'); } });
    assert.equal((await restored.next())?.text, text);
  }
});

test("wrong-language data cannot leak into Arabic reminders", async () => {
  const feed = new QuoteFeed({ provider: 'quote-unquote', language: 'ar', fetch: async () => response([{ text: 'English only.', source: 'Author' }]) });
  assert.equal(await feed.next(), null);
});

test("Arabic cache loading rejects a different provider/language", async () => {
  const feed = new QuoteFeed({ provider: 'quote-unquote', language: 'ar', now: () => 1_000,
    readCache: () => ({ version: 1, fetchedAt: 900, cursor: 0, provider: 'zenquotes', language: 'en', quotes: [{ text: 'English only.', author: 'Author' }] }),
    fetch: async () => { throw new Error('offline'); },
  });
  assert.equal(await feed.next(), null);
});

test("sources alternate English providers, fall back independently, and preserve Arabic", async () => {
  const make = (text: string, provider: FeedQuote['provider']): FeedQuote => ({ text, author: 'Author', provider });
  let zenOnline = true, extraOnline = true;
  const zen = make('Zen English.', 'zenquotes');
  const extra = make('Extra English.', 'quote-unquote');
  const arabic = make('اقتباس عربي.', 'quote-unquote');
  const sources = new QuoteSources({
    zenquotes: { next: async () => zenOnline ? zen : null },
    english: { next: async () => extraOnline ? extra : null },
    arabic: { next: async () => arabic },
  });
  assert.deepEqual(await sources.next('ar', 1), arabic);
  assert.deepEqual(await sources.next('en', 2), zen);
  assert.deepEqual(await sources.next('en', 4), extra);
  extraOnline = false;
  assert.deepEqual(await sources.next('en', 4), zen);
  zenOnline = false;
  assert.equal(await sources.next('en', 2), null);
  assert.deepEqual(await sources.next('ar', 5), arabic);
});
