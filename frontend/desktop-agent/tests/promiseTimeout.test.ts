import assert from "node:assert/strict";
import test from "node:test";

import {
  OperationTimeoutError,
  withOperationTimeout,
} from "../src/promiseTimeout.ts";

test("tracking controls resolve normally before the UI deadline", async () => {
  const result = await withOperationTimeout(Promise.resolve("resumed"), 50);
  assert.equal(result, "resumed");
});

test("tracking controls cannot leave the UI waiting forever", async () => {
  const neverSettles = new Promise<never>(() => undefined);
  await assert.rejects(
    withOperationTimeout(neverSettles, 10),
    OperationTimeoutError,
  );
});
