import { apiFetch, toMinutes, withQuery } from "./client";
import type { Employee, EmployeeStatus, EnrollmentCode } from "@/types";

type BackendEmployee = {
  id: string;
  name: string;
  email: string;
  employee_code: string;
  department?: string | null;
  timezone: string;
  status: string;
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

function normalizeEmployeeStatus(value?: string | null): EmployeeStatus {
  if (value === "idle" || value === "locked" || value === "sleeping" || value === "offline")
    return value;
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
