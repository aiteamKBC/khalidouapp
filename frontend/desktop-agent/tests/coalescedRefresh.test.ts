import assert from "node:assert/strict";
import test from "node:test";

import { createCoalescedRefresh } from "../electron/services/coalescedRefresh.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a refresh requested in flight waits for one trailing refresh", async () => {
  const runs: Array<ReturnType<typeof deferred>> = [];
  const refresh = createCoalescedRefresh(async () => {
    const run = deferred();
    runs.push(run);
    await run.promise;
  });

  const firstCaller = refresh();
  assert.equal(runs.length, 1);

  const secondCaller = refresh();
  const thirdCaller = refresh();
  assert.equal(runs.length, 1);

  runs[0].resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 2);

  let callersCompleted = false;
  void Promise.all([firstCaller, secondCaller, thirdCaller]).then(() => {
    callersCompleted = true;
  });
  await Promise.resolve();
  assert.equal(callersCompleted, false);

  runs[1].resolve();
  await Promise.all([firstCaller, secondCaller, thirdCaller]);
  assert.equal(callersCompleted, true);
  assert.equal(runs.length, 2);
});

test("a later refresh starts a new cycle after the prior cycle completes", async () => {
  let runCount = 0;
  const refresh = createCoalescedRefresh(async () => {
    runCount += 1;
  });

  await refresh();
  await refresh();

  assert.equal(runCount, 2);
});
