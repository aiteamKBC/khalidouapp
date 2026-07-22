import axiosLibrary from "axios";
import FormData from "form-data";
import { randomUUID } from "node:crypto";
import os from "node:os";

import {
  getDeviceToken,
  loadIdentity,
  saveEnrollmentIdentity,
} from "./identityStore.js";

// Never let an offline API call freeze quit, sync, or update flows forever.
const axios = axiosLibrary.create({ timeout: 15_000 });

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
  normal_seconds?: number;
  extra_seconds?: number;
  paid_pause_seconds?: number;
  created_at: string;
  updated_at: string;
};

export type PauseState = {
  remaining_seconds: number;
  active_pause: {
    id: string;
    scheduled_end_at: string;
    requested_seconds: number;
    remaining_seconds: number;
    status: string;
  } | null;
};

export type WorkdayState = {
  required_normal_seconds: number;
  normal_seconds: number;
  normal_remaining_seconds: number;
  extra_seconds: number;
  overtime_enabled: boolean;
  extra_time_status: "none" | "pending_overtime" | "recorded_not_counted";
};

export type SessionPayload = {
  session: WorkSession;
  workday?: WorkdayState | null;
  pause?: PauseState | null;
};

export type AgentTask = {
  id: string;
  name: string;
  description?: string | null;
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
  review_note?: string | null;
  completion_note?: string | null;
  checklist: Array<{
    id: string;
    title: string;
    completed: boolean;
    position: number;
    assignee_employee_id: string | null;
  }>;
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
  request_policy?: RequestPolicy;
};

export type RequestPolicy = {
  timezone: string;
  shift_start: string | null;
  shift_end: string | null;
  working_days: number[];
  break_rules?: Array<{
    name: string;
    minutes: number;
    paid: boolean;
    start_time?: string | null;
    end_time?: string | null;
  }>;
  approved_leave_today?: boolean;
  approved_early_leave_from?: string | null;
  weekly_early_leave_minutes: number;
  weekly_early_leave_used_minutes: number;
  weekly_early_leave_remaining_minutes: number;
};

export type TimeAdjustmentRequest = {
  id: string;
  request_type: "idle_time" | "early_leave" | "manual_time";
  requested_date: string;
  source_start_at: string | null;
  source_end_at: string | null;
  work_session_id: string | null;
  requested_minutes: number;
  approved_minutes: number | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  admin_note: string | null;
  created_at: string;
};

export type LeaveRequest = {
  id: string;
  start_date: string;
  end_date: string;
  requested_days: number;
  leave_type: "annual" | "sick" | "unpaid";
  reason?: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  created_at?: string;
};

export type LeaveBalance = {
  year: number;
  credit_days: number;
  used_days: number;
  pending_days: number;
  remaining_days: number;
};

