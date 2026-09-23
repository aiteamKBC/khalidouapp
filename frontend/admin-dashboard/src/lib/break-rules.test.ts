import assert from "node:assert/strict";
import test from "node:test";

import { addMinutesToClock, breakWindow, describeBreakTiming } from "./break-rules.ts";

const today = { date: "2026-09-23", dhuhr: "12:48", asr: "16:15" };

test("prayer breaks start at the adhan and last their minutes", () => {
  assert.deepEqual(breakWindow({ anchor: "dhuhr", minutes: 30 }, today), {
    start: "12:48",
    end: "13:18",
  });
  assert.deepEqual(breakWindow({ anchor: "asr", minutes: 15 }, today), {
    start: "16:15",
    end: "16:30",
  });
  assert.equal(breakWindow({ anchor: "asr", minutes: 15 }, null), null);
});

test("fixed breaks keep their clock times", () => {
  const rule = { anchor: "fixed", minutes: 30, start_time: "13:00:00", end_time: "13:30:00" };
  assert.deepEqual(breakWindow(rule, today), { start: "13:00", end: "13:30" });
  assert.equal(describeBreakTiming(rule, today), "13:00–13:30 · 30 min");
});

test("describes prayer breaks with today's times", () => {
  assert.equal(
    describeBreakTiming({ anchor: "dhuhr", minutes: 30 }, today),
    "From Dhuhr adhan · 30 min (today 12:48–13:18)",
  );
  assert.equal(describeBreakTiming({ anchor: "asr", minutes: 15 }), "From Asr adhan · 15 min");
});

test("clock arithmetic wraps midnight", () => {
  assert.equal(addMinutesToClock("23:50", 15), "00:05");
});
