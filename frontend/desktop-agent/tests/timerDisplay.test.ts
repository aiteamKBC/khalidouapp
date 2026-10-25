import assert from "node:assert/strict";
import test from "node:test";

import {
  mainTimerSeconds,
  paidBreakSecondsToday,
  reconciledNormalTodaySeconds,
} from "../src/timerDisplay.ts";

test("the paid-shift timer shows the full day after a same-day restart", () => {
  assert.equal(
    mainTimerSeconds({
      isAutomaticIdle: false,
      isExtraTime: false,
      currentIdleSeconds: 0,
      extraSeconds: 0,
      trackedTodaySeconds: 3 * 60 * 60 + 59 * 60,
    }),
    3 * 60 * 60 + 59 * 60,
  );
});

test("idle and overtime keep their dedicated timer values", () => {
  assert.equal(
    mainTimerSeconds({
      isAutomaticIdle: true,
      isExtraTime: false,
      currentIdleSeconds: 95,
      extraSeconds: 0,
      trackedTodaySeconds: 4 * 60 * 60,
    }),
    95,
  );
  assert.equal(
    mainTimerSeconds({
      isAutomaticIdle: false,
      isExtraTime: true,
      currentIdleSeconds: 0,
      extraSeconds: 20 * 60,
      trackedTodaySeconds: 4 * 60 * 60,
    }),
    20 * 60,
  );
});

test("the normal total catches up with today's accumulated work", () => {
  assert.equal(
    reconciledNormalTodaySeconds({
      normalSeconds: 15 * 60,
      extraSeconds: 0,
      manualApprovedSeconds: 0,
      trackedTodaySeconds: 3 * 60 * 60 + 59 * 60,
    }),
    3 * 60 * 60 + 59 * 60,
  );
});

test("overtime and approved manual time are not added to normal twice", () => {
  assert.equal(
    reconciledNormalTodaySeconds({
      normalSeconds: 3 * 60 * 60,
      extraSeconds: 30 * 60,
      manualApprovedSeconds: 15 * 60,
      trackedTodaySeconds: 3 * 60 * 60 + 45 * 60,
    }),
    3 * 60 * 60,
  );
});

test("paid break time is added to the paid-shift timer only", () => {
  const base = {
    isAutomaticIdle: false,
    isExtraTime: false,
    currentIdleSeconds: 0,
    extraSeconds: 20 * 60,
    trackedTodaySeconds: 4 * 60 * 60,
    paidBreakSeconds: 30 * 60,
  };
  assert.equal(mainTimerSeconds(base), 4 * 60 * 60 + 30 * 60);
  assert.equal(mainTimerSeconds({ ...base, isExtraTime: true }), 20 * 60);
  assert.equal(mainTimerSeconds({ ...base, isAutomaticIdle: true, currentIdleSeconds: 9 }), 9);
});

test("only paid break blocks count, and the running break grows live", () => {
  const at = (clock: string) => `2026-10-25T${clock}:00.000Z`;
  const intervals = [
    { type: "break", started_at: at("13:00"), duration_seconds: 1800, is_current: false, break_paid: true },
    { type: "break", started_at: at("14:00"), duration_seconds: 900, is_current: false, break_paid: false },
    { type: "worked", started_at: at("14:15"), duration_seconds: 7200, is_current: false, break_paid: null },
    { type: "break", started_at: at("16:30"), duration_seconds: 60, is_current: true, break_paid: true },
  ];
  const now = Date.parse(at("16:40"));
  const breakEnds = Date.parse(at("16:45"));
  assert.equal(paidBreakSecondsToday(intervals, now, breakEnds), 1800 + 600);
  // Past the end of the break the live part stops at the break end.
  assert.equal(
    paidBreakSecondsToday(intervals, Date.parse(at("16:50")), breakEnds),
    1800 + 900,
  );
  // No running break: use the durations the server sent.
  assert.equal(paidBreakSecondsToday(intervals, now, null), 1800 + 60);
});
