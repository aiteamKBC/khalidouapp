export const QUOTE_FEED_URL = "https://zenquotes.io/api/quotes";
export const BILINGUAL_QUOTE_FEED_BASE = "https://gitlab.com/api/v4/projects/Assayyaad%2Fquote-unquote/repository/files/";
export const QUOTE_FEED_TTL_MS = 60 * 60_000;
export const QUOTE_FEED_RETRY_MS = 5 * 60_000;

export type QuoteProvider = "zenquotes" | "quote-unquote";
export type QuoteFeedLanguage = "ar" | "en";
export type FeedQuote = { text: string; author: string; provider: QuoteProvider };
type FeedCache = { version: 1; fetchedAt: number; cursor: number; quotes: FeedQuote[]; provider?: QuoteProvider; language?: QuoteFeedLanguage };
type Options = {
  provider?: QuoteProvider;
  language?: QuoteFeedLanguage;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  random?: () => number;
  readCache?: () => unknown;
  writeCache?: (cache: FeedCache) => void;
};

export function quoteFeedUrl(provider: QuoteProvider, language: QuoteFeedLanguage) {
  return provider === "zenquotes" ? QUOTE_FEED_URL : `${BILINGUAL_QUOTE_FEED_BASE}data%2F${language}%2Fquotes.json/raw?ref=main`;
}

function cleanQuote(text: unknown, author: unknown, provider: QuoteProvider, language: QuoteFeedLanguage): FeedQuote | null {
  if (typeof text !== "string" || typeof author !== "string") return null;
  const normalizedText = text.trim().replace(/\s+/g, " ");
  const normalizedAuthor = author.trim().replace(/\s+/g, " ");
  if (!normalizedText || normalizedText.length > 500 || !normalizedAuthor || normalizedAuthor.length > 120 || /zenquotes\.io/i.test(normalizedAuthor)) return null;
  // Keep language caches separate even if a provider sends the wrong collection.
  if (/[\u0600-\u06ff]/.test(normalizedText) !== (language === "ar")) return null;
  return { text: normalizedText, author: normalizedAuthor, provider };
}

function uniqueQuotes(rows: unknown[], provider: QuoteProvider, language: QuoteFeedLanguage, stored = false): FeedQuote[] {
  const seen = new Set<string>();
  const result: FeedQuote[] = [];
  for (const row of rows.slice(0, 100)) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const quote = cleanQuote(
      stored || provider === "quote-unquote" ? value.text : value.q,
      stored ? value.author : provider === "quote-unquote" ? value.source : value.a,
      provider, language,
    );
    if (!quote) continue;
    const key = quote.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(quote);
    if (result.length === 50) break;
  }
  return result;
}

// Public quotes only: this client never uses the agent's authenticated API client.
// Fetch a batch once an hour, rotate locally, and keep serving cached quotes offline.
export class QuoteFeed {
  private cache: FeedCache = { version: 1, fetchedAt: 0, cursor: 0, quotes: [] };
  private loaded = false;
  private retryAt = 0;
  private refreshing: Promise<void> | null = null;
  private options: Options;
  private provider: QuoteProvider;
  private language: QuoteFeedLanguage;

  constructor(options: Options = {}) {
    this.options = options;
    this.provider = options.provider ?? "zenquotes";
    this.language = options.language ?? "en";
  }

  private now() { return this.options.now?.() ?? Date.now(); }

  private save() {
    try { this.options.writeCache?.(this.cache); } catch { /* Reminders still work with a read-only profile. */ }
  }

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const value = this.options.readCache?.() as Partial<FeedCache> | undefined;
      if (value?.version !== 1 || !Array.isArray(value.quotes) ||
          (value.provider ?? "zenquotes") !== this.provider || (value.language ?? "en") !== this.language ||
          !Number.isSafeInteger(value.fetchedAt) || value.fetchedAt! < 0 || value.fetchedAt! > this.now() ||
          !Number.isSafeInteger(value.cursor) || value.cursor! < 0) return;
      this.cache = { version: 1, provider: this.provider, language: this.language, fetchedAt: value.fetchedAt!, cursor: value.cursor!, quotes: uniqueQuotes(value.quotes, this.provider, this.language, true) };
    } catch { /* Missing/corrupt cache: fetch a fresh batch when a quote is due. */ }
  }

  private async refresh() {
    try {
      const response = await (this.options.fetch ?? globalThis.fetch)(quoteFeedUrl(this.provider, this.language), {
        signal: AbortSignal.timeout(4_000),
        headers: { Accept: "application/json" },
        credentials: "omit",
        redirect: "error",
      });
      if (!response.ok) throw new Error("Quote provider unavailable");
      const body = await response.text();
      if (body.length > 128_000) throw new Error("Quote response too large");
      const data: unknown = JSON.parse(body);
      const quotes = Array.isArray(data) ? uniqueQuotes(data, this.provider, this.language) : [];
      if (!quotes.length) throw new Error("No usable quotes");
      const last = this.cache.quotes.length
        ? this.cache.quotes[(this.cache.cursor + this.cache.quotes.length - 1) % this.cache.quotes.length]?.text
        : null;
      for (let index = quotes.length - 1; index > 0; index--) {
        const other = Math.floor((this.options.random?.() ?? Math.random()) * (index + 1));
        [quotes[index], quotes[other]] = [quotes[other], quotes[index]];
      }
      if (quotes.length > 1 && quotes[0].text === last) [quotes[0], quotes[1]] = [quotes[1], quotes[0]];
      this.cache = { version: 1, provider: this.provider, language: this.language, fetchedAt: this.now(), cursor: 0, quotes };
      this.save();
    } catch {
      // Includes timeouts, HTTP failures, and provider rate-limit messages.
      this.retryAt = this.now() + QUOTE_FEED_RETRY_MS;
    }
  }

  async next(): Promise<FeedQuote | null> {
    this.load();
    if ((!this.cache.quotes.length || this.now() - this.cache.fetchedAt >= QUOTE_FEED_TTL_MS) && this.now() >= this.retryAt) {
      this.refreshing ??= this.refresh().finally(() => { this.refreshing = null; });
      await this.refreshing;
    }
    if (!this.cache.quotes.length) return null;
    const quote = this.cache.quotes[this.cache.cursor % this.cache.quotes.length];
    this.cache.cursor = (this.cache.cursor + 1) % this.cache.quotes.length;
    this.save();
    return quote;
  }
}

type Feed = { next(): Promise<FeedQuote | null> };

export class QuoteSources {
  private feeds: { zenquotes: Feed; arabic: Feed; english: Feed };

  constructor(feeds: { zenquotes: Feed; arabic: Feed; english: Feed }) { this.feeds = feeds; }

  async next(language: QuoteFeedLanguage, sequence = 0): Promise<FeedQuote | null> {
    if (language === "ar") return this.feeds.arabic.next();
    // Scheduler sequences alternate Arabic/English. Alternate the two English
    // providers as well; direct/legacy calls default to ZenQuotes.
    const extraFirst = sequence > 0 && sequence % 4 === 0;
    const primary = extraFirst ? this.feeds.english : this.feeds.zenquotes;
    const secondary = extraFirst ? this.feeds.zenquotes : this.feeds.english;
    return await primary.next() ?? await secondary.next();
  }
}
