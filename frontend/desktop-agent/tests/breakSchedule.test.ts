import assert from "node:assert/strict";
import test from "node:test";

import { breakStatusAt, todaysBreaks } from "../src/breakSchedule.ts";

const rules = [
  { name: "Short break", minutes: 15, paid: true, anchor: "asr", start_time: "16:15", end_time: "16:30" },
  { name: "Lunch", minutes: 30, paid: true, anchor: "dhuhr", start_time: "12:48", end_time: "13:18" },
  { name: "Tea", minutes: 10, paid: false, start_time: "11:00:00", end_time: "11:10:00" },
  { name: "Unresolved", minutes: 15, paid: true, anchor: "asr" },
];

test("lists today's breaks in time order with their prayer", () => {
  const breaks = todaysBreaks(rules);
  assert.deepEqual(
    breaks.map((item) => [item.name, item.start, item.end, item.prayer]),
    [
      ["Tea", "11:00", "11:10", null],
      ["Lunch", "12:48", "13:18", "Dhuhr"],
      ["Short break", "16:15", "16:30", "Asr"],
    ],
  );
});

test("finds the running and the next break", () => {
  const breaks = todaysBreaks(rules);
  const during = breakStatusAt(breaks, 12 * 60 + 50);
  assert.equal(during.current?.name, "Lunch");
  assert.equal(during.next?.name, "Short break");
  const after = breakStatusAt(breaks, 17 * 60);
  assert.equal(after.current, null);
  assert.equal(after.next, null);
});

test("no policy means no breaks", () => {
  assert.deepEqual(todaysBreaks(null), []);
});
