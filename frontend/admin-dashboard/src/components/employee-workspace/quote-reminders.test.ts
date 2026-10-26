import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeDueQuote,
  defaultQuoteSettings,
  readQuoteSettings,
  validQuoteMinutes,
  quoteAt,
} from "./quote-reminders.ts";

test("reminders require opt-in and a valid saved deadline", () => {
  assert.equal(consumeDueQuote(defaultQuoteSettings(), Date.now()), null);
  for (const raw of [
    null,
    "broken",
    "{}",
    JSON.stringify({ ...defaultQuoteSettings(), enabled: true }),
  ]) {
    assert.deepEqual(readQuoteSettings(raw), defaultQuoteSettings());
  }
  for (const minutes of [0, -1, 1.5, 1441, NaN, Infinity])
    assert.equal(validQuoteMinutes(minutes), false);
  for (const minutes of [1, 17, 1440]) assert.equal(validQuoteMinutes(minutes), true);
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
