// Behavior test for Bug 5: a 401 during queued event replay must NOT delete the
// recorded work. Runs the real syncPendingQueuesOnce against a real sql.js queue.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import vm from "node:vm";

import {
  databaseContext,
  functions,
  moduleSource,
  cleanupTemporaryDirectories,
} from "./support/mainHarness.ts";

after(cleanupTemporaryDirectories);

test("a 401 during replay retains the queued heartbeat and suspends the pass", async () => {
  const c = (await databaseContext()) as unknown as vm.Context &
    Record<string, unknown> & {
      enqueuePendingEvent: (o: Record<string, unknown>) => void;
      syncPendingQueuesOnce: (force: boolean) => Promise<void>;
      getDuePendingEvents: (l: number, o: { force: boolean }) => unknown[];
    };
  c.enqueuePendingEvent({
    id: "work",
    method: "POST",
    endpoint: "/agent/sessions/A/heartbeat",
    payload: { active_seconds: 600 },
    idempotencyKey: "work",
  });
  moduleSource(c, "electron/services/pendingSyncPolicy.ts");
  moduleSource(c, "electron/services/runtimePolicies.ts");
  functions(c, "syncPendingQueuesOnce");
  (c as Record<string, unknown>).sendQueuedRequest = async () => {
    throw Object.assign(new Error("token rejected"), { status: 401 });
  };
  (c as Record<string, unknown>).apiResponseStatus = (e: { status?: number }) =>
    e?.status;
  (c as Record<string, unknown>).apiErrorCode = () => undefined;
  (c as Record<string, unknown>).cleanupTerminalScreenshotFiles = () => {};

  await c.syncPendingQueuesOnce(true);

  assert.equal(
    c.getDuePendingEvents(25, { force: true }).length,
    1,
    "the queued heartbeat must survive an authentication failure",
  );
  const remaining = vm.runInContext(
    "rows('select * from pending_events').length",
    c,
  );
  assert.equal(remaining, 1, "the row must not be deleted or marked dead");
});

test("a 400 payload rejection still retires the event", async () => {
  const c = (await databaseContext()) as unknown as vm.Context &
    Record<string, unknown> & {
      enqueuePendingEvent: (o: Record<string, unknown>) => void;
      syncPendingQueuesOnce: (force: boolean) => Promise<void>;
    };
  c.enqueuePendingEvent({
    id: "bad",
    method: "POST",
    endpoint: "/agent/sessions/A/events",
    payload: { junk: true },
    idempotencyKey: "bad",
  });
  moduleSource(c, "electron/services/pendingSyncPolicy.ts");
  moduleSource(c, "electron/services/runtimePolicies.ts");
  functions(c, "syncPendingQueuesOnce");
  (c as Record<string, unknown>).sendQueuedRequest = async () => {
    throw Object.assign(new Error("invalid"), { status: 400 });
  };
  (c as Record<string, unknown>).apiResponseStatus = (e: { status?: number }) =>
    e?.status;
  (c as Record<string, unknown>).apiErrorCode = () => undefined;
  (c as Record<string, unknown>).cleanupTerminalScreenshotFiles = () => {};

  await c.syncPendingQueuesOnce(true);

  const dead = vm.runInContext(
    "rows(\"select * from pending_events where status = 'dead'\").length",
    c,
  );
  assert.equal(dead, 1, "a definitively invalid payload is retired as dead");
});
