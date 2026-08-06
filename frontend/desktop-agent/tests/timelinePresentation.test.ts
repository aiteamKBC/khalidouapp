import assert from "node:assert/strict";
import test from "node:test";

import {
  TIMELINE_LABELS,
  timelineIntervalsForDisplay,
  timelineIntervalPresentation,
  timelineDisplayType,
  workdayTimingState,
} from "../src/timelinePresentation.ts";

test("the employee timeline keeps intervals from the start of the day", () => {
  const intervals = Array.from({ length: 9 }, (_, index) => `interval-${index + 1}`);

  assert.deepEqual(timelineIntervalsForDisplay(intervals), intervals);
});

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

test("missing device evidence has a visible untracked label", () => {
  assert.equal(timelineDisplayType("untracked", false), "untracked");
  assert.equal(TIMELINE_LABELS.untracked, "Untracked");
});

test("a locally ended idle interval stops counting before the server refresh returns", () => {
  const presentation = timelineIntervalPresentation(
    {
      type: "idle",
      started_at: "2026-07-30T11:28:00.000Z",
      ended_at: null,
      duration_seconds: 0,
      is_current: true,
    },
    "2026-07-30T11:28:02.900Z",
  );

  assert.deepEqual(presentation, {
    isCurrent: false,
    endedAt: "2026-07-30T11:28:02.900Z",
    durationSeconds: 2,
  });
});

test("a local idle end never closes a later server idle interval", () => {
  const presentation = timelineIntervalPresentation(
    {
      type: "idle",
      started_at: "2026-07-30T11:29:00.000Z",
      ended_at: null,
      duration_seconds: 0,
      is_current: true,
    },
    "2026-07-30T11:28:02.900Z",
  );

  assert.equal(presentation.isCurrent, true);
  assert.equal(presentation.endedAt, null);
});

test("local tracking supplies a start boundary while the timeline is syncing", () => {
  assert.deepEqual(
    workdayTimingState({
      timelineStartedAt: null,
      timelineIsRunning: false,
      localSessionStartedAt: "2026-08-06T06:20:00.000Z",
      localTrackingActive: true,
    }),
    {
      startedAt: "2026-08-06T06:20:00.000Z",
      isRunning: true,
      localSyncPending: true,
    },
  );
});

test("the authoritative timeline replaces the local sync fallback", () => {
  assert.deepEqual(
    workdayTimingState({
      timelineStartedAt: "2026-08-06T06:19:58.000Z",
      timelineIsRunning: true,
      localSessionStartedAt: "2026-08-06T06:20:00.000Z",
      localTrackingActive: true,
    }),
    {
      startedAt: "2026-08-06T06:19:58.000Z",
      isRunning: true,
      localSyncPending: false,
    },
  );
});
