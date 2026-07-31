import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainSource = fs.readFileSync(
  new URL("../electron/main.ts", import.meta.url),
  "utf-8",
);
const rendererSource = fs.readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf-8",
);

function sourceBetween(start: string, end: string) {
  const startAt = mainSource.indexOf(start);
  const endAt = mainSource.indexOf(end, startAt + start.length);
  assert.notEqual(startAt, -1, `${start} was not found`);
  assert.notEqual(endAt, -1, `${end} was not found after ${start}`);
  return mainSource.slice(startAt, endAt);
}

test("manual pause is local-first and does not wait for API delivery", () => {
  const source = sourceBetween(
    "async function pauseTracking(",
    "async function resumeTracking()",
  );
  assert.match(source, /void dispatchManualPauseTransition/);
  assert.doesNotMatch(source, /await sendStateEvent/);
});

test("manual resume starts local tracking without waiting for backlog sync", () => {
  const source = sourceBetween(
    "async function resumeTracking()",
    "async function logoutDevice()",
  );
  assert.match(source, /void dispatchManualPauseTransition/);
  assert.match(source, /void startTrackingAutomatically\(\)/);
  assert.doesNotMatch(source, /await startTrackingAutomatically\(\)/);
});

test("renderer releases a tracking control that stops responding", () => {
  assert.match(rendererSource, /TRACKING_CONTROL_TIMEOUT_MS = 20_000/);
  assert.match(rendererSource, /withOperationTimeout\(/);
  assert.match(rendererSource, /finally \{\s*setIsChangingTracking\(false\)/);
});
