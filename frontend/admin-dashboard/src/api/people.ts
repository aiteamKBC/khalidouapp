import { apiFetch } from "./client";

export type PersonInvitationInput = {
  name: string;
  email: string;
  kind: "employee" | "team_manager" | "general_admin";
  teamIds: string[];
  department?: string;
  timezone?: string;
};

export type PersonInvitationResult = {
  kind: PersonInvitationInput["kind"];
  employeeId?: string;
  adminUserId?: string;
  teamIds: string[];
  emailQueued: boolean;
};

export async function invitePerson(input: PersonInvitationInput): Promise<PersonInvitationResult> {
  const row = await apiFetch<{
    kind: PersonInvitationInput["kind"];
    employee_id?: string | null;
    admin_user_id?: string | null;
    team_ids: string[];
    email_queued: boolean;
  }>("/people/invitations", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      kind: input.kind,
      team_ids: input.teamIds,
      department: input.department || null,
      timezone: input.timezone || "Africa/Cairo",
    }),
  });
  return {
    kind: row.kind,
    employeeId: row.employee_id ?? undefined,
    adminUserId: row.admin_user_id ?? undefined,
    teamIds: row.team_ids,
    emailQueued: row.email_queued,
  };
}
