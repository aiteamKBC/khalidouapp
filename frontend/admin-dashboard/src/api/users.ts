import { apiFetch, apiFetchWithMeta, withQuery } from "./client";
import { mapUser } from "./auth";
import type { AuditLogEntry, Role, User, UserStatus } from "@/types";

type BackendUser = {
  id: string;
  employee_id?: string | null;
  name: string;
  email: string;
  job_title?: string | null;
  role: Role;
  is_super_admin?: boolean;
  permissions?: string[];
  assigned_team_ids?: string[];
  status: UserStatus;
  updated_at?: string;
};

type BackendAuditLogEntry = {
  id: string;
  at: string;
  user_id: string;
  user_name: string;
  action: string;
  entity_type: string;
  entity_name: string;
  ip: string;
  details?: string;
};

export type UserCreateInput = {
  name: string;
  email: string;
  jobTitle?: string;
  password: string;
  role: Role;
};

export async function listUsers(signal?: AbortSignal): Promise<User[]> {
  const users = await apiFetch<BackendUser[]>("/users", { signal });
  return users.map(mapUser);
}

export async function updateUser(
  id: string,
  input: Partial<UserCreateInput> & { status?: string },
): Promise<User> {
  const user = await apiFetch<BackendUser>(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      job_title: input.jobTitle,
      password: input.password,
      role: input.role,
      status: input.status,
    }),
  });
  return mapUser(user);
}

export type AuditLogFilters = {
  page?: number;
  pageSize?: number;
  userId?: string;
  action?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
  tz?: string;
};

export type AuditLogPage = {
  rows: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  availableActions: string[];
  availableEntityTypes: string[];
};

function mapAuditRow(row: BackendAuditLogEntry): AuditLogEntry {
  return {
    id: row.id,
    at: row.at,
    userId: row.user_id,
    userName: row.user_name,
    action: row.action,
    entityType: row.entity_type,
    entityName: row.entity_name,
    ip: row.ip,
    details: row.details,
  };
}

export async function listAuditLog(
  filters: AuditLogFilters = {},
  signal?: AbortSignal,
): Promise<AuditLogPage> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 100;
  const { data, meta } = await apiFetchWithMeta<BackendAuditLogEntry[]>(
    withQuery("/audit-log", {
      page,
      page_size: pageSize,
      user_id: filters.userId,
      action: filters.action,
      entity_type: filters.entityType,
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      // Match date filtering to the timezone the timestamps are displayed in (W12).
      tz: filters.tz,
    }),
    { signal },
  );
  const total = typeof meta.total === "number" ? meta.total : data.length;
  return {
    rows: data.map(mapAuditRow),
    total,
    page: typeof meta.page === "number" ? meta.page : page,
    pageSize: typeof meta.page_size === "number" ? meta.page_size : pageSize,
    totalPages:
      typeof meta.total_pages === "number"
        ? meta.total_pages
        : Math.max(1, Math.ceil(total / pageSize)),
    availableActions: Array.isArray(meta.available_actions)
      ? (meta.available_actions as string[])
      : [],
    availableEntityTypes: Array.isArray(meta.available_entity_types)
      ? (meta.available_entity_types as string[])
      : [],
  };
}
