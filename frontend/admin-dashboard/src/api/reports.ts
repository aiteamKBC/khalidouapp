import { apiFetch, toMinutes, withQuery } from "./client";
import type { Employee, Team, Timesheet } from "@/types";

type BackendReportSummary = {
  total_tracked_seconds: number;
  screenshots: number;
};

export async function fetchReportTotals(scopedTeamIds?: string[], selectedTeamId?: string) {
  const teamScope = selectedTeamId && selectedTeamId !== "all" ? [selectedTeamId] : scopedTeamIds;
  const teamId = teamScope?.length === 1 ? teamScope[0] : undefined;
  return apiFetch<BackendReportSummary>(withQuery("/reports/summary", { team_id: teamId }));
}

export function buildReport(
  summary: BackendReportSummary,
  teams: Team[],
  employees: Employee[],
  timesheets: Timesheet[],
  selectedEmployeeId?: string,
) {
  const filteredEmployees =
    selectedEmployeeId && selectedEmployeeId !== "all"
      ? employees.filter((employee) => employee.id === selectedEmployeeId)
      : employees;
  const filteredTimesheets =
    selectedEmployeeId && selectedEmployeeId !== "all"
      ? timesheets.filter((timesheet) => timesheet.employeeId === selectedEmployeeId)
      : timesheets;

  return {
    byTeam: teams.map((team) => ({
      team: team.name,
      hours: Math.round(
        filteredTimesheets
          .filter(
            (timesheet) =>
              timesheet.teamId === team.id || team.employeeIds.includes(timesheet.employeeId),
          )
          .reduce((sum, timesheet) => sum + timesheet.totalMinutes, 0) / 60,
      ),
    })),
    byEmployee: filteredEmployees.map((employee) => ({
      employee: employee.name,
      hours: Math.round(
        filteredTimesheets
          .filter((timesheet) => timesheet.employeeId === employee.id)
          .reduce((sum, timesheet) => sum + timesheet.totalMinutes, 0) / 60,
      ),
    })),
    activeVsIdle: {
      active: Math.round(
        filteredTimesheets.reduce((sum, timesheet) => sum + timesheet.activeMinutes, 0) / 60,
      ),
      idle: Math.round(
        filteredTimesheets.reduce((sum, timesheet) => sum + timesheet.idleMinutes, 0) / 60,
      ),
    },
    totalHours: Math.round(toMinutes(summary.total_tracked_seconds) / 60),
    screenshots: summary.screenshots,
  };
}
