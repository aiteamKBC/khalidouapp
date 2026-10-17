import assert from "node:assert/strict";
import test from "node:test";

import { breakWindow, describeBreakTiming } from "./break-rules.ts";

test("fixed breaks keep their clock times", () => {
  const rule = { anchor: "fixed", minutes: 30, start_time: "13:00:00", end_time: "13:30:00" };
  assert.deepEqual(breakWindow(rule), { start: "13:00", end: "13:30" });
  assert.equal(describeBreakTiming(rule), "13:00–13:30 · 30 min");
});

test("a break without clock times shows a dash", () => {
  assert.equal(breakWindow({ start_time: null, end_time: null }), null);
  assert.equal(describeBreakTiming({ minutes: 15 }), "— · 15 min");
});
