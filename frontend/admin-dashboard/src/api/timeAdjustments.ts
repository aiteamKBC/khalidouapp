import { apiFetch, withQuery } from "./client";
import type { TimeAdjustmentRequest, TimeAdjustmentStatus } from "@/types";

type BackendTimeAdjustmentRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  device_id?: string | null;
  work_session_id?: string | null;
  requested_date: string;
  requested_minutes: number;
  approved_minutes?: number | null;
  reason: string;
  status: TimeAdjustmentStatus;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  admin_note?: string | null;
  created_at: string;
};

function mapRequest(row: BackendTimeAdjustmentRequest): TimeAdjustmentRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    deviceId: row.device_id ?? undefined,
    workSessionId: row.work_session_id ?? undefined,
    requestedDate: row.requested_date,
    requestedMinutes: row.requested_minutes,
    approvedMinutes: row.approved_minutes ?? undefined,
    reason: row.reason,
    status: row.status,
    reviewedByName: row.reviewed_by_name ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    adminNote: row.admin_note ?? undefined,
    createdAt: row.created_at,
  };
}

export async function listTimeAdjustmentRequests(options?: {
  scopedTeamIds?: string[];
  teamId?: string;
  employeeId?: string;
  status?: TimeAdjustmentStatus | "all";
}): Promise<TimeAdjustmentRequest[]> {
  const scopedTeamIds = options?.scopedTeamIds;
  const teamId =
    options?.teamId && options.teamId !== "all"
      ? options.teamId
      : scopedTeamIds?.length === 1
        ? scopedTeamIds[0]
        : undefined;
  const rows = await apiFetch<BackendTimeAdjustmentRequest[]>(
    withQuery("/time-adjustment-requests", {
      page_size: 100,
      team_id: teamId,
      employee_id:
        options?.employeeId && options.employeeId !== "all" ? options.employeeId : undefined,
      status: options?.status && options.status !== "all" ? options.status : undefined,
    }),
  );
  return rows.map(mapRequest);
}

export async function reviewTimeAdjustmentRequest(
  id: string,
  input: { status: "approved" | "rejected"; approvedMinutes?: number; adminNote?: string },
): Promise<TimeAdjustmentRequest> {
  const row = await apiFetch<BackendTimeAdjustmentRequest>(`/time-adjustment-requests/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: input.status,
      approved_minutes: input.approvedMinutes,
      admin_note: input.adminNote,
    }),
  });
  return mapRequest(row);
}
