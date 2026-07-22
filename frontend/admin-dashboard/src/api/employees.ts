import { apiFetch, toMinutes, withQuery } from "./client";
import { normalizeAiAcronym } from "@/lib/text";
import type { Employee, EmployeeAccountStatus, EmployeeStatus, TeamMemberRole } from "@/types";

type BackendEmployee = {
  id: string;
  name: string;
  email: string;
  employee_code: string;
  job_title?: string | null;
  timezone: string;
  status: string;
  invitation?: {
    id: string;
    status: "pending" | "accepted" | "expired" | "revoked";
    expires_at: string;
  } | null;
  portal_access_enabled?: boolean;
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
  team_role?: TeamMemberRole | null;
};

export type EmployeeCreateInput = {
  name: string;
  email: string;
  employeeCode?: string;
  jobTitle?: string;
  timezone?: string;
};

export type EmployeeUpdateInput = Partial<EmployeeCreateInput> & {
  status?: "active" | "inactive";
  weeklyCapacityMinutes?: number;
};

export type WorkProfile = {
  id: string;
  employeeId: string;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  workingDays?: number[] | null;
  weeklyOffDays?: number[] | null;
  requiredDailyMinutes?: number | null;
  breakRules?: Array<{
    name: string;
    minutes: number;
    paid: boolean;
    start_time?: string | null;
    end_time?: string | null;
  }> | null;
  lateGraceMinutes?: number | null;
  noShowThresholdMinutes?: number | null;
  scheduleType?: "fixed" | "flexible" | null;
  weeklyEarlyLeaveMinutes?: number | null;
  deductionPolicy?: {
    mode: "review" | "per_minute" | "brackets";
    require_admin_review: boolean;
    brackets: Array<{ after_minutes: number; deduct_minutes: number; note?: string | null }>;
  } | null;
  overtimeEnabled: boolean;
  overtimeBasis?: "beyond_daily_required" | "outside_shift" | "either" | null;
  overtimeRateMultiplier?: number | null;
  salaryAmount?: number | null;
  salaryCurrency?: "EGP" | "GBP" | "USD" | "EUR" | "SAR" | "AED" | null;
  salaryType: "monthly" | "hourly";
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
  noShowThresholdMinutes?: number;
  scheduleType?: WorkProfile["scheduleType"];
  weeklyEarlyLeaveMinutes?: number;
  deductionPolicy?: WorkProfile["deductionPolicy"];
  overtimeEnabled?: boolean;
  overtimeBasis?: WorkProfile["overtimeBasis"];
  overtimeRateMultiplier?: number;
  salaryAmount?: number;
  salaryCurrency?: WorkProfile["salaryCurrency"];
  salaryType?: WorkProfile["salaryType"];
};

type BackendWorkProfile = {
  id: string;
  employee_id: string;
  shift_start?: string | null;
  shift_end?: string | null;
  working_days?: number[] | null;
  weekly_off_days?: number[] | null;
  required_daily_minutes?: number | null;
  break_rules?: WorkProfile["breakRules"];
  late_grace_minutes?: number | null;
  no_show_threshold_minutes?: number | null;
  schedule_type?: WorkProfile["scheduleType"];
  weekly_early_leave_minutes?: number | null;
  deduction_policy?: WorkProfile["deductionPolicy"];
  overtime_enabled: boolean;
  overtime_basis?: WorkProfile["overtimeBasis"];
  overtime_rate_multiplier?: number | null;
  salary_amount?: number | null;
  salary_currency?: WorkProfile["salaryCurrency"];
  salary_type?: WorkProfile["salaryType"];
  completeness: WorkProfile["completeness"];
};

export type PayrollPreview = {
  employee_id: string;
  currency: string;
  base_salary: number;
  hourly_rate: number;
  monthly_paid_hours: number;
  required_seconds: number;
  paid_break_seconds: number;
  unpaid_break_seconds: number;
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
    jobTitle: normalizeAiAcronym(employee.job_title ?? ""),
    timezone: employee.timezone || "Africa/Cairo",
    teamRole: status.team_role ?? undefined,
    teamIds,
    status: normalizeEmployeeStatus(status.activity_status),
    sessionStart: status.session_start_time ?? undefined,
    workedTodayMinutes: toMinutes(status.worked_today_seconds),
    activeMinutes: toMinutes(status.active_seconds),
    idleMinutes: toMinutes(status.idle_seconds),
    lastHeartbeat: status.last_heartbeat ?? undefined,
    lastScreenshotAt: status.last_screenshot ?? undefined,
    currentDeviceId: status.device?.id,
    currentDeviceName: status.device?.device_name,
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
    portalLastLoginAt: employee.portal_last_login_at ?? undefined,
    portalLastLoginIp: employee.portal_last_login_ip ?? undefined,
    portalLastUserAgent: employee.portal_last_user_agent ?? undefined,
    weeklyCapacityMinutes: employee.weekly_capacity_minutes ?? 2400,
  };
}

