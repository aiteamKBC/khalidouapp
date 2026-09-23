import assert from "node:assert/strict";
import test from "node:test";

import { breakWindowAt, idleSecondsOutsideBreaks } from "../electron/services/breakWindows.ts";

const minute = 60_000;
const lunch = { name: "Lunch", startMs: 60 * minute, endMs: 90 * minute };

test("idle entirely inside a break counts as zero idle", () => {
  assert.equal(idleSecondsOutsideBreaks(65 * minute, 85 * minute, [lunch]), 0);
});

test("idle that continues after the break only counts the time after it", () => {
  assert.equal(idleSecondsOutsideBreaks(70 * minute, 100 * minute, [lunch]), 10 * 60);
});

test("idle that starts before a break excludes the break minutes", () => {
  assert.equal(idleSecondsOutsideBreaks(50 * minute, 100 * minute, [lunch]), 20 * 60);
});

test("idle with no break overlap is unchanged", () => {
  assert.equal(idleSecondsOutsideBreaks(0, 30 * minute, [lunch]), 30 * 60);
});

test("breakWindowAt finds the running break", () => {
  assert.equal(breakWindowAt(75 * minute, [lunch])?.name, "Lunch");
  assert.equal(breakWindowAt(90 * minute, [lunch]), null);
});
