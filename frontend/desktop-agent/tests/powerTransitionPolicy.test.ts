import assert from "node:assert/strict";
import test from "node:test";

import {
  physicalResumeShouldResumeWork,
  shouldAccrueTrackedTime,
} from "../electron/services/powerTransitionPolicy.ts";

test("physical resume only resumes work when nothing is paused or stopped", () => {
  assert.equal(
    physicalResumeShouldResumeWork({
      manualPauseActive: false,
      trackingStoppedByUser: false,
    }),
    true,
  );
  assert.equal(
    physicalResumeShouldResumeWork({
      manualPauseActive: true,
      trackingStoppedByUser: false,
    }),
    false,
  );
  assert.equal(
    physicalResumeShouldResumeWork({
      manualPauseActive: false,
      trackingStoppedByUser: true,
    }),
    false,
  );
});

test("accrual is blocked whenever the employee paused or stopped", () => {
  assert.equal(
    shouldAccrueTrackedTime({
      manualPauseActive: false,
      trackingStoppedByUser: false,
    }),
    true,
  );
  assert.equal(
    shouldAccrueTrackedTime({
      manualPauseActive: true,
      trackingStoppedByUser: false,
    }),
    false,
  );
  assert.equal(
    shouldAccrueTrackedTime({
      manualPauseActive: false,
      trackingStoppedByUser: true,
    }),
    false,
  );
});
