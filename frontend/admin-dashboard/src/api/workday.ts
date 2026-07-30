import type { WorkdayTimeline } from "@/types";

export type BackendWorkdayTimeline = {
  date: string;
  timezone: string;
  first_started_at?: string | null;
  last_ended_at?: string | null;
  last_activity_at?: string | null;
  is_running: boolean;
  continued_from_previous_day?: boolean;
  continued_session_started_at?: string | null;
  worked_seconds: number;
  idle_seconds: number;
  locked_seconds: number;
  sleeping_seconds: number;
  break_seconds?: number;
  manual_seconds?: number;
  approved_leave?: boolean;
  leave_seconds?: number;
  intervals: Array<{
    type: "worked" | "idle" | "locked" | "sleeping" | "break" | "manual";
    started_at: string;
    ended_at?: string | null;
    duration_seconds: number;
    session_id: string | null;
    project_id?: string | null;
    task_id?: string | null;
    project_name?: string | null;
    task_name?: string | null;
    is_current: boolean;
    work_category?: "extra" | "break_work" | null;
  }>;
};

export function mapWorkdayTimeline(row: BackendWorkdayTimeline): WorkdayTimeline {
  return {
    date: row.date,
    timezone: row.timezone,
    firstStartedAt: row.first_started_at ?? undefined,
    lastEndedAt: row.last_ended_at ?? undefined,
    lastActivityAt: row.last_activity_at ?? undefined,
    isRunning: row.is_running,
    continuedFromPreviousDay: row.continued_from_previous_day ?? false,
    continuedSessionStartedAt: row.continued_session_started_at ?? undefined,
    workedSeconds: row.worked_seconds,
    idleSeconds: row.idle_seconds,
    lockedSeconds: row.locked_seconds,
    sleepingSeconds: row.sleeping_seconds,
    breakSeconds: row.break_seconds ?? 0,
    manualSeconds: row.manual_seconds ?? 0,
    approvedLeave: row.approved_leave ?? false,
    leaveSeconds: row.leave_seconds ?? 0,
    intervals: row.intervals.map((interval) => ({
      type: interval.type,
      startedAt: interval.started_at,
      endedAt: interval.ended_at ?? undefined,
      durationSeconds: interval.duration_seconds,
      sessionId: interval.session_id ?? undefined,
      projectId: interval.project_id ?? undefined,
      taskId: interval.task_id ?? undefined,
      projectName: interval.project_name ?? undefined,
      taskName: interval.task_name ?? undefined,
      isCurrent: interval.is_current,
      workCategory: interval.work_category ?? null,
    })),
  };
}
