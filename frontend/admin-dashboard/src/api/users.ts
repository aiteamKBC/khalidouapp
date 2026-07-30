import { apiFetch } from "./client";
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

export async function listAuditLog(signal?: AbortSignal): Promise<AuditLogEntry[]> {
  const rows = await apiFetch<BackendAuditLogEntry[]>("/audit-log", { signal });
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    userId: row.user_id,
    userName: row.user_name,
    action: row.action,
    entityType: row.entity_type,
    entityName: row.entity_name,
    ip: row.ip,
    details: row.details,
  }));
}
