import axios from "axios";
import FormData from "form-data";
import { randomUUID } from "node:crypto";
import os from "node:os";

import {
  getDeviceToken,
  loadIdentity,
  saveEnrollmentIdentity,
} from "./identityStore.js";

type ApiSuccess<T> = {
  success: true;
  data: T;
  meta: Record<string, unknown>;
};

type EnrollmentResponse = {
  company_id: string;
  employee: {
    id: string;
    name: string;
    email: string;
    timezone: string;
  };
  device: {
    id: string;
    name: string;
    installation_id: string;
    status: string;
  };
  device_token: string;
  token_type: "bearer";
  settings: Record<string, unknown>;
};

type EmployeeLoginResponse = {
  access_token: string;
  token_type: "bearer";
  expires_in_seconds: number;
};

export type WorkSession = {
  id: string;
  company_id: string;
  employee_id: string;
  device_id: string;
  team_id: string | null;
  project_id: string | null;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  status: "active" | "idle" | "locked" | "sleeping" | "offline" | "ended";
  active_seconds: number;
  idle_seconds: number;
  created_at: string;
  updated_at: string;
};

export type AgentTask = {
  id: string;
  name: string;
  stage:
    | "new_requests"
    | "backlog"
    | "assigned"
    | "in_progress"
    | "ready_for_review"
    | "completed"
    | "blocked"
    | "rejected"
    | "cancelled";
  can_update_stage: boolean;
  project_id: string;
  project_name: string;
  team_id: string;
  team_name: string;
  active_seconds: number;
  idle_seconds: number;
  tracked_seconds: number;
};

export type AgentRecentScreenshot = {
  id: string;
  captured_at: string;
  mime_type: string;
  display_name: string | null;
};

export type TrackingConfig = {
  screenshot_enabled: boolean;
  screenshot_interval_minutes: number;
  screenshots_per_interval: number;
  idle_threshold_minutes: number;
  capture_during_idle: boolean;
  offline_threshold_minutes: number;
  screenshot_retention_days: number;
};

export type TimeAdjustmentRequest = {
  id: string;
  requested_date: string;
  requested_minutes: number;
  approved_minutes: number | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  admin_note: string | null;
  created_at: string;
};

