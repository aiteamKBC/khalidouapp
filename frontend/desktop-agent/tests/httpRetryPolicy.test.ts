import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isReplayable,
  isTransientTransportError,
} from "../electron/services/httpRetryPolicy.ts";

test("a dropped/unanswered connection is treated as transient", () => {
  for (const code of [
    "ECONNABORTED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "EAI_AGAIN",
  ]) {
    assert.equal(isTransientTransportError({ code, response: undefined }), true, code);
  }
});

test("an HTTP response is the server's answer and is never retried", () => {
  // Even a 503 came back from the app; replaying it could double-apply work.
  assert.equal(
    isTransientTransportError({ code: "ERR_BAD_RESPONSE", response: { status: 503 } as never }),
    false,
  );
});

test("an unknown error code is not treated as a retryable transport failure", () => {
  assert.equal(isTransientTransportError({ code: "EUNRELATED", response: undefined }), false);
});

test("idempotent reads are replayable", () => {
  assert.equal(isReplayable({ method: "get" }), true);
  assert.equal(isReplayable({ method: "GET" }), true);
  assert.equal(isReplayable({ method: "head" }), true);
  assert.equal(isReplayable({}), true); // axios defaults to GET
});

test("heartbeats and events are replayable via their event id", () => {
  assert.equal(
    isReplayable({ method: "post", data: { event_id: "abc", status: "active" } }),
    true,
  );
  assert.equal(
    isReplayable({ method: "post", data: JSON.stringify({ idempotency_key: "k1" }) }),
    true,
  );
});

test("a plain POST without an idempotency key is NOT replayed", () => {
  // Creating a task must never be silently doubled by a transport retry.
  assert.equal(
    isReplayable({ method: "post", data: { name: "Write report", project_id: "p1" } }),
    false,
  );
  assert.equal(isReplayable({ method: "patch", data: { status: "done" } }), false);
});

test("a streamed multipart upload body is not misread as replayable", () => {
  const formLike = { constructor: { name: "FormData" } };
  assert.equal(isReplayable({ method: "post", data: formLike }), false);
});
