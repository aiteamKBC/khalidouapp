import { apiFetch, withQuery } from "./client";

export type ShiftRescheduleStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";

export type ShiftReschedule = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string | null;
  workDate: string;
  requestedStart: string;
  requestedEnd: string;
  originalStart: string;
  originalEnd: string;
  durationMinutes: number;
  reason: string;
  status: ShiftRescheduleStatus;
  source: "employee" | "admin";
  createdByName?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  reviewReason?: string | null;
  createdAt?: string | null;
};

export type ShiftRescheduleDay = {
  date: string;
  scheduledDay: boolean;
  shiftStart: string | null;
  shiftEnd: string | null;
  shiftMinutes: number;
};

type BackendShiftReschedule = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code?: string | null;
  work_date: string;
  requested_start: string;
  requested_end: string;
  original_start: string;
  original_end: string;
  duration_minutes: number;
  reason: string;
  status: ShiftRescheduleStatus;
  source: "employee" | "admin";
  created_by_name?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  review_reason?: string | null;
  created_at?: string | null;
};

type BackendShiftRescheduleDay = {
  date: string;
  scheduled_day: boolean;
  shift_start: string | null;
  shift_end: string | null;
  shift_minutes: number;
};

function mapShiftReschedule(row: BackendShiftReschedule): ShiftReschedule {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeCode: row.employee_code ?? undefined,
    workDate: row.work_date,
    requestedStart: row.requested_start,
    requestedEnd: row.requested_end,
    originalStart: row.original_start,
    originalEnd: row.original_end,
    durationMinutes: row.duration_minutes,
    reason: row.reason,
    status: row.status,
    source: row.source,
    createdByName: row.created_by_name ?? undefined,
    reviewedByName: row.reviewed_by_name ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewReason: row.review_reason ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}

export async function listShiftReschedules(
  status: ShiftRescheduleStatus | "all",
  signal?: AbortSignal,
): Promise<ShiftReschedule[]> {
  const rows = await apiFetch<BackendShiftReschedule[]>(
    withQuery("/shift-reschedules", {
      page_size: 200,
      status: status !== "all" ? status : undefined,
    }),
    { signal },
  );
  return rows.map(mapShiftReschedule);
}

export async function getShiftRescheduleDay(
  employeeId: string,
  workDate: string,
  signal?: AbortSignal,
): Promise<ShiftRescheduleDay> {
  const row = await apiFetch<BackendShiftRescheduleDay>(
    withQuery("/shift-reschedules/day", { employee_id: employeeId, date: workDate }),
    { signal },
  );
  return {
    date: row.date,
    scheduledDay: row.scheduled_day,
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end,
    shiftMinutes: row.shift_minutes,
  };
}

export async function reviewShiftReschedule(
  id: string,
  input: { status: "approved" | "rejected"; reviewReason?: string },
): Promise<ShiftReschedule> {
  const row = await apiFetch<BackendShiftReschedule>(`/shift-reschedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: input.status, review_reason: input.reviewReason }),
  });
  return mapShiftReschedule(row);
}

export async function createEmergencyShiftReschedule(input: {
  employeeId: string;
  workDate: string;
  requestedStart: string;
  requestedEnd: string;
  reason: string;
}): Promise<ShiftReschedule> {
  const row = await apiFetch<BackendShiftReschedule>("/shift-reschedules/emergency", {
    method: "POST",
    body: JSON.stringify({
      employee_id: input.employeeId,
      work_date: input.workDate,
      requested_start: input.requestedStart,
      requested_end: input.requestedEnd,
      reason: input.reason,
    }),
  });
  return mapShiftReschedule(row);
}

/** Same-length end time, or null if it would reach/cross midnight. */
export function sameLengthEnd(start: string, shiftMinutes: number): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(start);
  if (!match || shiftMinutes <= 0) return null;
  const end = Number(match[1]) * 60 + Number(match[2]) + shiftMinutes;
  if (end >= 24 * 60) return null;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}
