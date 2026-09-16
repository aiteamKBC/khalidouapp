import assert from "node:assert/strict";
import test from "node:test";

import { toValidDate } from "../src/safeDate.ts";

test("a valid ISO timestamp parses to a Date", () => {
  const date = toValidDate("2026-09-10T08:30:00.000Z");
  assert.ok(date instanceof Date);
  assert.equal(date?.toISOString(), "2026-09-10T08:30:00.000Z");
});

test("null / undefined / empty return null", () => {
  assert.equal(toValidDate(null), null);
  assert.equal(toValidDate(undefined), null);
  assert.equal(toValidDate(""), null);
});

test("a malformed timestamp returns null instead of an Invalid Date", () => {
  // The exact class of value that made Intl.format throw during render.
  assert.equal(toValidDate("2026-13-45"), null);
  assert.equal(toValidDate("not a date"), null);
});

test("the returned date is safe to pass to Intl.DateTimeFormat", () => {
  // Regression: a null-guarded formatter must never hand an Invalid Date to Intl.
  const date = toValidDate("2026-13-45");
  const formatted = date
    ? new Intl.DateTimeFormat("en-US").format(date)
    : "fallback";
  assert.equal(formatted, "fallback");
});