export type AgentPeriodSummary = {
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

export type AgentSummary = {
  employee: { id: string; name: string; avatar_url: string | null };
  today: AgentPeriodSummary;
  week: AgentPeriodSummary;
  month: AgentPeriodSummary;
};

export function getApiBaseUrl() {
  return process.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";
}

function getDeviceInfo(agentVersion: string) {
  const identity = loadIdentity();
  return {
    installation_id: identity.installationId,
    device_name: os.hostname(),
    operating_system: `Windows ${os.release()}`,
    agent_version: agentVersion,
    windows_username: os.userInfo().username,
  };
}

function getAuthHeaders() {
  const token = getDeviceToken();
  if (!token) {
    throw new Error("Device is not enrolled.");
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function enrollDevice(
  enrollmentCode: string,
  agentVersion: string,
) {
  const response = await axios.post<ApiSuccess<EnrollmentResponse>>(
    `${getApiBaseUrl()}/agent/enroll`,
    {
      enrollment_code: enrollmentCode.trim(),
      device: getDeviceInfo(agentVersion),
    },
  );

  const data = response.data.data;
  return saveEnrollmentIdentity({
    companyId: data.company_id,
    employeeId: data.employee.id,
    employeeName: data.employee.name,
    deviceId: data.device.id,
    deviceName: data.device.name,
    deviceToken: data.device_token,
  });
}

/**
 * Authenticates the employee, immediately exchanges that short-lived portal
 * session for a device token, and persists only the encrypted device token.
 * The password and employee access token never leave the Electron main process
 * after this function returns.
 *
 * The backend still needs to implement POST /agent/enroll-authenticated. It
 * must authenticate the employee bearer token and return EnrollmentResponse.
 */
export async function enrollDeviceWithCredentials(
  email: string,
  password: string,
  agentVersion: string,
) {
  const loginResponse = await axios.post<ApiSuccess<EmployeeLoginResponse>>(
    `${getApiBaseUrl()}/employee-auth/login`,
    {
      email: email.trim(),
      password,
    },
  );

  const employeeAccessToken = loginResponse.data.data.access_token;
  const response = await axios.post<ApiSuccess<EnrollmentResponse>>(
    `${getApiBaseUrl()}/agent/enroll-authenticated`,
    { device: getDeviceInfo(agentVersion) },
    {
      headers: {
        Authorization: `Bearer ${employeeAccessToken}`,
      },
    },
  );

  const data = response.data.data;
  return saveEnrollmentIdentity({
    companyId: data.company_id,
    employeeId: data.employee.id,
    employeeName: data.employee.name,
    deviceId: data.device.id,
    deviceName: data.device.name,
    deviceToken: data.device_token,
  });
}

export async function getCurrentSession() {
  const response = await axios.get<ApiSuccess<{ session: WorkSession | null }>>(
    `${getApiBaseUrl()}/agent/sessions/current`,
    { headers: getAuthHeaders() },
  );
  return response.data.data.session;
}

export async function getAgentTodaySummary() {
  const response = await axios.get<ApiSuccess<{ active_seconds: number }>>(
    `${getApiBaseUrl()}/agent/time-summary/today`,
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function getAgentSummary() {
  const response = await axios.get<ApiSuccess<AgentSummary>>(
    `${getApiBaseUrl()}/agent/summary`,
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function getAgentConfig() {
  const response = await axios.get<ApiSuccess<TrackingConfig>>(
    `${getApiBaseUrl()}/agent/config`,
    {
      headers: getAuthHeaders(),
    },
  );
  return response.data.data;
}

export async function listAgentTasks() {
  const response = await axios.get<ApiSuccess<AgentTask[]>>(
    `${getApiBaseUrl()}/agent/tasks`,
    {
      headers: getAuthHeaders(),
    },
  );
  return response.data.data;
}

export async function listAgentRecentScreenshots(limit = 4) {
  const response = await axios.get<ApiSuccess<AgentRecentScreenshot[]>>(
    `${getApiBaseUrl()}/agent/screenshots/recent`,
    {
      headers: getAuthHeaders(),
      params: { limit: Math.max(1, Math.min(4, limit)) },
    },
  );
  return response.data.data;
}

export async function downloadAgentScreenshot(screenshotId: string) {
  const response = await axios.get<ArrayBuffer>(
    `${getApiBaseUrl()}/agent/screenshots/${screenshotId}/file`,
    {
      headers: getAuthHeaders(),
      responseType: "arraybuffer",
    },
  );
  return {
    content: Buffer.from(response.data),
    mimeType: response.headers["content-type"] ?? "image/jpeg",
  };
}

export type AgentProject = {
  id: string;
  name: string;
  team_id: string;
  team_name: string;
};

export async function listAgentProjects() {
  const response = await axios.get<ApiSuccess<AgentProject[]>>(
    `${getApiBaseUrl()}/agent/projects`,
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function createAgentTask(options: {
  name: string;
  projectId?: string;
  description?: string;
  stage?: "assigned";
  startDate?: string;
  deadline?: string;
  estimatedMinutes?: number;
  priority?: "low" | "medium" | "high" | "urgent";
}) {
  const response = await axios.post<ApiSuccess<AgentTask>>(
    `${getApiBaseUrl()}/agent/tasks`,
    {
      name: options.name,
      project_id: options.projectId ?? null,
      description: options.description ?? null,
      stage: "assigned",
      start_date: options.startDate || null,
      deadline: options.deadline || null,
      estimated_minutes: options.estimatedMinutes ?? null,
      priority: options.priority ?? "medium",
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function updateAgentTaskStage(
  taskId: string,
  stage: string,
  note?: string,
) {
  const response = await axios.patch<ApiSuccess<AgentTask>>(
    `${getApiBaseUrl()}/agent/tasks/${taskId}`,
    { stage, note: note ?? null },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function startSession() {
  const response = await axios.post<
    ApiSuccess<{ session: WorkSession; created: boolean }>
  >(
    `${getApiBaseUrl()}/agent/sessions/start`,
    { started_at: new Date().toISOString() },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function endSession(options: {
  sessionId: string;
  activeSeconds: number;
  idleSeconds: number;
  reason: string;
  endedAt?: string;
  eventId?: string;
}) {
  const response = await axios.post<ApiSuccess<{ session: WorkSession }>>(
    `${getApiBaseUrl()}/agent/sessions/${options.sessionId}/end`,
    {
      event_id: options.eventId ?? randomUUID(),
      ended_at: options.endedAt ?? new Date().toISOString(),
      active_seconds: options.activeSeconds,
      idle_seconds: options.idleSeconds,
      reason: options.reason,
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function updateSessionTask(
  sessionId: string,
  taskId: string | null,
) {
  const response = await axios.post<ApiSuccess<{ session: WorkSession }>>(
    `${getApiBaseUrl()}/agent/sessions/${sessionId}/task`,
    { task_id: taskId },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function sendHeartbeat(options: {
  sessionId: string;
  eventId: string;
  status: "active" | "idle" | "locked" | "offline" | "sleeping";
  idleSeconds: number;
  activeSeconds: number;
  agentVersion: string;
}) {
  const response = await axios.post<
    ApiSuccess<{ session: WorkSession; duplicate: boolean }>
  >(
    `${getApiBaseUrl()}/agent/sessions/${options.sessionId}/heartbeat`,
    {
      event_id: options.eventId,
      timestamp: new Date().toISOString(),
      status: options.status,
      idle_seconds: options.idleSeconds,
      active_seconds: options.activeSeconds,
      agent_version: options.agentVersion,
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function sendActivityEvent(options: {
  sessionId: string;
  eventId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  const response = await axios.post<
    ApiSuccess<{ duplicate: boolean; session: WorkSession }>
  >(
    `${getApiBaseUrl()}/agent/sessions/${options.sessionId}/events`,
    {
      event_id: options.eventId,
      event_type: options.eventType,
      event_timestamp: new Date().toISOString(),
      payload: options.payload ?? {},
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function sendQueuedRequest(
  method: string,
  endpoint: string,
  payload: Record<string, unknown>,
) {
  const response = await axios.request<ApiSuccess<Record<string, unknown>>>({
    method,
    url: `${getApiBaseUrl()}${endpoint}`,
    data: payload,
    headers: getAuthHeaders(),
  });
  return response.data.data;
}

export type ScreenshotMetadata = {
  screenshotId: string;
  sessionId: string;
  capturedAt: string;
  width: number;
  height: number;
  fileSize: number;
  mimeType: "image/jpeg" | "image/webp";
  checksum: string;
  displayId?: string;
  displayName?: string;
  displayCount?: number;
};

export async function initiateScreenshot(metadata: ScreenshotMetadata) {
  const response = await axios.post<
    ApiSuccess<{ upload_url: string; duplicate: boolean }>
  >(
    `${getApiBaseUrl()}/agent/screenshots/initiate`,
    {
      screenshot_id: metadata.screenshotId,
      session_id: metadata.sessionId,
      captured_at: metadata.capturedAt,
      width: metadata.width,
      height: metadata.height,
      file_size: metadata.fileSize,
      mime_type: metadata.mimeType,
      checksum: metadata.checksum,
      display_id: metadata.displayId,
      display_name: metadata.displayName,
      display_count: metadata.displayCount ?? 1,
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function uploadScreenshot(
  screenshotId: string,
  content: Buffer,
  mimeType: "image/jpeg" | "image/webp",
) {
  const form = new FormData();
  form.append("file", content, {
    filename: `${screenshotId}.jpg`,
    contentType: mimeType,
    knownLength: content.length,
  });

  const response = await axios.post<ApiSuccess<Record<string, unknown>>>(
    `${getApiBaseUrl()}/agent/screenshots/${screenshotId}/upload`,
    form,
    {
      headers: {
        ...getAuthHeaders(),
        ...form.getHeaders(),
      },
      maxBodyLength: Infinity,
    },
  );
  return response.data.data;
}

export async function completeScreenshot(options: {
  screenshotId: string;
  checksum: string;
  fileSize: number;
}) {
  const response = await axios.post<ApiSuccess<Record<string, unknown>>>(
    `${getApiBaseUrl()}/agent/screenshots/${options.screenshotId}/complete`,
    {
      checksum: options.checksum,
      file_size: options.fileSize,
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function listTimeAdjustmentRequests() {
  const response = await axios.get<ApiSuccess<TimeAdjustmentRequest[]>>(
    `${getApiBaseUrl()}/agent/time-adjustment-requests`,
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function createEmployeePortalHandoff() {
  const response = await axios.post<
    ApiSuccess<{ handoff_token: string; expires_in_seconds: number }>
  >(
    `${getApiBaseUrl()}/agent/employee-portal-handoff`,
    {},
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function createTimeAdjustmentRequest(options: {
  requestedMinutes: number;
  reason: string;
}) {
  const response = await axios.post<ApiSuccess<TimeAdjustmentRequest>>(
    `${getApiBaseUrl()}/agent/time-adjustment-requests`,
    {
      requested_minutes: options.requestedMinutes,
      reason: options.reason,
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}
