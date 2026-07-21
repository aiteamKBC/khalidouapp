import { apiFetch } from "./client";
import { normalizeAiAcronym } from "@/lib/text";

export type PersonInvitationInput = {
  name: string;
  email: string;
  kind: "employee" | "team_manager" | "general_admin" | "hr";
  teamIds: string[];
  jobTitle?: string;
  timezone?: string;
  trackAsEmployee?: boolean;
  startDate?: string;
  annualLeaveDays?: number;
  workProfile?: {
    shiftStart: string; shiftEnd: string; workingDays: number[]; weeklyOffDays: number[];
    requiredDailyMinutes: number; breakRules: Array<{ name: string; minutes: number; paid: boolean; start_time: string; end_time: string }>;
    lateGraceMinutes: number; overtimeEnabled: boolean; overtimeBasis: "outside_shift";
    overtimeRateMultiplier: number; salaryAmount: number; salaryCurrency: string; salaryType: "monthly" | "hourly";
  };
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
      job_title: input.jobTitle ? normalizeAiAcronym(input.jobTitle) : null,
      timezone: input.timezone || "Africa/Cairo",
      track_as_employee: input.trackAsEmployee ?? false,
      start_date: input.startDate,
      annual_leave_days: input.annualLeaveDays,
      work_profile: input.workProfile ? {
        shift_start: input.workProfile.shiftStart,
        shift_end: input.workProfile.shiftEnd,
        working_days: input.workProfile.workingDays,
        weekly_off_days: input.workProfile.weeklyOffDays,
        required_daily_minutes: input.workProfile.requiredDailyMinutes,
        break_rules: input.workProfile.breakRules,
        late_grace_minutes: input.workProfile.lateGraceMinutes,
        deduction_policy: { mode: "review", require_admin_review: true, brackets: [] },
        overtime_enabled: input.workProfile.overtimeEnabled,
        overtime_basis: input.workProfile.overtimeBasis,
        overtime_rate_multiplier: input.workProfile.overtimeRateMultiplier,
        salary_amount: input.workProfile.salaryAmount,
        salary_currency: input.workProfile.salaryCurrency,
        salary_type: input.workProfile.salaryType,
      } : undefined,
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

export type PersonRole = "employee" | "team_owner" | "hr" | "general_admin";

export type PersonRoleResult = PersonArchiveResult & {
  role: PersonRole;
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

export async function deletePerson(personType: "admin" | "employee", personId: string) {
  return apiFetch<{ deleted: boolean; person_type: "admin" | "employee" }>(
    `/people/${personType}/${personId}`,
    { method: "DELETE" },
  );
}

export async function updatePersonRole(
  personType: "admin" | "employee",
  personId: string,
  input: { role: PersonRole; teamIds?: string[]; password?: string },
): Promise<PersonRoleResult> {
  const row = await apiFetch<{
    person_type: "admin" | "employee";
    admin_user_id?: string | null;
    employee_id?: string | null;
    archived: boolean;
    admin_status?: string | null;
    employee_status?: string | null;
    role: PersonRole;
  }>(`/people/${personType}/${personId}/role`, {
    method: "PATCH",
    body: JSON.stringify({
      role: input.role,
      team_ids: input.teamIds ?? [],
      password: input.password || undefined,
    }),
  });
  return {
    personType: row.person_type,
    adminUserId: row.admin_user_id ?? undefined,
    employeeId: row.employee_id ?? undefined,
    archived: row.archived,
    adminStatus: row.admin_status ?? undefined,
    employeeStatus: row.employee_status ?? undefined,
    role: row.role,
  };
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
