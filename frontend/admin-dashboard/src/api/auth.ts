import { apiFetch } from "./client";
import { normalizeAiAcronym } from "@/lib/text";
import type { DataScope, PermissionMode, User } from "@/types";

type BackendAuthTokens = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

type BackendUser = {
  id: string;
  employee_id?: string | null;
  name: string;
  email: string;
  job_title?: string | null;
  role: "general_admin" | "team_owner" | "hr";
  permissions?: string[];
  status: "active" | "inactive";
  assigned_team_ids?: string[];
  permission_mode?: PermissionMode;
  data_scope?: DataScope;
  team_lead_team_ids?: string[];
  track_as_employee?: boolean;
  tracked_employee_id?: string | null;
  avatar_url?: string | null;
};

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export function mapUser(user: BackendUser): User {
  return {
    id: user.id,
    employeeId: user.employee_id ?? undefined,
    name: user.name,
    email: user.email,
    jobTitle: user.job_title ? normalizeAiAcronym(user.job_title) : undefined,
    role: user.role,
    permissions: user.permissions ?? [],
    assignedTeamIds: user.assigned_team_ids ?? [],
    permissionMode: user.permission_mode ?? "role",
    dataScope: user.data_scope ?? (user.role === "general_admin" ? "company" : "assigned_teams"),
    teamLeadTeamIds: user.team_lead_team_ids ?? user.assigned_team_ids ?? [],
    trackAsEmployee: user.track_as_employee ?? Boolean(user.employee_id),
    trackedEmployeeId: user.tracked_employee_id ?? user.employee_id ?? undefined,
    status: user.status,
    avatarUrl: user.avatar_url ?? undefined,
  };
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const tokens = await apiFetch<BackendAuthTokens>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const user = await apiFetch<BackendUser>("/auth/me", {}, tokens.access_token);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    user: mapUser(user),
  };
}

export async function me(token?: string): Promise<User> {
  return mapUser(await apiFetch<BackendUser>("/auth/me", {}, token));
}

export async function logout(refreshToken?: string | null): Promise<void> {
  if (!refreshToken) return;
  await apiFetch("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function forgotPassword(email: string): Promise<void> {
  await apiFetch("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await apiFetch("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

export async function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiFetch(
    "/auth/change-password",
    {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    },
    token,
  );
}

export async function updateProfile(
  token: string,
  input: { name?: string; avatarUrl?: string | null },
): Promise<User> {
  return mapUser(
    await apiFetch<BackendUser>(
      "/auth/me",
      {
        method: "PATCH",
        body: JSON.stringify({ name: input.name, avatar_url: input.avatarUrl }),
      },
      token,
    ),
  );
}
