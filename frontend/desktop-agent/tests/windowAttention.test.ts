import assert from "node:assert/strict";
import test from "node:test";
import { context, functions } from "./support/mainHarness.ts";

function setup() {
  const state = { minimizedAllowed: false, closeAllowed: false, onTop: false, flashing: false };
  const c = context({
    idleAlertAttentionActive: false,
    updateAttentionActive: false,
    idleAttentionTimer: null,
    showMainWindow: () => {},
    mainWindow: {
      isDestroyed: () => false,
      setAlwaysOnTop: (value: boolean) => { state.onTop = value; },
      setMinimizable: (value: boolean) => { state.minimizedAllowed = value; },
      setClosable: (value: boolean) => { state.closeAllowed = value; },
      flashFrame: (value: boolean) => { state.flashing = value; },
      show: () => {}, moveTop: () => {}, focus: () => {},
    },
  });
  functions(c, "applyWindowAttention", "setIdleAlertAttention", "setUpdateAttention");
  return { c, state };
}

test("idle and update prompts keep the window minimizable and closable", () => {
  const { c, state } = setup();
  for (const action of [c.setIdleAlertAttention, c.setUpdateAttention]) {
    action(true);
    assert.equal(state.minimizedAllowed, true);
    assert.equal(state.closeAllowed, true);
    assert.equal(state.onTop, true);
    action(false);
  }
});

test("releasing one prompt preserves the other prompt's attention", () => {
  const { c, state } = setup();
  c.setIdleAlertAttention(true);
  c.setUpdateAttention(true);
  c.setIdleAlertAttention(false);
  assert.equal(state.onTop, true);
  assert.equal(state.flashing, true);
  c.setIdleAlertAttention(true);
  c.setUpdateAttention(false);
  assert.equal(state.onTop, true);
  c.setIdleAlertAttention(false);
  assert.equal(state.onTop, false);
  assert.equal(state.flashing, false);
  assert.equal(state.minimizedAllowed, true);
  assert.equal(state.closeAllowed, true);
});
