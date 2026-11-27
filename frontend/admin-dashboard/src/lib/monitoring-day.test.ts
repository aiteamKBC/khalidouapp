import assert from "node:assert/strict";
import test from "node:test";
import { monitoringDay, monitoringDaySearchValue } from "./monitoring-day.ts";

test("monitoring follows midnight in the employee's country", () => {
  assert.equal(
    monitoringDay(undefined, "Africa/Cairo", new Date("2026-11-26T21:59:59Z")),
    "2026-11-26",
  );
  assert.equal(
    monitoringDay(undefined, "Africa/Cairo", new Date("2026-11-26T22:00:00Z")),
    "2026-11-27",
  );
  assert.equal(
    monitoringDay(undefined, "Europe/London", new Date("2026-11-26T22:00:00Z")),
    "2026-11-26",
  );
});

test("an explicit historical day stays selected", () => {
  assert.equal(
    monitoringDay("2026-11-23", "Africa/Cairo", new Date("2026-11-27T10:00:00Z")),
    "2026-11-23",
  );
});

test("choosing today resumes following the current day instead of pinning its date", () => {
  const now = new Date("2026-11-27T10:00:00Z");
  assert.equal(monitoringDaySearchValue("2026-11-27", "Africa/Cairo", now), undefined);
  assert.equal(monitoringDaySearchValue(undefined, "Africa/Cairo", now), undefined);
  assert.equal(monitoringDaySearchValue("2026-11-23", "Africa/Cairo", now), "2026-11-23");
});
