export type TimelineIntervalType =
  | "worked"
  | "idle"
  | "locked"
  | "sleeping"
  | "untracked"
  | "break"
  | "manual";

export type TimelineWorkCategory = "extra" | "break_work" | null | undefined;

export type TimelineDisplayType =
  | TimelineIntervalType
  | "break_work"
  | "extra"
  | "leave";

export const TIMELINE_LABELS: Record<TimelineDisplayType, string> = {
  worked: "Worked",
  idle: "Idle",
  locked: "Locked",
  sleeping: "Sleeping",
  untracked: "Untracked",
  break: "Break",
  manual: "Manual approved",
  break_work: "Worked during break",
  extra: "Overtime",
  leave: "Leave",
};

export function timelineIntervalsForDisplay<T>(intervals: readonly T[]): T[] {
  // The employee must be able to audit the day from its first recorded interval.
  // The container scrolls, so silently dropping older intervals is never needed.
  return [...intervals];
}

export function timelineDisplayType(
  intervalType: TimelineIntervalType,
  approvedLeave: boolean,
  workCategory?: TimelineWorkCategory,
): TimelineDisplayType {
  if (approvedLeave) {
    return intervalType === "worked" ? "extra" : "leave";
  }
  if (intervalType === "worked" && workCategory === "break_work") {
    return "break_work";
  }
  if (intervalType === "worked" && workCategory === "extra") {
    return "extra";
  }
  return intervalType;
}

export function timelineIntervalPresentation(
  interval: {
    type: TimelineIntervalType;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number;
    is_current: boolean;
  },
  locallyEndedIdleAt: string | null,
) {
  if (
    interval.type !== "idle" ||
    !interval.is_current ||
    !locallyEndedIdleAt
  ) {
    return {
      isCurrent: interval.is_current,
      endedAt: interval.ended_at,
      durationSeconds: interval.duration_seconds,
    };
  }

  const startedAtMs = Date.parse(interval.started_at);
  const endedAtMs = Date.parse(locallyEndedIdleAt);
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(endedAtMs) ||
    endedAtMs < startedAtMs
  ) {
    return {
      isCurrent: interval.is_current,
      endedAt: interval.ended_at,
      durationSeconds: interval.duration_seconds,
    };
  }

  return {
    isCurrent: false,
    endedAt: locallyEndedIdleAt,
    durationSeconds: Math.floor((endedAtMs - startedAtMs) / 1000),
  };
}
