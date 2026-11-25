import assert from "node:assert/strict";
import test from "node:test";
import {
  ManualPauseReminder,
  PAUSE_REMINDER_DELAY_MS,
  PAUSE_REMINDER_REPEAT_MS,
  manualPauseEventDetails,
} from "../electron/services/manualPausePolicy.ts";

test("a forgotten pause prompts only after two minutes and fresh input", () => {
  const reminder = new ManualPauseReminder();
  const tick = (now: number, latestInputAt: number | null = now) =>
    reminder.shouldRemind({ paused: true, canPrompt: true, latestInputAt, now });
  assert.equal(tick(0), false);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS - 1), false);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS, null), false);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS, 0), false);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS), true);
});

test("staying paused snoozes the next prompt for fifteen minutes", () => {
  const reminder = new ManualPauseReminder();
  const tick = (now: number, canPrompt = true) =>
    reminder.shouldRemind({ paused: true, canPrompt, latestInputAt: now, now });
  tick(0);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS, false), false);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS), true);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS + PAUSE_REMINDER_REPEAT_MS - 1), false);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS + PAUSE_REMINDER_REPEAT_MS), true);
});

test("resuming resets the reminder so the next pause starts afresh", () => {
  const reminder = new ManualPauseReminder();
  const tick = (now: number, paused = true) =>
    reminder.shouldRemind({ paused, canPrompt: true, latestInputAt: now, now });
  tick(0);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS), true);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS + 1, false), false);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS + 2), false);
  assert.equal(tick(PAUSE_REMINDER_DELAY_MS * 2 + 2), true);
});

test("old or future input does not prompt and a pending alert is respected", () => {
  const reminder = new ManualPauseReminder();
  reminder.shouldRemind({ paused: true, canPrompt: true, latestInputAt: 0, now: 0 });
  for (const latestInputAt of [0, PAUSE_REMINDER_DELAY_MS + 1, null]) {
    assert.equal(reminder.shouldRemind({
      paused: true, canPrompt: true, latestInputAt, now: PAUSE_REMINDER_DELAY_MS,
    }), false);
  }
  assert.equal(reminder.shouldRemind({
    paused: true, canPrompt: false,
    latestInputAt: PAUSE_REMINDER_DELAY_MS, now: PAUSE_REMINDER_DELAY_MS,
  }), false);
});

test("pause events preserve their origin and a bounded readable reason", () => {
  assert.deepEqual(manualPauseEventDetails(), {
    source: "tracker_control", reason: "Employee paused tracking",
  });
  assert.deepEqual(manualPauseEventDetails({ source: "window_close", reason: "  Pause & Hide  " }), {
    source: "window_close", reason: "Pause & Hide",
  });
  assert.equal(manualPauseEventDetails("x".repeat(600)).reason.length, 500);
});
