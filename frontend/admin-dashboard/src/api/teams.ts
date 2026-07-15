import { apiFetch, toMinutes, withQuery } from "./client";
import { mapUser } from "./auth";
import type { Team, User } from "@/types";

type BackendTeam = {
  id: string;
  name: string;
  description?: string | null;
  status: "active" | "archived" | "deleted";
  created_at: string;
  employee_ids?: string[];
  owner_ids?: string[];
};

type BackendEmployee = {
  id: string;
};

type BackendUser = {
  id: string;
  employee_id?: string | null;
  name: string;
  email: string;
  role: "general_admin" | "team_owner" | "hr";
  permissions?: string[];
  status: "active" | "inactive";
  assigned_team_ids?: string[];
};

export type TeamCreateInput = {
  name: string;
  description?: string;
};

function mapTeam(team: BackendTeam, employeeIds: string[], ownerIds: string[]): Team {
  return {
    id: team.id,
    name: team.name,
    description: team.description ?? "",
    status: team.status === "deleted" ? "archived" : team.status,
    ownerIds,
    employeeIds,
    createdAt: team.created_at,
  };
}

export async function listTeamMembers(teamId: string) {
  return apiFetch<BackendEmployee[]>(`/teams/${teamId}/members`);
}

export async function listTeamOwners(teamId: string): Promise<User[]> {
  const owners = await apiFetch<BackendUser[]>(`/teams/${teamId}/owners`);
  return owners.map(mapUser);
}

async function enrichTeam(team: BackendTeam): Promise<Team> {
  const [members, owners] = await Promise.all([listTeamMembers(team.id), listTeamOwners(team.id)]);
  return mapTeam(
    team,
    members.map((member) => member.id),
    owners.map((owner) => owner.id),
  );
}

export async function listTeams(scopedTeamIds?: string[]): Promise<Team[]> {
  const teams = await apiFetch<BackendTeam[]>(
    withQuery("/teams", { page_size: 100, include_relations: "true" }),
  );
  const filtered = scopedTeamIds?.length
    ? teams.filter((team) => scopedTeamIds.includes(team.id))
    : teams;
  return filtered.map((team) => mapTeam(team, team.employee_ids ?? [], team.owner_ids ?? []));
}

export async function getTeam(id: string): Promise<Team | undefined> {
  return enrichTeam(await apiFetch<BackendTeam>(`/teams/${id}`));
}

export async function createTeam(input: TeamCreateInput): Promise<Team> {
  const team = await apiFetch<BackendTeam>("/teams", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description || null,
      status: "active",
    }),
  });
  return enrichTeam(team);
}

export async function updateTeam(
  id: string,
  input: Partial<TeamCreateInput> & { status?: string },
): Promise<Team> {
  const team = await apiFetch<BackendTeam>(`/teams/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      status: input.status,
    }),
  });
  return enrichTeam(team);
}

export async function deleteTeam(id: string): Promise<void> {
  await apiFetch(`/teams/${id}`, { method: "DELETE" });
}

export async function addTeamMember(teamId: string, employeeId: string): Promise<void> {
  await apiFetch(`/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ employee_id: employeeId, status: "active" }),
  });
}

export async function removeTeamMember(teamId: string, employeeId: string): Promise<void> {
  await apiFetch(`/teams/${teamId}/members/${employeeId}`, { method: "DELETE" });
}

export async function addTeamOwner(teamId: string, adminUserId: string): Promise<void> {
  await apiFetch(`/teams/${teamId}/owners`, {
    method: "POST",
    body: JSON.stringify({ admin_user_id: adminUserId }),
  });
}

export async function removeTeamOwner(teamId: string, adminUserId: string): Promise<void> {
  await apiFetch(`/teams/${teamId}/owners/${adminUserId}`, { method: "DELETE" });
}

export async function teamStats(id: string) {
  const summary = await apiFetch<{
    total_employees: number;
    online_employees: number;
    idle_employees: number;
    active_seconds: number;
    idle_seconds: number;
    total_hours_today: number;
    screenshots_today: number;
    screenshot_count: number;
  }>(`/teams/${id}/summary`);
  return {
    total: summary.total_employees,
    online: summary.online_employees,
    idle: summary.idle_employees,
    offline: Math.max(0, summary.total_employees - summary.online_employees),
    hoursToday: summary.total_hours_today,
    activeMin: toMinutes(summary.active_seconds),
    idleMin: toMinutes(summary.idle_seconds),
    screenshots: summary.screenshot_count,
  };
}
