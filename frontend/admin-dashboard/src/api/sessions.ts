import { apiFetch, toMinutes, withQuery } from "./client";
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
