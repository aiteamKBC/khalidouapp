import { apiFetch, withQuery } from "./client";
import type { Screenshot } from "@/types";

export type MeetingStatus = "pending" | "approved" | "rejected";
export type MeetingLifecycle = "active" | "ended";

export type MeetingRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  title: string;
  reason: string;
  deviceName?: string | null;
  workSessionId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  taskId?: string | null;
  taskName?: string | null;
  startedAt: string;
  expectedEndAt: string;
  endedAt?: string | null;
  lifecycleState: MeetingLifecycle;
  status: MeetingStatus;
  recordedSeconds: number;
  approvedSeconds?: number | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  adminNote?: string | null;
};

type BackendMeeting = {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  title: string;
  reason: string;
  device_name?: string | null;
  work_session_id?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  task_id?: string | null;
  task_name?: string | null;
  started_at: string;
  expected_end_at: string;
  ended_at?: string | null;
  lifecycle_state: MeetingLifecycle;
  status: MeetingStatus;
  recorded_seconds: number;
  approved_seconds?: number | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  admin_note?: string | null;
};

function mapMeeting(row: BackendMeeting): MeetingRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    workDate: row.work_date,
    title: row.title,
    reason: row.reason,
    deviceName: row.device_name ?? undefined,
    workSessionId: row.work_session_id ?? undefined,
    projectId: row.project_id ?? undefined,
    projectName: row.project_name ?? undefined,
    taskId: row.task_id ?? undefined,
    taskName: row.task_name ?? undefined,
    startedAt: row.started_at,
    expectedEndAt: row.expected_end_at,
    endedAt: row.ended_at ?? undefined,
    lifecycleState: row.lifecycle_state,
    status: row.status,
    recordedSeconds: row.recorded_seconds,
    approvedSeconds: row.approved_seconds ?? undefined,
    reviewedByName: row.reviewed_by_name ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    adminNote: row.admin_note ?? undefined,
  };
}

export async function listMeetings(
  options?: { status?: MeetingStatus | "all"; employeeId?: string },
  signal?: AbortSignal,
): Promise<MeetingRecord[]> {
  const rows = await apiFetch<BackendMeeting[]>(
    withQuery("/meetings", {
      page_size: 100,
      status: options?.status && options.status !== "all" ? options.status : undefined,
      employee_id:
        options?.employeeId && options.employeeId !== "all" ? options.employeeId : undefined,
    }),
    { signal },
  );
  return rows.map(mapMeeting);
}

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

/**
 * Existing screenshots captured during a meeting's recorded window. The backend
 * reuses captures already taken by the desktop agent (it never triggers new
 * ones) and returns an empty list when none fall inside the period.
 */
export async function listMeetingScreenshots(
  meetingId: string,
  signal?: AbortSignal,
): Promise<Screenshot[]> {
  const rows = await apiFetch<BackendScreenshot[]>(`/meetings/${meetingId}/screenshots`, {
    signal,
  });
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    teamId: row.team_id ?? "",
    projectId: row.project_id ?? undefined,
    taskId: row.task_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    deviceId: row.device_id,
    capturedAt: row.captured_at,
    thumbnailUrl: row.thumbnail_url ?? row.temporary_url,
    fullUrl: row.temporary_url,
    isIdle: false,
    displayId: row.display_id ?? undefined,
    displayName: row.display_name ?? undefined,
    workCategory: row.work_category,
    powerSource: row.power_source,
  }));
}

export async function reviewMeeting(
  id: string,
  input: { status: "approved" | "rejected"; approvedMinutes?: number; adminNote?: string },
): Promise<MeetingRecord> {
  const row = await apiFetch<BackendMeeting>(`/meetings/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: input.status,
      approved_minutes: input.approvedMinutes,
      admin_note: input.adminNote,
    }),
  });
  return mapMeeting(row);
}
