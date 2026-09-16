// Behavior test for Bug 6 against the real sql.js queue: a failed (backed-off)
// pause must not let a later resume become due, and delivering with force keeps
// creation order.
import assert from "node:assert/strict";
import test, { after } from "node:test";

import {
  databaseContext,
  cleanupTemporaryDirectories,
} from "./support/mainHarness.ts";

after(cleanupTemporaryDirectories);

type QueueCtx = Record<string, unknown> & {
  enqueuePendingEvent: (o: Record<string, unknown>) => void;
  markPendingEventFailed: (id: string, attempts: number) => void;
  getDuePendingEvents: (
    limit: number,
    options?: { force?: boolean },
  ) => Array<{ id: string }>;
};

test("a backed-off pause keeps its later resume out of the due set", async () => {
  const c = (await databaseContext()) as unknown as QueueCtx;
  for (const id of ["pause", "resume"]) {
    c.enqueuePendingEvent({
      id,
      method: "POST",
      endpoint: "/agent/sessions/A/events",
      payload: { event_type: id },
      idempotencyKey: id,
    });
  }
  // Pause fails and receives a future next_attempt_at.
  c.markPendingEventFailed("pause", 0);
  const due = c.getDuePendingEvents(25).map((e) => e.id);
  assert.equal(
    due.includes("resume"),
    false,
    "resume must not be deliverable while pause is backed off",
  );
});

test("force replays the chain in creation order", async () => {
  const c = (await databaseContext()) as unknown as QueueCtx;
  for (const id of ["pause", "resume", "end"]) {
    c.enqueuePendingEvent({
      id,
      method: "POST",
      endpoint: "/agent/sessions/A/events",
      payload: { event_type: id },
      idempotencyKey: id,
    });
  }
  c.markPendingEventFailed("pause", 0);
  const forced = c
    .getDuePendingEvents(25, { force: true })
    .map((e) => e.id)
    .join(",");
  assert.equal(forced, "pause,resume,end");
});
