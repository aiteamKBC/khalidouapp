import { apiFetch, apiFile, withQuery } from "@/api/client";

export type PayrollStatus = "draft" | "needs_review" | "approved" | "locked" | "paid";

export type PayrollEntry = {
  id: string;
  employee_id: string;
  employee_name: string;
  team?: string | null;
  job_title?: string | null;
  salary_type: "monthly" | "hourly";
  salary: number;
  currency: string;
  hourly_rate: number;
  expected_work_days: number;
  worked_days: number;
  leave_days: number;
  expected_seconds: number;
  worked_seconds: number;
  normal_seconds: number;
  total_payable_seconds: number;
  approved_manual_seconds: number;
  pending_manual_seconds: number;
  rejected_manual_seconds: number;
  idle_seconds: number;
  late_minutes: number;
  raw_late_minutes: number;
  early_leave_minutes: number;
  paid_break_seconds: number;
  unpaid_break_seconds: number;
  absence_days: number;
  recorded_overtime_seconds: number;
  approved_overtime_seconds: number;
  rejected_overtime_seconds: number;
  overtime_eligible: boolean;
  deduct_lateness: boolean;
  lateness_deduction_amount: number;
  lateness_note?: string | null;
  deduct_idle: boolean;
  idle_deduction_amount: number;
  idle_note?: string | null;
  deduct_unpaid_breaks: boolean;
  unpaid_break_deduction_amount: number;
  unpaid_break_note?: string | null;
  pay_overtime: boolean;
  overtime_decision: "pending" | "paid" | "rejected";
  overtime_multiplier: number;
  custom_overtime_amount?: number | null;
  overtime_note?: string | null;
  bonus_amount: number;
  additional_deduction_amount: number;
  adjustment_note?: string | null;
  base_salary: number;
  overtime_amount: number;
  total_deductions: number;
  total_bonuses: number;
  final_salary: number;
  status: PayrollStatus;
  calculation?: Record<string, number | string | boolean | null>;
  adjustments?: PayrollAdjustment[];
};

export type PayrollAdjustment = {
  id: string;
  type: string;
  amount: number;
  reason: string;
  created_by: string;
  created_at: string;
};

export type PayrollSheet = {
  run: {
    id: string;
    month: string;
    status: PayrollStatus;
    approved_at?: string | null;
    locked_at?: string | null;
    paid_at?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    cycle_timezone?: string | null;
  };
  settings: PayrollSettings;
  summary: {
    employees: number;
    needs_review: number;
    late_employees: number;
    overtime_employees: number;
    currencies: Record<
      string,
      { base: number; overtime: number; bonuses: number; deductions: number; final: number }
    >;
  };
  teams: string[];
  entries: PayrollEntry[];
};

export type PayrollFilters = {
  month: string;
  start_date?: string;
  end_date?: string;
  team?: string;
  employee_id?: string;
  status?: string;
  overtime_eligible?: boolean;
  has_lateness?: boolean;
  has_idle?: boolean;
  has_deductions?: boolean;
  has_manual_adjustments?: boolean;
};

export type PayrollEntryUpdate = Partial<
  Pick<
    PayrollEntry,
    | "deduct_lateness"
    | "lateness_deduction_amount"
    | "lateness_note"
    | "deduct_idle"
    | "idle_deduction_amount"
    | "idle_note"
    | "deduct_unpaid_breaks"
    | "unpaid_break_deduction_amount"
    | "unpaid_break_note"
    | "overtime_decision"
    | "overtime_multiplier"
    | "custom_overtime_amount"
    | "overtime_note"
    | "bonus_amount"
    | "additional_deduction_amount"
    | "adjustment_note"
    | "status"
  >
>;

export function getPayrollSheet(filters: PayrollFilters) {
  return apiFetch<PayrollSheet>(withQuery("/payroll/sheet", filters));
}

export function getPayrollEntry(entryId: string) {
  return apiFetch<PayrollEntry>(`/payroll/entries/${entryId}`);
}

export function updatePayrollEntry(entryId: string, input: PayrollEntryUpdate) {
  return apiFetch<PayrollEntry>(`/payroll/entries/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function addPayrollAdjustment(
  entryId: string,
  input: { adjustment_type: string; amount: number; reason: string },
) {
  return apiFetch<PayrollEntry>(`/payroll/entries/${entryId}/adjustments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function removePayrollAdjustment(adjustmentId: string) {
  return apiFetch<{ deleted: boolean }>(`/payroll/adjustments/${adjustmentId}`, {
    method: "DELETE",
  });
}

export function updatePayrollRunStatus(
  runId: string,
  status: "draft" | "approved" | "locked" | "paid",
  reason?: string,
) {
  return apiFetch<PayrollSheet["run"]>(`/payroll/runs/${runId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason }),
  });
}

export function getPayrollExceptions(
  month: string,
  range?: { start_date?: string; end_date?: string },
) {
  return apiFetch<Record<string, PayrollEntry[]>>(
    withQuery("/payroll/exceptions", { month, ...range }),
  );
}

export type PayrollSettings = {
  cycle_start_day: number;
  cycle_end_day: number;
  timezone: string;
};

export function getPayrollSettings() {
  return apiFetch<PayrollSettings>("/payroll/settings");
}

export function updatePayrollSettings(input: PayrollSettings) {
  return apiFetch<PayrollSettings>("/payroll/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function createScheduleOverride(input: {
  scope: "employee" | "employees" | "team" | "company";
  override_type: "shift" | "breaks" | "both";
  employee_id?: string;
  employee_ids?: string[];
  team_id?: string;
  effective_date?: string;
  permanent: boolean;
  shift_start?: string;
  shift_end?: string;
  break_rules?: Array<{
    name: string;
    minutes: number;
    paid: boolean;
    start_time: string;
    end_time: string;
  }>;
  reason: string;
}) {
  return apiFetch<{ id: string; affected_employees: number }>("/payroll/schedule-overrides", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type ScheduleOverride = {
  id: string;
  scope: "employee" | "team" | "company";
  override_type: "shift" | "breaks" | "both";
  employee_id?: string | null;
  employee_name?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  effective_date?: string | null;
  break_rules?: Array<{
    name: string;
    minutes: number;
    paid: boolean;
    start_time?: string | null;
    end_time?: string | null;
  }> | null;
  shift_start?: string | null;
  shift_end?: string | null;
  reason: string;
  created_at: string;
};

export function listScheduleOverrides(upcomingOnly = true) {
  return apiFetch<ScheduleOverride[]>(
    withQuery("/payroll/schedule-overrides", { upcoming_only: upcomingOnly }),
  );
}

export function deleteScheduleOverride(overrideId: string) {
  return apiFetch<{ deleted: boolean }>(`/payroll/schedule-overrides/${overrideId}`, {
    method: "DELETE",
  });
}

export async function downloadPayroll(filters: PayrollFilters, format: "csv" | "excel" | "pdf") {
  const blob = await apiFile(withQuery("/payroll/export", { ...filters, format }));
  const extension = format === "excel" ? "xlsx" : format;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `payroll-${filters.month}.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
