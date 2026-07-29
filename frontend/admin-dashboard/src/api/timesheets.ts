import { apiFetch, toMinutes, withQuery } from "./client";
import type { Timesheet } from "@/types";

type BackendTimesheet = {
  employee_id: string;
  team_id?: string | null;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  total_tracked_seconds: number;
  active_seconds: number;
  idle_seconds: number;
  adjustment_seconds?: number;
  deducted_seconds?: number;
  points?: number;
  screenshot_count: number;
};

function mapTimesheet(row: BackendTimesheet, teamId: string): Timesheet {
  return {
    id: `${row.employee_id}-${teamId || "company"}-${row.date}`,
    employeeId: row.employee_id,
    teamId,
    date: row.date,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
    totalMinutes: toMinutes(row.total_tracked_seconds),
    activeMinutes: toMinutes(row.active_seconds),
    idleMinutes: toMinutes(row.idle_seconds),
    adjustmentMinutes: toMinutes(row.adjustment_seconds ?? 0),
    deductedMinutes: toMinutes(row.deducted_seconds ?? 0),
    points: row.points ?? Math.round((row.active_seconds / 3600) * 100) / 100,
    screenshotCount: row.screenshot_count,
    status: row.end_time ? "complete" : "in_progress",
  };
}

export async function listTimesheets(
  scopedTeamIds?: string[],
  view: "daily" | "weekly" | "monthly" = "daily",
  selectedDate?: string,
  selectedTeamId?: string,
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
  );
  return rows.map((row) => mapTimesheet(row, row.team_id ?? teamId ?? ""));
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
