import { apiFetch, withQuery } from "./client";

export type LeaveRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  requestedDays: number;
  leaveType: "annual" | "sick" | "unpaid";
  reason?: string;
  status: "pending" | "approved" | "rejected";
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
};

type BackendLeaveRequest = {
  id: string; employee_id: string; employee_name: string; start_date: string; end_date: string;
  requested_days: number; leave_type: LeaveRequest["leaveType"]; reason?: string | null;
  status: LeaveRequest["status"]; reviewed_by_name?: string | null; reviewed_at?: string | null;
  review_note?: string | null; created_at: string;
};

const mapLeave = (row: BackendLeaveRequest): LeaveRequest => ({
  id: row.id, employeeId: row.employee_id, employeeName: row.employee_name,
  startDate: row.start_date, endDate: row.end_date, requestedDays: row.requested_days,
  leaveType: row.leave_type, reason: row.reason ?? undefined, status: row.status,
  reviewedByName: row.reviewed_by_name ?? undefined, reviewedAt: row.reviewed_at ?? undefined,
  reviewNote: row.review_note ?? undefined, createdAt: row.created_at,
});

export async function listLeaveRequests(status?: string): Promise<LeaveRequest[]> {
  const rows = await apiFetch<BackendLeaveRequest[]>(withQuery("/leave-requests", {
    status: status && status !== "all" ? status : undefined, page_size: 100,
  }));
  return rows.map(mapLeave);
}

export async function reviewLeaveRequest(id: string, status: "approved" | "rejected") {
  return mapLeave(await apiFetch<BackendLeaveRequest>(`/leave-requests/${id}`, {
    method: "PATCH", body: JSON.stringify({ status }),
  }));
}

export async function recordManualLeave(input: {
  employeeId: string;
  startDate: string;
  endDate: string;
  leaveType: "annual" | "sick" | "unpaid";
  reason?: string;
}) {
  return mapLeave(await apiFetch<BackendLeaveRequest>("/leave-requests/manual", {
    method: "POST",
    body: JSON.stringify({
      employee_id: input.employeeId,
      start_date: input.startDate,
      end_date: input.endDate,
      leave_type: input.leaveType,
      reason: input.reason,
    }),
  }));
}
