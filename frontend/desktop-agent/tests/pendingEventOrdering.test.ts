import assert from "node:assert/strict";
import test from "node:test";

import {
  orderedDuePendingEvents,
  sessionGroupForEndpoint,
} from "../electron/services/pendingEventOrdering.ts";

test("session endpoints group by their session id", () => {
  assert.equal(
    sessionGroupForEndpoint("/agent/sessions/A/events"),
    "A",
  );
  assert.equal(
    sessionGroupForEndpoint("/agent/sessions/A/heartbeat"),
    "A",
  );
  assert.equal(
    sessionGroupForEndpoint("/agent/sessions/B/end"),
    "B",
  );
});

test("a backed-off predecessor blocks its session's later events", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  const events = [
    {
      id: "pause",
      endpoint: "/agent/sessions/A/events",
      nextAttemptAt: "2026-09-10T12:05:00Z", // backed off
    },
    {
      id: "resume",
      endpoint: "/agent/sessions/A/events",
      nextAttemptAt: "2026-09-10T11:59:00Z", // due now
    },
  ];
  const due = orderedDuePendingEvents(events, { now, limit: 25 }).map(
    (e) => e.id,
  );
  assert.deepEqual(
    due,
    [],
    "resume must not overtake its backed-off predecessor pause",
  );
});

test("an independent session is not blocked by another's backoff", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  const events = [
    {
      id: "a-pause",
      endpoint: "/agent/sessions/A/events",
      nextAttemptAt: "2026-09-10T12:05:00Z",
    },
    {
      id: "b-heartbeat",
      endpoint: "/agent/sessions/B/heartbeat",
      nextAttemptAt: "2026-09-10T11:59:00Z",
    },
  ];
  const due = orderedDuePendingEvents(events, { now, limit: 25 }).map(
    (e) => e.id,
  );
  assert.deepEqual(due, ["b-heartbeat"], "session B may progress independently");
});

test("force delivers the whole chain in creation order", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  const events = [
    {
      id: "pause",
      endpoint: "/agent/sessions/A/events",
      nextAttemptAt: "2026-09-10T12:05:00Z",
    },
    {
      id: "resume",
      endpoint: "/agent/sessions/A/events",
      nextAttemptAt: "2026-09-10T12:05:00Z",
    },
  ];
  const due = orderedDuePendingEvents(events, {
    now,
    force: true,
    limit: 25,
  }).map((e) => e.id);
  assert.deepEqual(due, ["pause", "resume"]);
});
