export type TimelineIntervalType =
  | "worked"
  | "idle"
  | "locked"
  | "sleeping"
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
  break: "Break",
  manual: "Manual approved",
  break_work: "Worked during break",
  extra: "Overtime",
  leave: "Leave",
};

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
