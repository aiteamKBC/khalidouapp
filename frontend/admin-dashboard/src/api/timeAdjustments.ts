import { apiFetch, withQuery } from "./client";
import type { TimeAdjustmentRequest, TimeAdjustmentStatus } from "@/types";

type BackendTimeAdjustmentRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  device_id?: string | null;
  work_session_id?: string | null;
  request_type?: string | null;
  requested_date: string;
  source_start_at?: string | null;
  source_end_at?: string | null;
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
    requestType: row.request_type ?? "manual_time",
    requestedDate: row.requested_date,
    sourceStartAt: row.source_start_at ?? undefined,
    sourceEndAt: row.source_end_at ?? undefined,
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
  requestGroup?: "time" | "early_leave";
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
      request_group: options?.requestGroup,
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

export type BulkTimeAdjustmentReviewResult = {
  reviewedCount: number;
  skippedCount: number;
  skippedSelfReviewCount: number;
  reviewedIds: string[];
  status: "approved" | "rejected";
};

export async function bulkReviewTimeAdjustmentRequests(input: {
  status: "approved" | "rejected";
  requestIds?: string[];
  allFiltered?: boolean;
  employeeId?: string;
  teamId?: string;
  requestGroup?: "time" | "early_leave";
  adminNote?: string;
}): Promise<BulkTimeAdjustmentReviewResult> {
  const row = await apiFetch<{
    reviewed_count: number;
    skipped_count: number;
    skipped_self_review_count: number;
    reviewed_ids: string[];
    status: "approved" | "rejected";
  }>("/time-adjustment-requests/bulk-review", {
    method: "POST",
    body: JSON.stringify({
      status: input.status,
      request_ids: input.requestIds ?? [],
      all_filtered: input.allFiltered ?? false,
      employee_id: input.employeeId && input.employeeId !== "all" ? input.employeeId : undefined,
      team_id: input.teamId && input.teamId !== "all" ? input.teamId : undefined,
      request_group: input.requestGroup ?? "time",
      admin_note: input.adminNote,
    }),
  });
  return {
    reviewedCount: row.reviewed_count,
    skippedCount: row.skipped_count,
    skippedSelfReviewCount: row.skipped_self_review_count,
    reviewedIds: row.reviewed_ids,
    status: row.status,
  };
}
