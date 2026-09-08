import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TRACKING_TICK_MS,
  trackingTick,
} from "../electron/services/trackingTick.ts";

test("a normal one-second tick credits one second and advances the pointer", () => {
  const result = trackingTick(1_000, 2_000);
  assert.equal(result.elapsedSeconds, 1);
  assert.equal(result.nextTickMs, 2_000);
});

test("a sub-second tick credits nothing and keeps the pointer for carryover", () => {
  const result = trackingTick(1_000, 1_400);
  assert.equal(result.elapsedSeconds, 0);
  assert.equal(result.nextTickMs, 1_000);
});

test("only whole seconds advance the pointer so remainders carry over", () => {
  const result = trackingTick(1_000, 3_600);
  assert.equal(result.elapsedSeconds, 2);
  assert.equal(result.nextTickMs, 3_000);
});

test("a 13-hour hibernation gap is discarded, not banked as worked time", () => {
  const thirteenHoursMs = 13 * 60 * 60 * 1000;
  const result = trackingTick(0, thirteenHoursMs);
  assert.equal(result.elapsedSeconds, 0);
  // Pointer re-anchors to now so the frozen span is skipped.
  assert.equal(result.nextTickMs, thirteenHoursMs);
});

test("a delta just beyond the freeze threshold is discarded", () => {
  const result = trackingTick(0, MAX_TRACKING_TICK_MS + 1);
  assert.equal(result.elapsedSeconds, 0);
  assert.equal(result.nextTickMs, MAX_TRACKING_TICK_MS + 1);
});

test("a delta at the threshold is still counted", () => {
  const result = trackingTick(0, MAX_TRACKING_TICK_MS);
  assert.equal(result.elapsedSeconds, Math.floor(MAX_TRACKING_TICK_MS / 1000));
  assert.equal(result.nextTickMs, MAX_TRACKING_TICK_MS);
});

test("a backwards clock jump is discarded rather than crediting negative time", () => {
  const result = trackingTick(5_000, 4_000);
  assert.equal(result.elapsedSeconds, 0);
  assert.equal(result.nextTickMs, 4_000);
});
