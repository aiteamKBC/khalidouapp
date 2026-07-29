import assert from "node:assert/strict";
import test from "node:test";

import {
  TIMELINE_LABELS,
  timelineDisplayType,
} from "../src/timelinePresentation.ts";

test("scheduled break intervals have a visible timeline label", () => {
  assert.equal(timelineDisplayType("break", false), "break");
  assert.equal(TIMELINE_LABELS.break, "Break");
});

test("approved leave still overrides non-work timeline labels", () => {
  assert.equal(timelineDisplayType("break", true), "leave");
});

test("work performed during a scheduled break is distinguished", () => {
  assert.equal(
    timelineDisplayType("worked", false, "break_work"),
    "break_work",
  );
  assert.equal(TIMELINE_LABELS.break_work, "Worked during break");
});
