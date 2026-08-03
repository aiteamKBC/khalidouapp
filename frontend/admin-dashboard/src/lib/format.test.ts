import assert from "node:assert/strict";
import test from "node:test";

import { formatDurationSeconds, formatSessionStatus } from "./format.ts";

test("short recorded intervals remain visible instead of rounding to zero minutes", () => {
  assert.equal(formatDurationSeconds(0), "0m");
  assert.equal(formatDurationSeconds(1), "1s");
  assert.equal(formatDurationSeconds(59), "59s");
  assert.equal(formatDurationSeconds(60), "1m");
  assert.equal(formatDurationSeconds(3665), "1h 1m");
});

test("an open session is never presented as a morning sign-out", () => {
  assert.equal(formatSessionStatus(true, null, "Africa/Cairo"), "Still running - no sign-out yet");
  assert.equal(formatSessionStatus(false, null, "Africa/Cairo"), "No sign-out recorded");
  assert.equal(formatSessionStatus(false, "2026-08-03T09:30:00Z", "UTC"), "Signed out 9:30 AM");
});
