import { apiFetch } from "./client";
import type { User } from "@/types";

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
  role: "general_admin" | "team_owner";
  permissions?: string[];
  status: "active" | "inactive";
  assigned_team_ids?: string[];
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
    role: user.role,
    permissions: user.permissions ?? [],
    assignedTeamIds: user.assigned_team_ids ?? [],
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

export async function me(token: string): Promise<User> {
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
