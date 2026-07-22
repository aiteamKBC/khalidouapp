import { apiFetch, apiFetchWithMeta, apiFile, toMinutes, withQuery } from "./client";
import type { Screenshot } from "@/types";

type BackendScreenshot = {
  id: string;
  employee_id: string;
  device_id: string;
  session_id?: string | null;
  team_id?: string | null;
  project_id?: string | null;
  task_id?: string | null;
  captured_at: string;
  temporary_url: string;
  thumbnail_url?: string;
  display_id?: string | null;
  display_name?: string | null;
  work_category: "scheduled_shift" | "off_shift" | "unknown";
  power_source: "ac" | "battery" | "unknown";
};

function mapScreenshot(screenshot: BackendScreenshot, teamId: string): Screenshot {
  return {
    id: screenshot.id,
    employeeId: screenshot.employee_id,
    teamId: screenshot.team_id ?? teamId,
    projectId: screenshot.project_id ?? undefined,
    taskId: screenshot.task_id ?? undefined,
    sessionId: screenshot.session_id ?? undefined,
    deviceId: screenshot.device_id,
    capturedAt: screenshot.captured_at,
    thumbnailUrl: screenshot.thumbnail_url ?? screenshot.temporary_url,
    fullUrl: screenshot.temporary_url,
    isIdle: false,
    displayId: screenshot.display_id ?? undefined,
    displayName: screenshot.display_name ?? undefined,
    workCategory: screenshot.work_category,
    powerSource: screenshot.power_source,
  };
}

export async function listScreenshotPage(options: {
  scopedTeamIds?: string[];
  page: number;
  pageSize?: number;
  employeeId?: string;
  teamId?: string;
  day?: string;
  workCategory?: string;
}): Promise<{ items: Screenshot[]; page: number; pages: number; total: number }> {
  const scopedTeamId = options.scopedTeamIds?.length === 1 ? options.scopedTeamIds[0] : undefined;
  const teamId = options.teamId && options.teamId !== "all" ? options.teamId : scopedTeamId;
  const result = await apiFetchWithMeta<BackendScreenshot[]>(
    withQuery("/screenshots", {
      page: options.page,
      page_size: options.pageSize ?? 24,
      employee_id: options.employeeId === "all" ? undefined : options.employeeId,
      team_id: teamId,
      day: options.day,
      work_category: options.workCategory === "all" ? undefined : options.workCategory,
    }),
  );
  return {
    items: result.data.map((screenshot) =>
      mapScreenshot(screenshot, screenshot.team_id ?? teamId ?? ""),
    ),
    page: Number(result.meta.page ?? options.page),
    pages: Number(result.meta.total_pages ?? 1),
    total: Number(result.meta.total ?? result.data.length),
  };
}

export async function listScreenshots(
  scopedTeamIds?: string[],
  options: { pageSize?: number } = {},
): Promise<Screenshot[]> {
  const teamId = scopedTeamIds?.length === 1 ? scopedTeamIds[0] : undefined;
  const screenshots = await apiFetch<BackendScreenshot[]>(
    withQuery("/screenshots", { page_size: options.pageSize ?? 50, team_id: teamId }),
  );
  return screenshots.map((screenshot) =>
    mapScreenshot(screenshot, screenshot.team_id ?? teamId ?? ""),
  );
}

export async function deleteScreenshot(id: string): Promise<{ deductedMinutes: number }> {
  const result = await apiFetch<{ deleted: boolean; deducted_seconds: number }>(
    `/screenshots/${id}`,
    { method: "DELETE" },
  );
  return { deductedMinutes: toMinutes(result.deducted_seconds) };
}

export async function downloadScreenshot(screenshot: Screenshot): Promise<void> {
  const blob = await apiFile(`/screenshots/${screenshot.id}/file`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${screenshot.capturedAt.slice(0, 10)}-${screenshot.id}.jpg`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function getScreenshotStorageStatus(): Promise<{
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
  warningPercent: number;
  healthy: boolean;
}> {
  const status = await apiFetch<{
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    used_percent: number;
    warning_percent: number;
    healthy: boolean;
  }>("/screenshots/storage-status");
  return {
    totalBytes: status.total_bytes,
    usedBytes: status.used_bytes,
    freeBytes: status.free_bytes,
    usedPercent: status.used_percent,
    warningPercent: status.warning_percent,
    healthy: status.healthy,
  };
}

export type ScreenshotCaptureEvent = {
  id: string;
  employeeId: string;
  employeeName: string;
  deviceId: string;
  sessionId?: string | null;
  screenshotId?: string | null;
  occurredAt: string;
  outcome: "captured" | "skipped";
  reason?: string | null;
  workCategory: "scheduled_shift" | "off_shift" | "unknown";
  powerSource: "ac" | "battery" | "unknown";
  trackingStatus?: string | null;
};

export async function listScreenshotCaptureEvents(
  options: {
    employeeId?: string;
    day?: string;
    outcome?: "captured" | "skipped";
    pageSize?: number;
  } = {},
): Promise<ScreenshotCaptureEvent[]> {
  const rows = await apiFetch<
    Array<{
      id: string;
      employee_id: string;
      employee_name: string;
      device_id: string;
      session_id?: string | null;
      screenshot_id?: string | null;
      occurred_at: string;
      outcome: "captured" | "skipped";
      reason?: string | null;
      work_category: "scheduled_shift" | "off_shift" | "unknown";
      power_source: "ac" | "battery" | "unknown";
      tracking_status?: string | null;
    }>
  >(
    withQuery("/screenshots/capture-events", {
      employee_id: options.employeeId,
      day: options.day,
      outcome: options.outcome,
      page_size: options.pageSize ?? 50,
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    deviceId: row.device_id,
    sessionId: row.session_id,
    screenshotId: row.screenshot_id,
    occurredAt: row.occurred_at,
    outcome: row.outcome,
    reason: row.reason,
    workCategory: row.work_category,
    powerSource: row.power_source,
    trackingStatus: row.tracking_status,
  }));
}
