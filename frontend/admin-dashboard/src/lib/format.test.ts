import assert from "node:assert/strict";
import test from "node:test";

import { formatDurationSeconds } from "./format.ts";

test("short recorded intervals remain visible instead of rounding to zero minutes", () => {
  assert.equal(formatDurationSeconds(0), "0m");
  assert.equal(formatDurationSeconds(1), "1s");
  assert.equal(formatDurationSeconds(59), "59s");
  assert.equal(formatDurationSeconds(60), "1m");
  assert.equal(formatDurationSeconds(3665), "1h 1m");
});
