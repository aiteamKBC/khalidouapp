import assert from "node:assert/strict";
import test from "node:test";

import { attendanceRefetchInterval, attendanceTabIsActive } from "./attendance-query-policy.ts";

test("hidden attendance tabs do not fetch", () => {
  assert.equal(attendanceTabIsActive("daily", "daily"), true);
  assert.equal(attendanceTabIsActive("daily", "employee-history"), false);
  assert.equal(attendanceTabIsActive("employee-history", "daily"), false);
});

test("pending materialization polls briefly only while its tab is visible", () => {
  assert.equal(
    attendanceRefetchInterval({ active: true, pendingRefreshCount: 3, isToday: true }),
    2_000,
  );
  assert.equal(
    attendanceRefetchInterval({ active: false, pendingRefreshCount: 3, isToday: true }),
    false,
  );
});

test("settled current attendance refreshes once per minute", () => {
  assert.equal(
    attendanceRefetchInterval({ active: true, pendingRefreshCount: 0, isToday: true }),
    60_000,
  );
  assert.equal(
    attendanceRefetchInterval({ active: true, pendingRefreshCount: 0, isToday: false }),
    false,
  );
});
