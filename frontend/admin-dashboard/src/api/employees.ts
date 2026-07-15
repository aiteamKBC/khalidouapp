import { apiFetch, toMinutes, withQuery } from "./client";
import type { Employee, EmployeeAccountStatus, EmployeeStatus, EnrollmentCode } from "@/types";

type BackendEmployee = {
  id: string;
  name: string;
  email: string;
  employee_code: string;
  department?: string | null;
  timezone: string;
  status: string;
  invitation?: {
    id: string;
    status: "pending" | "accepted" | "expired" | "revoked";
    expires_at: string;
  } | null;
  portal_access_enabled?: boolean;
  portal_access_key_hint?: string | null;
  portal_last_login_at?: string | null;
  portal_last_login_ip?: string | null;
  portal_last_user_agent?: string | null;
  weekly_capacity_minutes?: number;
};

type BackendDevice = {
  id: string;
  device_name: string;
};

type BackendEmployeeStatus = {
  employee: BackendEmployee;
  activity_status: EmployeeStatus | "active" | "inactive";
  current_session?: {
    id: string;
    team_id?: string | null;
    project_id?: string | null;
    task_id?: string | null;
  } | null;
  session_start_time?: string | null;
  worked_today_seconds: number;
  active_seconds: number;
  idle_seconds: number;
  last_heartbeat?: string | null;
  last_screenshot?: string | null;
  device?: BackendDevice | null;
  team_ids?: string[];
};

type BackendEnrollmentCode = {
  id: string;
  employee_id: string;
  code_hint: string;
  status: "active" | "used" | "expired" | "revoked";
  expires_at: string;
  used_at?: string | null;
  created_at: string;
  code?: string;
};

export type EmployeeCreateInput = {
  name: string;
  email: string;
  employeeCode?: string;
  department?: string;
  timezone?: string;
};

export type WorkProfile = {
  id: string;
  employeeId: string;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  workingDays?: number[] | null;
  weeklyOffDays?: number[] | null;
  requiredDailyMinutes?: number | null;
  breakRules?: Array<{ name: string; minutes: number; paid: boolean; start_time?: string | null; end_time?: string | null }> | null;
  lateGraceMinutes?: number | null;
  deductionPolicy?: { mode: "review" | "per_minute" | "brackets"; require_admin_review: boolean; brackets: Array<{ after_minutes: number; deduct_minutes: number; note?: string | null }> } | null;
  overtimeEnabled: boolean;
  overtimeBasis?: "beyond_daily_required" | "outside_shift" | "either" | null;
  overtimeRateMultiplier?: number | null;
  salaryAmount?: number | null;
  salaryCurrency?: "EGP" | "GBP" | "USD" | "EUR" | "SAR" | "AED" | null;
  completeness: { complete: boolean; missing_fields: string[]; completed_at?: string | null };
};

export type WorkProfileInput = {
  shiftStart?: string;
  shiftEnd?: string;
  workingDays?: number[];
  weeklyOffDays?: number[];
  requiredDailyMinutes?: number;
  breakRules?: WorkProfile["breakRules"];
  lateGraceMinutes?: number;
  deductionPolicy?: WorkProfile["deductionPolicy"];
  overtimeEnabled?: boolean;
  overtimeBasis?: WorkProfile["overtimeBasis"];
  overtimeRateMultiplier?: number;
  salaryAmount?: number;
  salaryCurrency?: WorkProfile["salaryCurrency"];
};

export type PayrollPreview = {
  employee_id: string;
  currency: string;
  base_salary: number;
  required_seconds: number;
  active_seconds: number;
  idle_seconds: number;
  overtime_seconds: number;
  overtime_amount: number;
  deduction_amount: number;
  estimated_total: number;
  notes: string[];
};

function normalizeEmployeeStatus(value?: string | null): EmployeeStatus {
  if (value === "idle" || value === "locked" || value === "sleeping" || value === "offline")
    return value;
  return "active";
}

function normalizeEmployeeAccountStatus(value?: string | null): EmployeeAccountStatus {
  if (value === "invited" || value === "inactive") return value;
  return "active";
}

function mapEmployee(status: BackendEmployeeStatus, teamIds: string[]): Employee {
  const employee = status.employee;
  return {
    id: employee.id,
    name: employee.name,
    code: employee.employee_code,
    email: employee.email,
    department: employee.department ?? "",
    teamIds,
    status: normalizeEmployeeStatus(status.activity_status),
    sessionStart: status.session_start_time ?? undefined,
    workedTodayMinutes: toMinutes(status.worked_today_seconds),
    activeMinutes: toMinutes(status.active_seconds),
    idleMinutes: toMinutes(status.idle_seconds),
    lastHeartbeat: status.last_heartbeat ?? undefined,
    lastScreenshotAt: status.last_screenshot ?? undefined,
    currentDeviceId: status.device?.id,
    currentTeamId: status.current_session?.team_id ?? undefined,
    currentProjectId: status.current_session?.project_id ?? undefined,
    currentTaskId: status.current_session?.task_id ?? undefined,
    active: employee.status === "active",
    accountStatus: normalizeEmployeeAccountStatus(employee.status),
    invitation: employee.invitation
      ? {
          id: employee.invitation.id,
          status: employee.invitation.status,
          expiresAt: employee.invitation.expires_at,
        }
      : undefined,
    portalAccessEnabled: employee.portal_access_enabled === true,
    portalAccessKeyHint: employee.portal_access_key_hint ?? undefined,
    portalLastLoginAt: employee.portal_last_login_at ?? undefined,
    portalLastLoginIp: employee.portal_last_login_ip ?? undefined,
    portalLastUserAgent: employee.portal_last_user_agent ?? undefined,
    weeklyCapacityMinutes: employee.weekly_capacity_minutes ?? 2400,
  };
}

