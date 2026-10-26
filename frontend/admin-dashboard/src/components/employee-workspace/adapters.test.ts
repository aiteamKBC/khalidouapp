import assert from "node:assert/strict";
import test from "node:test";
import type { PortalPeriod, PortalSummary, PortalTask } from "@/api/employee-portal";
import { mapAttendance, mapRequests, mapSummaries, mapTask } from "./adapters.ts";
import { countedSeconds } from "./model.ts";
import { workingDaysBetween } from "./format.ts";

const period: PortalPeriod = {
  active_seconds: 5400,
  tracked_active_seconds: 3600,
  manual_approved_seconds: 1800,
  manual_pending_seconds: 900,
  manual_rejected_seconds: 600,
  idle_seconds: 300,
  tracked_seconds: 5700,
  adjustment_seconds: 1800,
  deducted_seconds: 0,
  screenshot_count: 4,
  points: 1.5,
};
const summary: PortalSummary = {
  today: period,
  week: period,
  month: period,
  days: [],
  points_rule: "approved active work",
  todayTimeline: {
    date: "2026-10-25",
    timezone: "Africa/Cairo",
    isRunning: false,
    continuedFromPreviousDay: false,
    workedSeconds: 3600,
    idleSeconds: 300,
    lockedSeconds: 0,
    sleepingSeconds: 0,
    untrackedSeconds: 0,
    breakSeconds: 0,
    manualSeconds: 1800,
    approvedLeave: false,
    leaveSeconds: 0,
    intervals: [],
  },
  daily_attendance: {
    status: "missing",
    is_running: false,
    normal_worked_seconds: 3600,
    paid_break_seconds: 0,
    idle_seconds: 300,
    raw_late_seconds: 600,
    deductible_late_seconds: 0,
    early_leave_seconds: 0,
    recorded_overtime_seconds: 900,
    approved_overtime_seconds: 0,
    total_payable_seconds: 5400,
  },
};

test("counted time excludes idle, pending and rejected minutes without counting approved time twice", () => {
  const today = mapSummaries(summary, undefined, new Date(2026, 9, 25))[0];
  assert.equal(countedSeconds(today.breakdown), 5400);
  assert.equal(today.breakdown.manualPendingSeconds, 900);
  assert.equal(today.breakdown.manualTotalSeconds, 3300);
  assert.equal(today.breakdown.targetSeconds, 0);
  assert.equal(today.breakdown.sessions, null);
});

test("a missing sign-out never invents a running session or approved overtime", () => {
  const attendance = mapAttendance(summary);
  assert.equal(attendance.status, "not-started");
  assert.deepEqual(attendance.sessions, []);
  assert.equal(attendance.signOut, null);
  assert.equal(attendance.overtimeSeconds, 0);
  assert.equal(attendance.payableSeconds, 5400);
});

test("holiday estimates follow the employee's assigned days, including Sunday", () => {
  assert.equal(workingDaysBetween("2026-10-25", "2026-10-25", [6, 0, 1, 2, 3]), 1);
  assert.equal(workingDaysBetween("2026-10-23", "2026-10-24", [6, 0, 1, 2, 3]), 0);
});

test("task approval and edit permissions come from the server workflow", () => {
  const task: PortalTask = {
    id: "task",
    name: "Review",
    project_name: "Project",
    team_name: "Team",
    project_id: "p",
    stage: "ready_for_review",
    priority: "high",
    can_update_stage: false,
    active_seconds: 3600,
    idle_seconds: 600,
    tracked_seconds: 4200,
  };
  assert.equal(mapTask(task).approval, "Pending");
  assert.equal(mapTask(task).status, "In review");
  assert.equal(mapTask(task).canUpdateStatus, false);
  assert.equal(mapTask(task).workedSeconds, 3600);
  assert.equal(mapTask({ ...task, stage: "new_requests" }).approval, "Pending");
});

test("a pending manual claim is never labelled as counted", () => {
  const [request] = mapRequests([
    {
      id: "r",
      requested_date: "2026-10-25",
      requested_minutes: 30,
      reason: "Client meeting",
      status: "pending",
      created_at: "2026-10-25T10:00:00Z",
    },
  ]);
  assert.equal(request.counted, false);
  assert.equal(request.status, "Pending");
});
