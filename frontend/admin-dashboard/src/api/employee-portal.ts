import { apiFetch, apiUrl } from "./client";

const STORAGE_KEY = "khaliduo.employee.auth";

export type PortalEmployee = {
  id: string;
  name: string;
  email: string;
  employee_code: string;
  department?: string | null;
  avatar_url?: string | null;
};

export type PortalPeriod = {
  active_seconds: number;
  tracked_active_seconds: number;
  idle_seconds: number;
  tracked_seconds: number;
  adjustment_seconds: number;
  manual_approved_seconds: number;
  manual_pending_seconds: number;
  manual_rejected_seconds: number;
  deducted_seconds: number;
  screenshot_count: number;
  points: number;
};

export type PortalSummary = {
  today: PortalPeriod;
  week: PortalPeriod;
  month: PortalPeriod;
  days: Array<PortalPeriod & { date: string }>;
  points_rule: string;
};

export type PortalTask = {
  id: string;
  name: string;
  project_name: string;
  team_name: string;
  stage: string;
  description?: string;
  project_id: string;
  start_date?: string | null;
  deadline?: string | null;
  estimated_minutes?: number | null;
  checklist?: Array<{ id: string; title: string; completed: boolean; position: number }>;
  priority: "low" | "medium" | "high" | "urgent";
  can_update_stage: boolean;
  blocked_reason?: string | null;
  review_note?: string | null;
};

export type PortalProject = { id: string; name: string; team_id: string };

export type PortalScreenshot = {
  id: string;
  captured_at: string;
  imageUrl: string;
  tracked_seconds: number;
};

export type PortalTimeRequest = {
  id: string;
  requested_date: string;
  requested_minutes: number;
  approved_minutes?: number | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  admin_note?: string | null;
  created_at: string;
};

export function readEmployeeToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function saveEmployeeToken(token: string) {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearEmployeeToken() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function employeeLogin(
  email: string,
  credential: { password: string } | { accessKey: string },
) {
  return apiFetch<{ access_token: string; employee: PortalEmployee }>("/employee-auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      ...("password" in credential
        ? { password: credential.password }
        : { access_key: credential.accessKey }),
    }),
  });
}

export async function exchangeEmployeeHandoff(handoffToken: string) {
  return apiFetch<{ access_token: string; employee: PortalEmployee }>(
    "/employee-auth/device-handoff",
    {
      method: "POST",
      body: JSON.stringify({ handoff_token: handoffToken }),
    },
  );
}

export const employeeMe = (token: string) =>
  apiFetch<PortalEmployee>("/employee-auth/me", {}, token);

export const updateEmployeeProfile = (
  token: string,
  input: { name?: string; avatarUrl?: string | null },
) =>
  apiFetch<PortalEmployee>(
    "/employee-auth/me",
    {
      method: "PATCH",
      body: JSON.stringify({ name: input.name, avatar_url: input.avatarUrl }),
    },
    token,
  );

export const forgotEmployeeAccessKey = (email: string) =>
  apiFetch("/employee-auth/forgot-access-key", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export const employeeSummary = (token: string) =>
  apiFetch<PortalSummary>("/employee-portal/summary", {}, token);

export const employeeTasks = (token: string) =>
  apiFetch<PortalTask[]>("/employee-portal/tasks", {}, token);

export const employeeProjects = (token: string) =>
  apiFetch<PortalProject[]>("/employee-portal/projects", {}, token);

export const createEmployeeTask = (
  token: string,
  input: {
    projectId: string;
    name: string;
    description?: string;
    stage?: "assigned";
    startDate?: string;
    deadline?: string;
    estimatedMinutes?: number;
    priority?: "low" | "medium" | "high" | "urgent";
  },
) =>
  apiFetch<PortalTask>(
    "/employee-portal/tasks",
    {
      method: "POST",
      body: JSON.stringify({
        project_id: input.projectId,
        name: input.name,
        description: input.description,
        stage: "assigned",
        start_date: input.startDate,
        deadline: input.deadline,
        estimated_minutes: input.estimatedMinutes,
        priority: input.priority ?? "medium",
      }),
    },
    token,
  );

export const updateEmployeeTask = (
  token: string,
  taskId: string,
  input: Partial<{
    name: string;
    description: string;
    stage: string;
    startDate: string;
    deadline: string;
    estimatedMinutes: number;
    note: string;
  }>,
) =>
  apiFetch<PortalTask>(
    `/employee-portal/tasks/${taskId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        stage: input.stage,
        start_date: input.startDate,
        deadline: input.deadline,
        estimated_minutes: input.estimatedMinutes,
        note: input.note,
      }),
    },
    token,
  );

export type PortalNotification = {
  id: string;
  task_id?: string | null;
  type: string;
  title: string;
  message: string;
  read_at?: string | null;
  created_at: string;
};

export const employeeNotifications = (token: string) =>
  apiFetch<PortalNotification[]>("/employee-portal/notifications", {}, token);

export const readEmployeeNotification = (token: string, id: string) =>
  apiFetch(`/employee-portal/notifications/${id}/read`, { method: "PATCH" }, token);

export const createEmployeeChecklistItem = (token: string, taskId: string, title: string) =>
  apiFetch<PortalTask>(
    `/employee-portal/tasks/${taskId}/checklist`,
    {
      method: "POST",
      body: JSON.stringify({ title }),
    },
    token,
  );

export const updateEmployeeChecklistItem = (
  token: string,
  taskId: string,
  itemId: string,
  input: { title?: string; completed?: boolean; position?: number },
) =>
  apiFetch<PortalTask>(
    `/employee-portal/tasks/${taskId}/checklist/${itemId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    token,
  );

export type PortalTaskWorkspace = {
  comments: Array<{ id: string; body: string; author_name: string; created_at: string }>;
  attachments: Array<{ id: string; file_name: string; size_bytes: number; created_at: string }>;
};

export const employeeTaskWorkspace = (token: string, taskId: string) =>
  apiFetch<PortalTaskWorkspace>(`/employee-portal/tasks/${taskId}/workspace`, {}, token);

export const createEmployeeTaskComment = (token: string, taskId: string, body: string) =>
  apiFetch(
    `/employee-portal/tasks/${taskId}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
    token,
  );

export const uploadEmployeeTaskAttachment = (token: string, taskId: string, file: File) => {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(`/employee-portal/tasks/${taskId}/attachments`, { method: "POST", body }, token);
};

export const employeeTimeRequests = (token: string) =>
  apiFetch<PortalTimeRequest[]>("/employee-portal/time-adjustment-requests", {}, token);

export const createEmployeeTimeRequest = (
  token: string,
  input: { requestedDate: string; requestedMinutes: number; reason: string },
) =>
  apiFetch<PortalTimeRequest>(
    "/employee-portal/time-adjustment-requests",
    {
      method: "POST",
      body: JSON.stringify({
        requested_date: input.requestedDate,
        requested_minutes: input.requestedMinutes,
        reason: input.reason,
      }),
    },
    token,
  );

export async function employeeScreenshots(token: string): Promise<PortalScreenshot[]> {
  const rows = await apiFetch<
    Array<{ id: string; captured_at: string; temporary_url: string; tracked_seconds: number }>
  >("/employee-portal/screenshots", {}, token);
  return Promise.all(
    rows.map(async (row) => {
      const response = await fetch(apiUrl(row.temporary_url), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("A screenshot could not be loaded.");
      return {
        id: row.id,
        captured_at: row.captured_at,
        tracked_seconds: row.tracked_seconds,
        imageUrl: URL.createObjectURL(await response.blob()),
      };
    }),
  );
}
