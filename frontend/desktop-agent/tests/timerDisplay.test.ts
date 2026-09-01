import assert from "node:assert/strict";
import test from "node:test";

import {
  mainTimerSeconds,
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