function mapWorkProfile(row: BackendWorkProfile): WorkProfile {
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
    noShowThresholdMinutes: row.no_show_threshold_minutes,
    scheduleType: row.schedule_type,
    weeklyEarlyLeaveMinutes: row.weekly_early_leave_minutes,
    deductionPolicy: row.deduction_policy,
    overtimeEnabled: row.overtime_enabled,
    overtimeBasis: row.overtime_basis,
    overtimeRateMultiplier: row.overtime_rate_multiplier,
    salaryAmount: row.salary_amount,
    salaryCurrency: row.salary_currency,
    salaryType: row.salary_type ?? "monthly",
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
      job_title: input.jobTitle ? normalizeAiAcronym(input.jobTitle) : undefined,
      timezone: input.timezone || "Africa/Cairo",
      status: "active",
    }),
  });
  return (await getEmployee(created.id))!;
}

export async function updateEmployee(
  employeeId: string,
  input: EmployeeUpdateInput,
): Promise<Employee> {
  await apiFetch<BackendEmployee>(`/employees/${employeeId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      employee_code: input.employeeCode,
      job_title: input.jobTitle === undefined ? undefined : normalizeAiAcronym(input.jobTitle),
      timezone: input.timezone,
      status: input.status,
      weekly_capacity_minutes: input.weeklyCapacityMinutes,
    }),
  });
  return (await getEmployee(employeeId))!;
}

export async function updateEmployeePassword(
  employeeId: string,
  password: string,
): Promise<Employee> {
  await apiFetch(`/employees/${employeeId}/password`, {
    method: "PATCH",
    body: JSON.stringify({ password }),
  });
  return (await getEmployee(employeeId))!;
}

export async function getWorkProfile(employeeId: string): Promise<WorkProfile> {
  return mapWorkProfile(await apiFetch(`/employees/${employeeId}/work-profile`));
}

export type EmployeeBreakRules = {
  employeeId: string;
  name: string;
  email: string;
  jobTitle?: string | null;
  timezone: string;
  shiftStart: string;
  shiftEnd: string;
  requiredDailyMinutes: number;
  breakRules: WorkProfile["breakRules"];
  workingDays: number[];
  weeklyOffDays: number[];
  lateGraceMinutes: number;
  overtimeEnabled: boolean;
  overtimeRateMultiplier: number;
  salaryAmount: number;
  salaryCurrency: WorkProfile["salaryCurrency"];
  salaryType: WorkProfile["salaryType"];
};

export async function listEmployeeBreakRules(
  scopedTeamIds?: string[],
): Promise<EmployeeBreakRules[]> {
  const teamId = scopedTeamIds?.length === 1 ? scopedTeamIds[0] : undefined;
  const rows = await apiFetch<
    Array<{
      employee_id: string;
      name: string;
      email: string;
      job_title?: string | null;
      timezone: string;
      shift_start: string;
      shift_end: string;
      required_daily_minutes: number;
      break_rules: WorkProfile["breakRules"];
      working_days: number[];
      weekly_off_days: number[];
      late_grace_minutes: number;
      overtime_enabled: boolean;
      overtime_rate_multiplier: number;
      salary_amount: number;
      salary_currency: WorkProfile["salaryCurrency"];
      salary_type: WorkProfile["salaryType"];
    }>
  >(withQuery("/employees/break-rules", { team_id: teamId }));
  return rows.map((row) => ({
    employeeId: row.employee_id,
    name: row.name,
    email: row.email,
    jobTitle: row.job_title,
    timezone: row.timezone,
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end,
    requiredDailyMinutes: row.required_daily_minutes,
    breakRules: row.break_rules,
    workingDays: row.working_days,
    weeklyOffDays: row.weekly_off_days,
    lateGraceMinutes: row.late_grace_minutes,
    overtimeEnabled: row.overtime_enabled,
    overtimeRateMultiplier: row.overtime_rate_multiplier,
    salaryAmount: row.salary_amount,
    salaryCurrency: row.salary_currency,
    salaryType: row.salary_type,
  }));
}

export async function updateWorkProfile(
  employeeId: string,
  input: WorkProfileInput,
): Promise<WorkProfile> {
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
        no_show_threshold_minutes: input.noShowThresholdMinutes,
        schedule_type: input.scheduleType,
        weekly_early_leave_minutes: input.weeklyEarlyLeaveMinutes,
        deduction_policy: input.deductionPolicy,
        overtime_enabled: input.overtimeEnabled,
        overtime_basis: input.overtimeBasis,
        overtime_rate_multiplier: input.overtimeRateMultiplier,
        salary_amount: input.salaryAmount,
        salary_currency: input.salaryCurrency,
        salary_type: input.salaryType,
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
