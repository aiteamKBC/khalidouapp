import { apiFetch, withQuery } from "./client";
import type { DashboardSummary } from "@/types";

type BackendDashboardSummary = {
  total_employees: number;
  online_employees: number;
  idle_employees: number;
  offline_employees: number;
  total_hours_today: number;
  screenshots_today: number;
};

export async function getDashboardSummary(scopedTeamIds?: string[]): Promise<DashboardSummary> {
  const teamId = scopedTeamIds?.length === 1 ? scopedTeamIds[0] : undefined;
  const summary = await apiFetch<BackendDashboardSummary>(
    withQuery("/dashboard/summary", { team_id: teamId }),
  );
  return {
    totalEmployees: summary.total_employees,
    onlineEmployees: summary.online_employees,
    activeEmployees: Math.max(0, summary.online_employees - summary.idle_employees),
    idleEmployees: summary.idle_employees,
    offlineEmployees: summary.offline_employees,
    teams: 0,
    hoursTrackedToday: Math.round(summary.total_hours_today),
    screenshotsToday: summary.screenshots_today,
  };
}
