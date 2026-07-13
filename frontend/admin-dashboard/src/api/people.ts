import { apiFetch } from "./client";

export type PersonInvitationInput = {
  name: string;
  email: string;
  kind: "employee" | "team_manager" | "general_admin";
  teamIds: string[];
  department?: string;
  timezone?: string;
  trackAsEmployee?: boolean;
};

export type PersonInvitationResult = {
  kind: PersonInvitationInput["kind"];
  employeeId?: string;
  adminUserId?: string;
  teamIds: string[];
  emailQueued: boolean;
  invitation?: PersonInvitationSummary;
};

export type PersonInvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export type PersonInvitationSummary = {
  id: string;
  status: PersonInvitationStatus;
  expiresAt: string;
};

export type PublicPersonInvitation =
  | {
      valid: true;
      status: "pending";
      name: string;
      email: string;
      kind: "employee";
      expiresAt: string;
    }
  | {
      valid: false;
      status: PersonInvitationStatus | "invalid";
    };

type BackendInvitationSummary = {
  id: string;
  status: PersonInvitationStatus;
  expires_at: string;
};

function mapInvitation(invitation: BackendInvitationSummary): PersonInvitationSummary {
  return {
    id: invitation.id,
    status: invitation.status,
    expiresAt: invitation.expires_at,
  };
}

export async function invitePerson(input: PersonInvitationInput): Promise<PersonInvitationResult> {
  const row = await apiFetch<{
    kind: PersonInvitationInput["kind"];
    employee_id?: string | null;
    admin_user_id?: string | null;
    team_ids: string[];
    email_queued: boolean;
    invitation?: BackendInvitationSummary | null;
  }>("/people/invitations", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      kind: input.kind,
      team_ids: input.teamIds,
      department: input.department || null,
      timezone: input.timezone || "Africa/Cairo",
      track_as_employee: input.trackAsEmployee ?? false,
    }),
  });
  return {
    kind: row.kind,
    employeeId: row.employee_id ?? undefined,
    adminUserId: row.admin_user_id ?? undefined,
    teamIds: row.team_ids,
    emailQueued: row.email_queued,
    invitation: row.invitation ? mapInvitation(row.invitation) : undefined,
  };
}

export type PersonArchiveResult = {
  personType: "admin" | "employee";
  adminUserId?: string;
  employeeId?: string;
  archived: boolean;
  adminStatus?: string;
  employeeStatus?: string;
};

async function setPersonArchived(
  personType: "admin" | "employee",
  personId: string,
  archived: boolean,
): Promise<PersonArchiveResult> {
  const row = await apiFetch<{
    person_type: "admin" | "employee";
    admin_user_id?: string | null;
    employee_id?: string | null;
    archived: boolean;
    admin_status?: string | null;
    employee_status?: string | null;
  }>(`/people/${personType}/${personId}/${archived ? "archive" : "restore"}`, {
    method: "POST",
  });
  return {
    personType: row.person_type,
    adminUserId: row.admin_user_id ?? undefined,
    employeeId: row.employee_id ?? undefined,
    archived: row.archived,
    adminStatus: row.admin_status ?? undefined,
    employeeStatus: row.employee_status ?? undefined,
  };
}

export function archivePerson(personType: "admin" | "employee", personId: string) {
  return setPersonArchived(personType, personId, true);
}

export function restorePerson(personType: "admin" | "employee", personId: string) {
  return setPersonArchived(personType, personId, false);
}

export async function getPersonInvitation(token: string): Promise<PublicPersonInvitation> {
  const row = await apiFetch<{
    valid: boolean;
    status: PersonInvitationStatus | "invalid";
    name?: string;
    email?: string;
    kind?: "employee";
    expires_at?: string;
  }>(`/people/invitations/${encodeURIComponent(token)}`);
  if (!row.valid || row.status !== "pending") {
    return { valid: false, status: row.status };
  }
  if (!row.name || !row.email || row.kind !== "employee" || !row.expires_at) {
    return { valid: false, status: "invalid" };
  }
  return {
    valid: true,
    status: "pending",
    name: row.name,
    email: row.email,
    kind: row.kind,
    expiresAt: row.expires_at,
  };
}

export async function acceptPersonInvitation(
  token: string,
  password: string,
): Promise<{ status: "accepted"; employeeId: string }> {
  const row = await apiFetch<{ status: "accepted"; employee_id: string }>(
    `/people/invitations/${encodeURIComponent(token)}`,
    {
      method: "POST",
      body: JSON.stringify({ password }),
    },
  );
  return { status: row.status, employeeId: row.employee_id };
}

export async function resendPersonInvitation(invitationId: string): Promise<{
  invitation: PersonInvitationSummary;
  emailQueued: boolean;
}> {
  const row = await apiFetch<{
    invitation: BackendInvitationSummary;
    email_queued: boolean;
  }>(`/people/invitations/${invitationId}/resend`, { method: "POST" });
  return { invitation: mapInvitation(row.invitation), emailQueued: row.email_queued };
}