function mapEnrollmentCode(row: BackendEnrollmentCode): EnrollmentCode {
  return {
    id: row.id,
    employeeId: row.employee_id,
    codeHint: row.code_hint,
    status: row.status,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? undefined,
    createdAt: row.created_at,
    code: row.code,
  };
}

function mapWorkProfile(row: any): WorkProfile {
  return {
    id: row.id,
    employeeId: row.employee_id,
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end,
    workingDays: row.working_days,
    weeklyOffDays: row.weekly_off_days,
    requiredDailyMinutes: row.required_daily_minutes,
    breakRules: row.break_rules,
    lateGraceMinutes: row.late_grace_minutes,
    deductionPolicy: row.deduction_policy,
    overtimeEnabled: row.overtime_enabled,
    overtimeBasis: row.overtime_basis,
    overtimeRateMultiplier: row.overtime_rate_multiplier,
    salaryAmount: row.salary_amount,
    salaryCurrency: row.salary_currency,
    completeness: row.completeness,
  };
}

export async function listEmployees(scopedTeamIds?: string[]): Promise<Employee[]> {
  const teamId = scopedTeamIds?.length === 1 ? scopedTeamIds[0] : undefined;
  const statuses = await apiFetch<BackendEmployeeStatus[]>(
    withQuery("/employees-overview", { team_id: teamId }),
  );
  return statuses.map((status) => mapEmployee(status, status.team_ids ?? []));
}

export async function getEmployee(id: string): Promise<Employee | undefined> {
  const statuses = await apiFetch<BackendEmployeeStatus[]>(
    withQuery("/employees-overview", { employee_id: id }),
  );
  const status = statuses[0];
  return status ? mapEmployee(status, status.team_ids ?? []) : undefined;
}

export async function createEmployee(input: EmployeeCreateInput): Promise<Employee> {
  const created = await apiFetch<BackendEmployee>("/employees", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      employee_code: input.employeeCode || undefined,
      department: input.department || undefined,
      timezone: input.timezone || "Africa/Cairo",
      status: "active",
    }),
  });
  return (await getEmployee(created.id))!;
}

export async function listEnrollmentCodes(employeeId: string): Promise<EnrollmentCode[]> {
  const rows = await apiFetch<BackendEnrollmentCode[]>(`/employees/${employeeId}/enrollment-codes`);
  return rows.map(mapEnrollmentCode);
}

export async function createEnrollmentCode(
  employeeId: string,
  expiresInDays = 14,
): Promise<EnrollmentCode> {
  const row = await apiFetch<BackendEnrollmentCode>(`/employees/${employeeId}/enrollment-codes`, {
    method: "POST",
    body: JSON.stringify({ expires_in_days: expiresInDays }),
  });
  return mapEnrollmentCode(row);
}

export async function revokeEnrollmentCode(
  employeeId: string,
  codeId: string,
): Promise<EnrollmentCode> {
  const row = await apiFetch<BackendEnrollmentCode>(
    `/employees/${employeeId}/enrollment-codes/${codeId}`,
    { method: "DELETE" },
  );
  return mapEnrollmentCode(row);
}

export async function createPortalAccessKey(employeeId: string): Promise<{
  email: string;
  accessKey: string;
  accessKeyHint: string;
}> {
  const row = await apiFetch<{
    email: string;
    access_key: string;
    access_key_hint: string;
  }>(`/employees/${employeeId}/portal-access-key`, { method: "POST" });
  return {
    email: row.email,
    accessKey: row.access_key,
    accessKeyHint: row.access_key_hint,
  };
}

export async function revokePortalAccessKey(employeeId: string): Promise<void> {
  await apiFetch(`/employees/${employeeId}/portal-access-key`, { method: "DELETE" });
}

export async function getWorkProfile(employeeId: string): Promise<WorkProfile> {
  return mapWorkProfile(await apiFetch(`/employees/${employeeId}/work-profile`));
}

export async function updateWorkProfile(employeeId: string, input: WorkProfileInput): Promise<WorkProfile> {
  return mapWorkProfile(
    await apiFetch(`/employees/${employeeId}/work-profile`, {
      method: "PATCH",
      body: JSON.stringify({
        shift_start: input.shiftStart,
        shift_end: input.shiftEnd,
        working_days: input.workingDays,
        weekly_off_days: input.weeklyOffDays,
        required_daily_minutes: input.requiredDailyMinutes,
        break_rules: input.breakRules,
        late_grace_minutes: input.lateGraceMinutes,
        deduction_policy: input.deductionPolicy,
        overtime_enabled: input.overtimeEnabled,
        overtime_basis: input.overtimeBasis,
        overtime_rate_multiplier: input.overtimeRateMultiplier,
        salary_amount: input.salaryAmount,
        salary_currency: input.salaryCurrency,
      }),
    }),
  );
}

export async function sendEmployeeInvitation(employeeId: string): Promise<void> {
  await apiFetch(`/employees/${employeeId}/send-invitation`, { method: "POST" });
}

export async function getPayrollPreview(employeeId: string): Promise<PayrollPreview> {
  return apiFetch(`/employees/${employeeId}/payroll-preview`);
}
