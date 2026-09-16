import { apiFetch, toMinutes, withQuery } from "./client";
import type { Team } from "@/types";

type BackendReportSummary = {
  total_tracked_seconds: number;
  screenshots: number;
};

type BackendEmployeeReportRow = {
  employee_id: string;
  name: string;
  email: string;
  active_seconds: number;
  idle_seconds: number;
  total_seconds: number;
};

export type ReportEmployeeRow = {
  employeeId: string;
  name: string;
  activeSeconds: number;
  idleSeconds: number;
  totalSeconds: number;
};

export type ReportFilters = {
  scopedTeamIds?: string[];
  selectedTeamId?: string;
  selectedEmployeeId?: string;
  dateFrom?: string;
  dateTo?: string;
};

function reportQueryParams(filters: ReportFilters) {
  const teamScope =
    filters.selectedTeamId && filters.selectedTeamId !== "all"
      ? [filters.selectedTeamId]
      : filters.scopedTeamIds;
  const teamId = teamScope?.length === 1 ? teamScope[0] : undefined;
  const employeeId =
    filters.selectedEmployeeId && filters.selectedEmployeeId !== "all"
      ? filters.selectedEmployeeId
      : undefined;
  return {
    team_id: teamId,
    employee_id: employeeId,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
  };
}

export async function fetchReportTotals(filters: ReportFilters, signal?: AbortSignal) {
  return apiFetch<BackendReportSummary>(
    withQuery("/reports/summary", reportQueryParams(filters)),
    { signal },
  );
}

export async function fetchEmployeeReport(
  filters: ReportFilters,
  signal?: AbortSignal,
): Promise<ReportEmployeeRow[]> {
  const rows = await apiFetch<BackendEmployeeReportRow[]>(
    withQuery("/reports/employees", reportQueryParams(filters)),
    { signal },
  );
  return rows.map((row) => ({
    employeeId: row.employee_id,
    name: row.name,
    activeSeconds: row.active_seconds,
    idleSeconds: row.idle_seconds,
    totalSeconds: row.total_seconds,
  }));
}

/**
 * Build the report view model from server-filtered data. The summary and the
 * per-employee rows are both filtered by the same team/employee/date query, so
 * the headline cards, charts, and export all agree (W9).
 */
export function buildReport(
  summary: BackendReportSummary,
  teams: Team[],
  employeeRows: ReportEmployeeRow[],
) {
  const hours = (seconds: number) => Math.round(seconds / 3600);
  const rowsById = new Map(employeeRows.map((row) => [row.employeeId, row]));

  return {
    byTeam: teams.map((team) => ({
      team: team.name,
      hours: hours(
        team.employeeIds.reduce(
          (sum, employeeId) => sum + (rowsById.get(employeeId)?.totalSeconds ?? 0),
          0,
        ),
      ),
    })),
    byEmployee: employeeRows.map((row) => ({
      employee: row.name,
      hours: hours(row.totalSeconds),
    })),
    activeVsIdle: {
      active: hours(employeeRows.reduce((sum, row) => sum + row.activeSeconds, 0)),
      idle: hours(employeeRows.reduce((sum, row) => sum + row.idleSeconds, 0)),
    },
    totalHours: Math.round(toMinutes(summary.total_tracked_seconds) / 60),
    screenshots: summary.screenshots,
  };
}
