import assert from "node:assert/strict";
import test from "node:test";
import { TrackingClock } from "../electron/services/trackingClock.ts";

test("server calibration corrects a PC reporting the wrong date", () => {
  const server = Date.parse("2026-11-27T10:00:00Z");
  for (const offset of [-3, 3]) {
    const clock = new TrackingClock(() => server + offset * 86400_000, () => 1000);
    assert.equal(clock.synchronized, false, "an unsynchronized PC clock is never server time");
    clock.observeServerTime("Fri, 27 Nov 2026 10:00:00 GMT");
    assert.equal(clock.synchronized, true);
    assert.equal(clock.nowMs(), server);
  }
});

test("changing Windows time forwards or backwards cannot change tracked UTC", () => {
  let wall = Date.parse("2026-11-27T10:00:00Z");
  let elapsed = 1000;
  const clock = new TrackingClock(() => wall, () => elapsed);
  clock.observeServerTime(new Date(wall).toISOString());
  const start = clock.nowMs();
  wall += 3 * 86400_000;
  elapsed += 60_000;
  assert.equal(clock.nowMs(), start + 60_000);
  wall -= 5 * 86400_000;
  elapsed += 60_000;
  assert.equal(clock.nowMs(), start + 120_000);
});

test("server-anchored offline time still crosses midnight in the country timezone", () => {
  let elapsed = 0;
  const clock = new TrackingClock(() => 0, () => elapsed);
  clock.observeServerTime("2026-11-26T21:59:30Z");
  elapsed += 60_000;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(clock.nowMs()));
  assert.equal(parts, "2026-11-27");
});

test("HTTP date rounding cannot rewind the tracking clock", () => {
  let elapsed = 0;
  const clock = new TrackingClock(() => 0, () => elapsed);
  clock.observeServerTime("2026-11-27T10:00:00Z");
  elapsed = 1750;
  const before = clock.nowMs();
  clock.observeServerTime("Fri, 27 Nov 2026 10:00:01 GMT");
  assert.equal(clock.nowMs(), before);
});

test("invalid or absent server time cannot poison the clock", () => {
  const clock = new TrackingClock(() => 12345, () => 0);
  assert.equal(clock.observeServerTime(undefined), false);
  assert.equal(clock.observeServerTime("invalid"), false);
  assert.equal(clock.nowMs(), 12345);
});

test("a delayed response cannot rewind a calibrated clock into yesterday", () => {
  let elapsed = 0;
  const clock = new TrackingClock(() => 0, () => elapsed);
  clock.observeServerTime("2026-11-26T23:59:30Z");
  elapsed = 60_000;
  const before = clock.nowMs();
  assert.equal(clock.observeServerTime("2026-11-26T23:59:30Z"), false);
  assert.equal(clock.nowMs(), before);
});
