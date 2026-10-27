import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeDueQuote,
  defaultQuoteSettings,
  readQuoteSettings,
  loadQuoteSettings,
  validQuoteMinutes,
  quoteAt,
  quoteAttribution,
  translateQuote,
} from "./quote-reminders.ts";

test("reminders default to enabled with the first quote after one hour", () => {
  const now = 1000;
  const defaults = defaultQuoteSettings(now);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.minutes, 60);
  assert.equal(defaults.nextAt, now + 60 * 60_000);
  assert.equal(consumeDueQuote(defaults, now), null);
  assert.equal(consumeDueQuote(defaults, defaults.nextAt - 1), null);
  assert.ok(consumeDueQuote(defaults, defaults.nextAt));
  for (const raw of [null, "broken", "{}", JSON.stringify({ ...defaults, nextAt: 0 })]) {
    assert.deepEqual(readQuoteSettings(raw, now), defaults);
  }
  for (const minutes of [0, -1, 1.5, 1441, NaN, Infinity])
    assert.equal(validQuoteMinutes(minutes), false);
  for (const minutes of [1, 17, 1440]) assert.equal(validQuoteMinutes(minutes), true);
});

test("initialization persists one deadline across polling and reloads", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const first = loadQuoteSettings(storage, "employee-A", 1000);
  assert.equal(first.enabled, true);
  assert.deepEqual(loadQuoteSettings(storage, "employee-A", 2000), first);
  assert.deepEqual(loadQuoteSettings(storage, "employee-A", first.nextAt), first);
  assert.ok(consumeDueQuote(loadQuoteSettings(storage, "employee-A", first.nextAt), first.nextAt));
  const disabled = { ...first, enabled: false, nextAt: 0 };
  storage.setItem("employee-A", JSON.stringify(disabled));
  assert.deepEqual(loadQuoteSettings(storage, "employee-A", 10_000_000), disabled);
  assert.equal(consumeDueQuote(disabled, 10_000_000), null);
  assert.equal(loadQuoteSettings(storage, "employee-B", 1000).enabled, true);
  assert.deepEqual(loadQuoteSettings(storage, "employee-A", 1000), disabled);
});

test("one overdue quote schedules from now and does not replay missed intervals", () => {
  const settings = { ...defaultQuoteSettings(), enabled: true, minutes: 17, nextAt: 1000 };
  assert.equal(consumeDueQuote(settings, 999), null);
  const now = 10_000_000;
  const due = consumeDueQuote(settings, now)!;
  assert.equal(due.settings.nextAt, now + 17 * 60_000);
  assert.equal(due.settings.sequence, 1);
  assert.equal(consumeDueQuote(due.settings, now), null);
  assert.deepEqual(readQuoteSettings(JSON.stringify(due.settings)), due.settings);
});

test("language selection and rotation remain valid across a complete cycle", () => {
  assert.match(quoteAt("ar", 0), /[\u0600-\u06ff]/);
  assert.match(quoteAt("en", 0), /^[A-Za-z]/);
  assert.match(quoteAt("both", 0), /[\u0600-\u06ff]/);
  assert.match(quoteAt("both", 1), /^[A-Za-z]/);
  let settings = { ...defaultQuoteSettings(), enabled: true, nextAt: 1 };
  for (let i = 0; i < 48; i++) {
    const due = consumeDueQuote(settings, settings.nextAt)!;
    assert.ok(due.text.length > 0);
    settings = due.settings;
    assert.deepEqual(readQuoteSettings(JSON.stringify(settings)), settings);
  }
  assert.equal(settings.sequence, 0);
});

test("each quote translates to the same quote in the other language and back", () => {
  for (const language of ["ar", "en", "both"] as const) {
    for (let sequence = 0; sequence < 24; sequence++) {
      const original = quoteAt(language, sequence);
      const translated = translateQuote(original);
      assert.notEqual(translated, original);
      assert.equal(translateQuote(translated), original);
      assert.equal(/[\u0600-\u06ff]/.test(translated), !/[\u0600-\u06ff]/.test(original));
    }
  }
  assert.equal(translateQuote(quoteAt("ar", 0)), "I have no special talent, I am only passionately curious.");
  assert.equal(translateQuote("Unknown quote"), "Unknown quote");
});

test("every reminder retains its author and source when translated", () => {
  const authors = new Set<string>();
  for (let sequence = 0; sequence < 12; sequence++) {
    const arabic = quoteAt("ar", sequence);
    const english = translateQuote(arabic);
    const ar = quoteAttribution(arabic)!;
    const en = quoteAttribution(english)!;
    assert.equal(ar.language, "ar");
    assert.equal(en.language, "en");
    assert.match(ar.author, /[\u0600-\u06ff]/);
    assert.match(en.author, /^[A-Za-z]/);
    assert.equal(ar.source, en.source);
    assert.equal(new URL(en.source).protocol, "https:");
    assert.ok(arabic.length <= 500 && english.length <= 500);
    authors.add(en.author);
  }
  assert.equal(authors.size, 12);
  assert.equal(quoteAttribution("Unknown quote"), null);
});
