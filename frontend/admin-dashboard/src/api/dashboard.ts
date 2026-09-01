import { apiFetch, toMinutes, withQuery } from "./client";
import type { DashboardSummary, Timesheet } from "@/types";

type BackendDashboardSummary = {
  total_employees: number;
  online_employees: number;
  idle_employees: number;
  on_break_employees?: number;
  off_shift_employees: number;
  offline_employees: number;
  total_hours_today: number;
  screenshots_today: number;
};

export async function getDashboardSummary(
  scopedTeamIds?: string[],
  signal?: AbortSignal,
): Promise<DashboardSummary> {
  const teamId = scopedTeamIds?.length === 1 ? scopedTeamIds[0] : undefined;
  const summary = await apiFetch<BackendDashboardSummary>(
    withQuery("/dashboard/summary", { team_id: teamId }),
    { signal },
  );
  const onBreakEmployees = summary.on_break_employees ?? 0;
  return {
    totalEmployees: summary.total_employees,
    onlineEmployees: summary.online_employees,
    activeEmployees: Math.max(
      0,
      summary.online_employees - summary.idle_employees - onBreakEmployees,
    ),
    idleEmployees: summary.idle_employees,
    onBreakEmployees,
    offShiftEmployees: summary.off_shift_employees,
    offlineEmployees: summary.offline_employees,
    teams: 0,
    hoursTrackedToday: Math.round(summary.total_hours_today),
    screenshotsToday: summary.screenshots_today,
  };
}

type BackendDashboardWorkTrend = {
  employee_id: string;
  team_id?: string | null;
  date: string;
  total_tracked_seconds: number;
  active_seconds: number;
  idle_seconds: number;
  adjustment_seconds: number;
  deducted_seconds: number;
};

export async function listDashboardWorkTrend(
  scopedTeamIds: string[] | undefined,
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<Timesheet[]> {
  const teamId = scopedTeamIds?.length === 1 ? scopedTeamIds[0] : undefined;
  const rows = await apiFetch<BackendDashboardWorkTrend[]>(
    withQuery("/dashboard/work-trend", {
      team_id: teamId,
      start_date: startDate,
      end_date: endDate,
    }),
    { signal },
  );
  return rows.map((row) => ({
    id: `${row.employee_id}-${row.team_id ?? "company"}-${row.date}`,
    employeeId: row.employee_id,
    teamId: row.team_id ?? teamId ?? "",
    date: row.date,
    sessionCount: 0,
    totalMinutes: toMinutes(row.total_tracked_seconds),
    observedSpanMinutes: toMinutes(row.total_tracked_seconds),
    untrackedMinutes: 0,
    activeMinutes: toMinutes(row.active_seconds),
    idleMinutes: toMinutes(row.idle_seconds),
    accountableIdleMinutes: toMinutes(row.idle_seconds),
    overtimeMinutes: 0,
    adjustmentMinutes: toMinutes(row.adjustment_seconds),
    deductedMinutes: toMinutes(row.deducted_seconds),
    points: Math.round((row.active_seconds / 3600) * 100) / 100,
    screenshotCount: 0,
    status: "complete",
  }));
}
