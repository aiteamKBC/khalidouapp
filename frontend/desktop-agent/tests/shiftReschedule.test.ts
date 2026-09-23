import assert from "node:assert/strict";
import test from "node:test";

import {
  addDaysToDateKey,
  rescheduleEndTime,
  shiftRescheduleStatusLabel,
  upcomingWorkingDates,
  validateShiftRescheduleInput,
  weekdayOfDateKey,
} from "../src/shiftReschedule.ts";

test("end time keeps the normal shift length", () => {
  assert.equal(rescheduleEndTime("10:00", 480), "18:00");
  assert.equal(rescheduleEndTime("07:30", 480), "15:30");
});

test("a shift reaching or crossing midnight has no valid end", () => {
  assert.equal(rescheduleEndTime("16:00", 480), null);
  assert.equal(rescheduleEndTime("17:00", 480), null);
  assert.equal(rescheduleEndTime("15:59", 480), "23:59");
  assert.equal(rescheduleEndTime("bad", 480), null);
});

test("weekday numbering matches Python (Monday = 0)", () => {
  assert.equal(weekdayOfDateKey("2026-09-21"), 0); // Monday
  assert.equal(weekdayOfDateKey("2026-09-23"), 2); // Wednesday
  assert.equal(weekdayOfDateKey("2026-09-27"), 6); // Sunday
  assert.equal(addDaysToDateKey("2026-09-30", 2), "2026-10-02");
});

test("upcoming dates skip non-working days", () => {
  // Friday (4) off.
  const dates = upcomingWorkingDates("2026-09-24", [0, 1, 2, 3, 5, 6], 3);
  assert.deepEqual(dates, ["2026-09-24", "2026-09-26", "2026-09-27"]);
  assert.deepEqual(upcomingWorkingDates("2026-09-24", [], 3), []);
});

test("form validation mirrors the backend rules", () => {
  const base = {
    workDate: "2026-09-25",
    start: "10:00",
    reason: "Doctor",
    earliestDate: "2026-09-25",
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    shiftMinutes: 480,
    normalStart: "09:00",
  };
  assert.equal(validateShiftRescheduleInput(base), null);
  assert.match(
    validateShiftRescheduleInput({ ...base, workDate: "2026-09-24" }) ?? "",
    /2 days ahead/,
  );
  assert.match(
    validateShiftRescheduleInput({ ...base, workingDays: [0] }) ?? "",
    /working day/,
  );
  assert.match(
    validateShiftRescheduleInput({ ...base, start: "17:00" }) ?? "",
    /same day/,
  );
  assert.match(
    validateShiftRescheduleInput({ ...base, start: "09:00" }) ?? "",
    /same as your normal/,
  );
  assert.match(
    validateShiftRescheduleInput({ ...base, reason: "  " }) ?? "",
    /reason/,
  );
});

test("expired requests explain the normal shift applied", () => {
  assert.match(shiftRescheduleStatusLabel("expired"), /normal shift/);
});
