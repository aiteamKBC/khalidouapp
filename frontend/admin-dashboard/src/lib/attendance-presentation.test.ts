import assert from "node:assert/strict";
import test from "node:test";

import {
  attendanceStatusBadges,
  buildAttendanceNotices,
  overtimeReviewExplanation,
} from "./attendance-presentation.ts";

test("late arrival and early leave are both presented as attendance statuses", () => {
  assert.deepEqual(
    attendanceStatusBadges({
      status: "late",
      deductibleLateSeconds: 32 * 60,
      earlyLeaveSeconds: 2 * 60 * 60,
    }),
    ["late", "left_early"],
  );
});

test("pending overtime is presented once and never described as rejected", () => {
  const notices = buildAttendanceNotices({
    issues: [{ code: "overtime_pending", seconds: 24_600 }],
    pendingManualSeconds: 0,
    pendingOvertimeSeconds: 24_600,
  });

  assert.deepEqual(notices, [
    {
      key: "overtime_pending",
      label: "Extra time pending approval",
      seconds: 24_600,
      tone: "extra",
    },
  ]);
});

test("idle after the paid grace is not described as unexplained", () => {
  const notices = buildAttendanceNotices({
    issues: [{ code: "unexplained_idle", seconds: 900 }],
    pendingManualSeconds: 0,
    pendingOvertimeSeconds: 0,
  });

  assert.equal(notices[0]?.label, "Deductible idle after grace");
});

test("an unscheduled day explains why all tracked time is extra", () => {
  assert.equal(
    overtimeReviewExplanation({
      issues: [{ code: "overtime_pending", seconds: 24_600 }],
      unapprovedOvertimeSeconds: 24_600,
      scheduledStartAt: null,
      scheduledEndAt: null,
    }),
    "No shift was scheduled for this date, so all tracked time is recorded as extra. It is waiting for review and has not been rejected.",
  );
});

test("scheduled pending extra is distinguished from a rejection", () => {
  assert.equal(
    overtimeReviewExplanation({
      issues: [{ code: "overtime_pending", seconds: 3_600 }],
      unapprovedOvertimeSeconds: 3_600,
      scheduledStartAt: "2026-08-02T09:00:00Z",
      scheduledEndAt: "2026-08-02T17:00:00Z",
    }),
    "This extra time is waiting for review and has not been rejected.",
  );
});

test("a rejected overtime decision is presented as rejected instead of pending", () => {
  const notices = buildAttendanceNotices({
    issues: [{ code: "overtime_rejected", seconds: 3_600 }],
    pendingManualSeconds: 0,
    pendingOvertimeSeconds: 3_600,
  });

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.label, "Extra time rejected");
  assert.equal(
    overtimeReviewExplanation({
      issues: [{ code: "overtime_rejected", seconds: 3_600 }],
      unapprovedOvertimeSeconds: 3_600,
      scheduledStartAt: "2026-08-02T09:00:00Z",
      scheduledEndAt: "2026-08-02T17:00:00Z",
    }),
    "This extra time was rejected in Payroll and is not payable.",
  );
});

test("recorded-only extra time explains that overtime was disabled", () => {
  const notices = buildAttendanceNotices({
    issues: [{ code: "overtime_recorded_only", seconds: 3_600 }],
    pendingManualSeconds: 0,
    pendingOvertimeSeconds: 3_600,
  });

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.label, "Extra time recorded only");
  assert.match(
    overtimeReviewExplanation({
      issues: [{ code: "overtime_recorded_only", seconds: 3_600 }],
      unapprovedOvertimeSeconds: 3_600,
      scheduledStartAt: "2026-08-02T09:00:00Z",
      scheduledEndAt: "2026-08-02T17:00:00Z",
    }) ?? "",
    /Overtime was disabled/,
  );
});
