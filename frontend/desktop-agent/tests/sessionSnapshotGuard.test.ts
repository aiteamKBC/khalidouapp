import assert from "node:assert/strict";
import test from "node:test";

import { sessionSnapshotIsApplicable } from "../electron/services/sessionSnapshotGuard.ts";

test("a snapshot applies when its session is still current and enrollment unchanged", () => {
  assert.equal(
    sessionSnapshotIsApplicable({
      requestSessionId: "A",
      currentSessionId: "A",
      requestEnrollmentGeneration: 1,
      currentEnrollmentGeneration: 1,
    }),
    true,
  );
});

test("a stale snapshot is rejected after a task switch changed the session", () => {
  assert.equal(
    sessionSnapshotIsApplicable({
      requestSessionId: "A",
      currentSessionId: "B",
      requestEnrollmentGeneration: 1,
      currentEnrollmentGeneration: 1,
    }),
    false,
  );
});

test("a snapshot is rejected after logout/re-enrollment changed identity", () => {
  assert.equal(
    sessionSnapshotIsApplicable({
      requestSessionId: "A",
      currentSessionId: "A",
      requestEnrollmentGeneration: 1,
      currentEnrollmentGeneration: 2,
    }),
    false,
  );
});
