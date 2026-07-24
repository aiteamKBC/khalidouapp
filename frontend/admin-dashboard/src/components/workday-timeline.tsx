import { Activity, CalendarDays, Coffee, LockKeyhole, Moon } from "lucide-react";

import type { WorkdayIntervalType, WorkdayTimeline as WorkdayTimelineData } from "@/types";

type DisplayIntervalType = WorkdayIntervalType | "extra" | "leave";

const intervalStyles: Record<
  DisplayIntervalType,
  { label: string; bar: string; badge: string; icon: typeof Activity }
> = {
  worked: {
    label: "Worked",
    bar: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700",
    icon: Activity,
  },
  extra: {
    label: "Overtime",
    bar: "bg-orange-500",
    badge: "bg-orange-500/15 text-orange-800",
    icon: Activity,
  },
  idle: {
    label: "Idle",
    bar: "bg-amber-400",
    badge: "bg-amber-400/15 text-amber-800",
    icon: Coffee,
  },
  locked: {
    label: "Locked",
    bar: "bg-slate-400",
    badge: "bg-slate-500/10 text-slate-700",
    icon: LockKeyhole,
  },
  sleeping: {
    label: "Sleeping",
    bar: "bg-indigo-400",
    badge: "bg-indigo-500/10 text-indigo-700",
    icon: Moon,
  },
  leave: {
    label: "Leave",
    bar: "bg-sky-400",
    badge: "bg-sky-500/10 text-sky-700",
    icon: CalendarDays,
  },
};

function formatClock(value: string | undefined, timezone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function WorkdayTimeline({ timeline }: { timeline?: WorkdayTimelineData }) {
  if (!timeline || timeline.intervals.length === 0) {
    if (timeline?.approvedLeave) {
      return (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-800">
          Approved leave · no tracked activity for this day.
        </div>
      );
    }
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No tracked activity for this day.
      </p>
    );
  }

  const visibleSeconds = Math.max(
    1,
    timeline.intervals.reduce((total, interval) => total + interval.durationSeconds, 0),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        <Metric
          label="First start"
          value={formatClock(timeline.firstStartedAt, timeline.timezone)}
        />
        <Metric
          label="Last activity"
          value={formatClock(timeline.lastActivityAt, timeline.timezone)}
        />
        <Metric
          label="End"
          value={
            timeline.isRunning
              ? "In progress"
              : formatClock(timeline.lastEndedAt, timeline.timezone)
          }
        />
        <Metric label="Worked" value={formatDuration(timeline.workedSeconds)} />
        <Metric
          label={timeline.approvedLeave ? "Leave" : "Idle"}
          value={formatDuration(
            timeline.approvedLeave ? timeline.leaveSeconds : timeline.idleSeconds,
          )}
        />
      </div>

      <div
        className="flex h-3 overflow-hidden rounded-sm bg-muted"
        aria-label="Workday activity bar"
      >
        {timeline.intervals.map((interval, index) => {
          const displayType: DisplayIntervalType = timeline.approvedLeave
            ? interval.type === "worked"
              ? "extra"
              : "leave"
            : interval.type;
          return (
            <span
              key={`${interval.sessionId}-${interval.startedAt}-${index}`}
              className={intervalStyles[displayType].bar}
              style={{ width: `${(interval.durationSeconds / visibleSeconds) * 100}%` }}
              title={`${intervalStyles[displayType].label}: ${formatDuration(interval.durationSeconds)}`}
            />
          );
        })}
      </div>

      <div className="divide-y rounded-md border">
        {timeline.intervals.map((interval, index) => {
          const displayType: DisplayIntervalType = timeline.approvedLeave
            ? interval.type === "worked"
              ? "extra"
              : "leave"
            : interval.type;
          const style = intervalStyles[displayType];
          const Icon = style.icon;
          return (
            <div
              key={`${interval.sessionId}-${interval.startedAt}-${index}`}
              className="grid min-h-14 items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[150px_110px_1fr_70px]"
            >
              <span className="font-mono text-xs">
                {formatClock(interval.startedAt, timeline.timezone)} -{" "}
                {interval.endedAt ? formatClock(interval.endedAt, timeline.timezone) : "Now"}
              </span>
              <span
                className={`inline-flex w-fit items-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${style.badge}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {style.label}
              </span>
              <span className="min-w-0 truncate text-muted-foreground">
                {displayType === "worked" || displayType === "extra"
                  ? (interval.taskName ?? interval.projectName ?? "-")
                  : "-"}
              </span>
              <strong className="text-right text-xs">
                {formatDuration(interval.durationSeconds)}
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
