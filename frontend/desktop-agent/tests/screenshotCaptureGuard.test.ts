import assert from "node:assert/strict";
import test from "node:test";

import { captureRemainsEligible } from "../electron/services/screenshotCaptureGuard.ts";

test("a capture proceeds only when eligible and the generation is unchanged", () => {
  assert.equal(
    captureRemainsEligible({
      blockReasonNow: null,
      generationAtStart: 3,
      currentGeneration: 3,
    }),
    true,
  );
});

test("a live block reason cancels an in-flight capture", () => {
  assert.equal(
    captureRemainsEligible({
      blockReasonNow: "tracking_paused",
      generationAtStart: 3,
      currentGeneration: 3,
    }),
    false,
  );
});

test("a generation change cancels even a pause→resume cycle that reads eligible again", () => {
  assert.equal(
    captureRemainsEligible({
      blockReasonNow: null,
      generationAtStart: 3,
      currentGeneration: 4,
    }),
    false,
  );
});
