import type { WorkdayTimeline } from "@/types";

export type BackendWorkdayTimeline = {
  date: string;
  timezone: string;
  first_started_at?: string | null;
  last_ended_at?: string | null;
  is_running: boolean;
  worked_seconds: number;
  idle_seconds: number;
  locked_seconds: number;
  sleeping_seconds: number;
  intervals: Array<{
    type: "worked" | "idle" | "locked" | "sleeping";
    started_at: string;
    ended_at?: string | null;
    duration_seconds: number;
    session_id: string;
    project_name?: string | null;
    task_name?: string | null;
    is_current: boolean;
  }>;
};

export function mapWorkdayTimeline(row: BackendWorkdayTimeline): WorkdayTimeline {
  return {
    date: row.date,
    timezone: row.timezone,
    firstStartedAt: row.first_started_at ?? undefined,
    lastEndedAt: row.last_ended_at ?? undefined,
    isRunning: row.is_running,
    workedSeconds: row.worked_seconds,
    idleSeconds: row.idle_seconds,
    lockedSeconds: row.locked_seconds,
    sleepingSeconds: row.sleeping_seconds,
    intervals: row.intervals.map((interval) => ({
      type: interval.type,
      startedAt: interval.started_at,
      endedAt: interval.ended_at ?? undefined,
      durationSeconds: interval.duration_seconds,
      sessionId: interval.session_id,
      projectName: interval.project_name ?? undefined,
      taskName: interval.task_name ?? undefined,
      isCurrent: interval.is_current,
    })),
  };
}
