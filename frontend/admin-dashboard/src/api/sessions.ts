import { apiFetch, apiFetchWithMeta, toMinutes, withQuery } from "./client";
import type { ActivityEvent, WorkSession } from "@/types";
import { mapWorkdayTimeline, type BackendWorkdayTimeline } from "./workday";

type BackendSession = {
  id: string;
  employee_id: string;
  device_id: string;
  team_id?: string | null;
  project_id?: string | null;
  task_id?: string | null;
  started_at: string;
  ended_at?: string | null;
  active_seconds: number;
  idle_seconds: number;
  screenshot_count?: number;
};

type BackendActivityEvent = {
  id: string;
  employee_id: string;
  event_type: string;
  event_timestamp: string;
  payload?: Record<string, unknown>;
};

type BackendApplicationHistory = {
  employee_id: string;
  date: string;
  timezone: string;
  total_seconds: number;
  application_count: number;
  website_count: number;
  applications: Array<{ name: string; duration_seconds: number }>;
  websites: Array<{ domain: string; duration_seconds: number }>;
  items: Array<{
    id: string;
    application_name: string;
    process_name?: string | null;
    site_domain?: string | null;
    started_at: string;
    ended_at: string;
    duration_seconds: number;
  }>;
};

export type ApplicationHistory = {
  employeeId: string;
  date: string;
  timezone: string;
  totalSeconds: number;
  applicationCount: number;
  websiteCount: number;
  page: number;
  pages: number;
  total: number;
  applications: Array<{ name: string; durationSeconds: number }>;
  websites: Array<{ domain: string; durationSeconds: number }>;
  items: Array<{
    id: string;
    applicationName: string;
    processName?: string;
    siteDomain?: string;
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
  }>;
};

function mapSession(session: BackendSession): WorkSession {
  return {
    id: session.id,
    employeeId: session.employee_id,
    deviceId: session.device_id,
    teamId: session.team_id ?? undefined,
    projectId: session.project_id ?? undefined,
    taskId: session.task_id ?? undefined,
    startedAt: session.started_at,
    endedAt: session.ended_at ?? undefined,
    activeMinutes: toMinutes(session.active_seconds),
    idleMinutes: toMinutes(session.idle_seconds),
    screenshotCount: session.screenshot_count ?? 0,
  };
}

function mapActivity(event: BackendActivityEvent): ActivityEvent {
  return {
    id: event.id,
    employeeId: event.employee_id,
    type: event.event_type,
    at: event.event_timestamp,
    meta: Object.fromEntries(
      Object.entries(event.payload ?? {}).map(([key, value]) => [key, String(value)]),
    ),
  };
}

export async function listSessions(employeeId?: string, teamId?: string): Promise<WorkSession[]> {
  const sessions = await apiFetch<BackendSession[]>(
    withQuery("/sessions", { employee_id: employeeId, team_id: teamId, page_size: 100 }),
  );
  return sessions.map(mapSession);
}

export async function listActivity(employeeId?: string, teamId?: string): Promise<ActivityEvent[]> {
  const events = await apiFetch<BackendActivityEvent[]>(
    withQuery("/activity", { employee_id: employeeId, team_id: teamId, page_size: 100 }),
  );
  return events.map(mapActivity);
}

export async function getWorkdayTimeline(employeeId: string, day: string) {
  const timeline = await apiFetch<BackendWorkdayTimeline>(
    withQuery("/activity/timeline", { employee_id: employeeId, day }),
  );
  return mapWorkdayTimeline(timeline);
}

export async function getApplicationHistory(
  employeeId: string,
  day: string,
  page = 1,
  signal?: AbortSignal,
): Promise<ApplicationHistory> {
  const result = await apiFetchWithMeta<BackendApplicationHistory>(
    withQuery("/activity/application-history", {
      employee_id: employeeId,
      day,
      page,
      page_size: 25,
    }),
    { signal },
  );
  const history = result.data;
  return {
    employeeId: history.employee_id,
    date: history.date,
    timezone: history.timezone,
    totalSeconds: history.total_seconds,
    applicationCount: history.application_count,
    websiteCount: history.website_count,
    page: Number(result.meta.page ?? page),
    pages: Number(result.meta.total_pages ?? 1),
    total: Number(result.meta.total ?? history.items.length),
    applications: history.applications.map((item) => ({
      name: item.name,
      durationSeconds: item.duration_seconds,
    })),
    websites: history.websites.map((item) => ({
      domain: item.domain,
      durationSeconds: item.duration_seconds,
    })),
    items: history.items.map((item) => ({
      id: item.id,
      applicationName: item.application_name,
      processName: item.process_name ?? undefined,
      siteDomain: item.site_domain ?? undefined,
      startedAt: item.started_at,
      endedAt: item.ended_at,
      durationSeconds: item.duration_seconds,
    })),
  };
}