export type LeaveRequestsPayload = {
  balance: LeaveBalance;
  requests: LeaveRequest[];
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

export type AgentWorkdayTimeline = {
  date: string;
  timezone: string;
  first_started_at: string | null;
  last_ended_at: string | null;
  last_activity_at: string | null;
  is_running: boolean;
  worked_seconds: number;
  idle_seconds: number;
  locked_seconds: number;
  sleeping_seconds: number;
  intervals: Array<{
    type: "worked" | "idle" | "locked" | "sleeping";
    started_at: string;
    ended_at: string | null;
    duration_seconds: number;
    session_id: string;
    project_name: string | null;
    task_name: string | null;
    is_current: boolean;
  }>;
};

export type AgentSummary = {
  employee: { id: string; name: string; avatar_url: string | null };
  daily_target_seconds: number;
  daily_target_progress_percent: number;
  activity_percent: number;
  today: AgentPeriodSummary;
  today_timeline: AgentWorkdayTimeline;
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

/**
 * Authenticates the employee, immediately exchanges that short-lived portal
 * session for a device token, and persists only the encrypted device token.
 * The password and employee access token never leave the Electron main process
 * after this function returns.
 *
 * POST /agent/enroll-authenticated validates the employee bearer token and
 * returns a device-scoped token for subsequent tracking requests.
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
  const response = await axios.get<
    ApiSuccess<{
      session: WorkSession | null;
      workday?: WorkdayState | null;
      pause?: PauseState | null;
    }>
  >(`${getApiBaseUrl()}/agent/sessions/current`, { headers: getAuthHeaders() });
  return response.data.data;
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

export async function listAgentRecentTasks(limit = 3) {
  const response = await axios.get<ApiSuccess<AgentTask[]>>(
    `${getApiBaseUrl()}/agent/tasks/recent`,
    {
      headers: getAuthHeaders(),
      params: { limit: Math.max(1, Math.min(8, limit)) },
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

export async function createAgentTaskChecklistItem(
  taskId: string,
  title: string,
) {
  const response = await axios.post<ApiSuccess<AgentTask>>(
    `${getApiBaseUrl()}/agent/tasks/${taskId}/checklist`,
    { title },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function updateAgentTaskChecklistItem(
  taskId: string,
  itemId: string,
  completed: boolean,
) {
  const response = await axios.patch<ApiSuccess<AgentTask>>(
    `${getApiBaseUrl()}/agent/tasks/${taskId}/checklist/${itemId}`,
    { completed },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function startSession() {
  const response = await axios.post<
    ApiSuccess<SessionPayload & { created: boolean }>
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
  const response = await axios.post<ApiSuccess<SessionPayload>>(
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

export async function startPaidPause(options: {
  sessionId: string;
  requestedMinutes: number;
  reason?: string;
  idempotencyKey?: string;
}) {
  const response = await axios.post<
    ApiSuccess<SessionPayload & { pause: PauseState }>
  >(
    `${getApiBaseUrl()}/agent/sessions/${options.sessionId}/pause`,
    {
      requested_minutes: options.requestedMinutes,
      reason: options.reason ?? null,
      idempotency_key: options.idempotencyKey ?? randomUUID(),
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function updateSessionTask(
  sessionId: string,
  taskId: string | null,
) {
  const response = await axios.post<ApiSuccess<SessionPayload>>(
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
    ApiSuccess<SessionPayload & { duplicate: boolean }>
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
    ApiSuccess<SessionPayload & { duplicate: boolean }>
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
  sessionId?: string | null;
  capturedAt: string;
  width: number;
  height: number;
  fileSize: number;
  mimeType: "image/jpeg" | "image/webp";
  checksum: string;
  displayId?: string;
  displayName?: string;
  displayCount?: number;
  powerSource?: "ac" | "battery" | "unknown";
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
      power_source: metadata.powerSource ?? "unknown",
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function reportScreenshotSkip(options: {
  eventId: string;
  sessionId?: string | null;
  occurredAt: string;
  reason: string;
  powerSource: "ac" | "battery" | "unknown";
  trackingStatus?: string | null;
}) {
  const response = await axios.post<ApiSuccess<Record<string, unknown>>>(
    `${getApiBaseUrl()}/agent/screenshots/skips`,
    {
      event_id: options.eventId,
      session_id: options.sessionId,
      occurred_at: options.occurredAt,
      reason: options.reason,
      power_source: options.powerSource,
      tracking_status: options.trackingStatus,
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
  requestType?: "idle_time" | "early_leave" | "manual_time";
  requestedDate?: string;
  workSessionId?: string;
  sourceStartAt?: string;
  sourceEndAt?: string;
  requestedLeaveTime?: string;
}) {
  const response = await axios.post<ApiSuccess<TimeAdjustmentRequest>>(
    `${getApiBaseUrl()}/agent/time-adjustment-requests`,
    {
      requested_minutes: options.requestedMinutes,
      reason: options.reason,
      request_type: options.requestType,
      requested_date: options.requestedDate,
      work_session_id: options.workSessionId,
      source_start_at: options.sourceStartAt,
      source_end_at: options.sourceEndAt,
      requested_leave_time: options.requestedLeaveTime,
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function listLeaveRequests() {
  const response = await axios.get<ApiSuccess<LeaveRequestsPayload>>(
    `${getApiBaseUrl()}/agent/leave-requests`,
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}

export async function createLeaveRequest(options: {
  startDate: string;
  endDate: string;
  leaveType: "annual" | "sick" | "unpaid";
  reason?: string;
}) {
  const response = await axios.post<ApiSuccess<LeaveRequest>>(
    `${getApiBaseUrl()}/agent/leave-requests`,
    {
      start_date: options.startDate,
      end_date: options.endDate,
      leave_type: options.leaveType,
      reason: options.reason,
    },
    { headers: getAuthHeaders() },
  );
  return response.data.data;
}
