import { apiFetch } from "@/api/client";
import { mapWorkdayTimeline, type BackendWorkdayTimeline } from "@/api/workday";
import type { WorkdayTimeline } from "@/types";
import type { AnyStatus } from "@/components/ui/status-badge";

export type DailyAttendance = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  jobTitle?: string | null;
  teamNames: string[];
  date: string;
  timezone: string;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  actualFirstActivityAt?: string | null;
  actualLastActivityAt?: string | null;
  normalWorkedSeconds: number;
  paidBreakSeconds: number;
  unpaidBreakSeconds: number;
  idleSeconds: number;
  approvedManualSeconds: number;
  pendingManualSeconds: number;
  rejectedManualSeconds: number;
  rawLateSeconds: number;
  deductibleLateSeconds: number;
  earlyLeaveSeconds: number;
  preShiftExtraSeconds: number;
  postShiftExtraSeconds: number;
  recordedOvertimeSeconds: number;
  approvedOvertimeSeconds: number;
  unapprovedOvertimeSeconds: number;
  totalPayableSeconds: number;
  status: AnyStatus;
  leaveStatus?: string | null;
  issues: Array<{ code: string; seconds?: number }>;
  timeline?: WorkdayTimeline;
};

type BackendAttendance = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  job_title?: string | null;
  team_names?: string[];
  date: string;
  timezone: string;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  actual_first_activity_at?: string | null;
  actual_last_activity_at?: string | null;
  normal_worked_seconds: number;
  paid_break_seconds: number;
  unpaid_break_seconds: number;
  idle_seconds: number;
  approved_manual_seconds: number;
  pending_manual_seconds: number;
  rejected_manual_seconds: number;
  raw_late_seconds: number;
  deductible_late_seconds: number;
  early_leave_seconds: number;
  pre_shift_extra_seconds: number;
  post_shift_extra_seconds: number;
  recorded_overtime_seconds: number;
  approved_overtime_seconds: number;
  unapproved_overtime_seconds: number;
  total_payable_seconds: number;
  status: string;
  leave_status?: string | null;
  issues?: Array<{ code: string; seconds?: number }>;
  timeline?: BackendWorkdayTimeline;
};

function mapAttendance(row: BackendAttendance): DailyAttendance {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeEmail: row.employee_email,
    jobTitle: row.job_title,
    teamNames: row.team_names ?? [],
    date: row.date,
    timezone: row.timezone,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    actualFirstActivityAt: row.actual_first_activity_at,
    actualLastActivityAt: row.actual_last_activity_at,
    normalWorkedSeconds: row.normal_worked_seconds,
    paidBreakSeconds: row.paid_break_seconds,
    unpaidBreakSeconds: row.unpaid_break_seconds,
    idleSeconds: row.idle_seconds,
    approvedManualSeconds: row.approved_manual_seconds,
    pendingManualSeconds: row.pending_manual_seconds,
    rejectedManualSeconds: row.rejected_manual_seconds,
    rawLateSeconds: row.raw_late_seconds,
    deductibleLateSeconds: row.deductible_late_seconds,
    earlyLeaveSeconds: row.early_leave_seconds,
    preShiftExtraSeconds: row.pre_shift_extra_seconds,
    postShiftExtraSeconds: row.post_shift_extra_seconds,
    recordedOvertimeSeconds: row.recorded_overtime_seconds,
    approvedOvertimeSeconds: row.approved_overtime_seconds,
    unapprovedOvertimeSeconds: row.unapproved_overtime_seconds,
    totalPayableSeconds: row.total_payable_seconds,
    status: row.status as AnyStatus,
    leaveStatus: row.leave_status,
    issues: row.issues ?? [],
    timeline: row.timeline ? mapWorkdayTimeline(row.timeline) : undefined,
  };
}

export async function listDailyAttendance(filters: {
  day: string;
  teamId?: string;
  status?: string;
  q?: string;
  issue?: "late" | "missing_check_in" | "overtime" | "idle" | "leave" | "all";
}) {
  const params = new URLSearchParams({ day: filters.day });
  if (filters.teamId && filters.teamId !== "all") params.set("team_id", filters.teamId);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.issue === "late") params.set("late_only", "true");
  if (filters.issue === "missing_check_in") params.set("missing_check_in", "true");
  if (filters.issue === "overtime") params.set("overtime_only", "true");
  if (filters.issue === "idle") params.set("unexplained_idle", "true");
  if (filters.issue === "leave") params.set("leave_only", "true");
  const result = await apiFetch<{ date: string; rows: BackendAttendance[] }>(
    `/attendance/daily?${params.toString()}`,
  );
  return result.rows.map(mapAttendance);
}

export async function getDailyAttendance(employeeId: string, day: string) {
  return mapAttendance(
    await apiFetch<BackendAttendance>(`/attendance/employee/${employeeId}/${day}`),
  );
}
