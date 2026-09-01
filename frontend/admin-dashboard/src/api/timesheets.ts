import { apiFetch, apiFetchWithMeta, toMinutes, withQuery } from "./client";
import type { Timesheet } from "@/types";

type BackendTimesheet = {
  employee_id: string;
  employee_name?: string;
  team_id?: string | null;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  last_signal_at?: string | null;
  tracking_status?: "active" | "idle" | "locked" | "sleeping" | null;
  leave_status?: "approved" | null;
  leave_type?: string | null;
  session_count?: number;
  total_tracked_seconds: number;
  observed_tracked_seconds?: number;
  observed_span_seconds?: number;
  untracked_seconds?: number;
  active_seconds: number;
  idle_seconds: number;
  observed_idle_seconds?: number;
  recorded_overtime_seconds?: number;
  adjustment_seconds?: number;
  deducted_seconds?: number;
  points?: number;
  screenshot_count: number;
};

function mapTimesheet(row: BackendTimesheet, teamId: string): Timesheet {
  return {
    id: `${row.employee_id}-${teamId || "company"}-${row.date}`,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    teamId,
    date: row.date,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
    lastSignalAt: row.last_signal_at ?? undefined,
    leaveStatus: row.leave_status ?? undefined,
    leaveType: row.leave_type ?? undefined,
    sessionCount: row.session_count ?? 0,
    totalMinutes: toMinutes(row.observed_tracked_seconds ?? row.total_tracked_seconds),
    observedSpanMinutes: toMinutes(
      row.observed_span_seconds ?? row.observed_tracked_seconds ?? row.total_tracked_seconds,
    ),
    untrackedMinutes: toMinutes(row.untracked_seconds ?? 0),
    activeMinutes: toMinutes(row.active_seconds),
    idleMinutes: toMinutes(row.observed_idle_seconds ?? row.idle_seconds),
    accountableIdleMinutes: toMinutes(row.idle_seconds),
    overtimeMinutes: toMinutes(row.recorded_overtime_seconds ?? 0),
    adjustmentMinutes: toMinutes(row.adjustment_seconds ?? 0),
    deductedMinutes: toMinutes(row.deducted_seconds ?? 0),
    points: row.points ?? Math.round((row.active_seconds / 3600) * 100) / 100,
    screenshotCount: row.screenshot_count,
    status: resolveTimesheetStatus(row),
  };
}

function resolveTimesheetStatus(row: BackendTimesheet): Timesheet["status"] {
  const hasRecordedTime =
    Boolean(row.start_time) ||
    Boolean(row.end_time) ||
    row.total_tracked_seconds > 0 ||
    (row.adjustment_seconds ?? 0) > 0;
  if (!hasRecordedTime && row.leave_status === "approved") return "approved_leave";
  if (!hasRecordedTime) return "missing";
  if (row.end_time) return "complete";
  if (["idle", "locked", "sleeping"].includes(row.tracking_status ?? "")) {
    return row.tracking_status as "idle" | "locked" | "sleeping";
  }
  return "in_progress";
}

export type TimesheetEmployeeOption = {
  id: string;
  name: string;
};

export async function listTimesheetEmployeeOptions(
  scopedTeamIds?: string[],
  selectedTeamId?: string,
  signal?: AbortSignal,
): Promise<TimesheetEmployeeOption[]> {
  const teamId =
    selectedTeamId && selectedTeamId !== "all"
      ? selectedTeamId
      : scopedTeamIds?.length === 1
        ? scopedTeamIds[0]
        : undefined;
  const employees: TimesheetEmployeeOption[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await apiFetchWithMeta<TimesheetEmployeeOption[]>(
      withQuery("/timesheets/employee-options", {
        team_id: teamId,
        page,
        page_size: 100,
      }),
      { signal },
    );
    employees.push(...result.data);
    const parsedTotalPages = Number(result.meta.total_pages ?? 1);
    totalPages = Number.isFinite(parsedTotalPages) && parsedTotalPages > 0 ? parsedTotalPages : 1;
    page += 1;
  } while (page <= totalPages);

  return employees;
}

export async function listTimesheets(
  scopedTeamIds?: string[],
  view: "daily" | "weekly" | "monthly" = "daily",
  selectedDate?: string,
  selectedTeamId?: string,
  signal?: AbortSignal,
): Promise<Timesheet[]> {
  const teamId =
    selectedTeamId && selectedTeamId !== "all"
      ? selectedTeamId
      : scopedTeamIds?.length === 1
        ? scopedTeamIds[0]
        : undefined;
  const path =
    view === "weekly"
      ? "/timesheets/weekly"
      : view === "monthly"
        ? "/timesheets/monthly"
        : "/timesheets/daily";
  const periodDate =
    view === "weekly"
      ? startOfWeek(selectedDate)
      : view === "monthly"
        ? startOfMonth(selectedDate)
        : selectedDate;
  const rows = await apiFetch<BackendTimesheet[]>(
    withQuery(path, {
      team_id: teamId,
      day: view === "daily" ? periodDate : undefined,
      week_start: view === "weekly" ? periodDate : undefined,
      month_start: view === "monthly" ? periodDate : undefined,
    }),
    { signal },
  );
  return rows.map((row) => mapTimesheet(row, row.team_id ?? teamId ?? ""));
}

export async function listEmployeeTimesheets(
  employeeId: string,
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<Timesheet[]> {
  const rows = await apiFetch<BackendTimesheet[]>(
    withQuery(`/timesheets/employee/${employeeId}`, {
      start_date: startDate,
      end_date: endDate,
    }),
    { signal },
  );
  return rows.map((row) => mapTimesheet(row, row.team_id ?? ""));
}

function startOfWeek(value?: string): string | undefined {
  const parsed = parseDate(value);
  if (!parsed) return undefined;
  const mondayOffset = (parsed.getDay() + 6) % 7;
  parsed.setDate(parsed.getDate() - mondayOffset);
  return localDateValue(parsed);
}

function startOfMonth(value?: string): string | undefined {
  const parsed = parseDate(value);
  if (!parsed) return undefined;
  parsed.setDate(1);
  return localDateValue(parsed);
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function localDateValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
