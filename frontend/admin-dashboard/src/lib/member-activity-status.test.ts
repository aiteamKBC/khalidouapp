import assert from "node:assert/strict";
import test from "node:test";

import { matchesMemberActivityFilter, memberActivitySummary } from "./member-activity-status.ts";

test("active member activity includes work performed during a scheduled break", () => {
  assert.equal(matchesMemberActivityFilter("active", "active"), true);
  assert.equal(matchesMemberActivityFilter("break_work", "active"), true);
  assert.equal(matchesMemberActivityFilter("on_break", "active"), false);
});

test("idle member activity includes locked and sleeping sessions", () => {
  for (const status of ["idle", "locked", "sleeping"] as const) {
    assert.equal(matchesMemberActivityFilter(status, "idle"), true);
  }
  assert.equal(matchesMemberActivityFilter("active", "idle"), false);
});

test("specific member activity filters remain exact", () => {
  assert.equal(matchesMemberActivityFilter("on_break", "on_break"), true);
  assert.equal(matchesMemberActivityFilter("off_shift", "off_shift"), true);
  assert.equal(matchesMemberActivityFilter("offline", "offline"), true);
  assert.equal(matchesMemberActivityFilter("active", "all"), true);
  assert.equal(matchesMemberActivityFilter("offline", "all"), true);
});

test("member activity copy makes the total distinct from the six previews", () => {
  assert.deepEqual(memberActivitySummary("active", 27, 6), {
    total: "27 active members",
    preview: "Showing 6 random previews",
  });
});
