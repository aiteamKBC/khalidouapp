import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceAuthGeneration,
  currentAuthGeneration,
  isAuthGenerationStale,
} from "./auth-lifecycle.ts";

// W6: work started under one identity must detect a later logout so it never
// resurrects cleared credentials.

test("a captured generation stays fresh until a logout advances it", () => {
  const captured = currentAuthGeneration();
  assert.equal(isAuthGenerationStale(captured), false);
  advanceAuthGeneration();
  assert.equal(isAuthGenerationStale(captured), true);
});

test("work captured after a logout is not treated as stale", () => {
  advanceAuthGeneration();
  const captured = currentAuthGeneration();
  assert.equal(isAuthGenerationStale(captured), false);
  advanceAuthGeneration();
  assert.equal(isAuthGenerationStale(captured), true);
});
