import assert from "node:assert/strict";
import test from "node:test";

import { resolveInitialLoadState } from "./async-load-state.ts";

// R2: a failed initial load must not stay on "loading" forever.

test("data present renders the form", () => {
  assert.equal(
    resolveInitialLoadState({ hasData: true, isError: false }),
    "ready",
  );
});

test("no data and no error is loading", () => {
  assert.equal(
    resolveInitialLoadState({ hasData: false, isError: false }),
    "loading",
  );
});

test("a failed load surfaces a recoverable error, not endless loading", () => {
  assert.equal(
    resolveInitialLoadState({ hasData: false, isError: true, errorStatus: 500 }),
    "error",
  );
  assert.equal(
    resolveInitialLoadState({ hasData: false, isError: true }),
    "error",
  );
});

test("a 403 is a distinct permission-denied state", () => {
  assert.equal(
    resolveInitialLoadState({ hasData: false, isError: true, errorStatus: 403 }),
    "denied",
  );
});
