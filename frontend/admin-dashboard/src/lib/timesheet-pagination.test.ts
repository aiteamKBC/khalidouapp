import assert from "node:assert/strict";
import test from "node:test";

import { paginateRows } from "./timesheet-pagination.ts";

test("timesheet pagination exposes every employee across visible pages", () => {
  const employees = Array.from({ length: 75 }, (_, index) => index + 1);
  const first = paginateRows(employees, 0, 50);
  const second = paginateRows(employees, 1, 50);

  assert.deepEqual(first.rows, employees.slice(0, 50));
  assert.deepEqual(second.rows, employees.slice(50));
  assert.equal(first.totalPages, 2);
  assert.equal(second.start, 50);
  assert.equal(second.end, 75);
});

test("timesheet pagination clamps a stale page after filters change", () => {
  const page = paginateRows(["only result"], 4, 50);

  assert.equal(page.page, 0);
  assert.deepEqual(page.rows, ["only result"]);
});
