import type {
  PortalEmployee,
  PortalPeriod,
  PortalSummary,
  PortalTask,
  PortalTaskWorkspace,
  PortalWorkProfile,
  PortalTimeRequest,
  PortalLeaveData,
} from "@/api/employee-portal";
import type {
  ActivityEntry,
  Attendance,
  Employee,
  RequestItem,
  Task,
  TimeSummary,
  SummaryKey,
} from "./model";

const statusByStage: Record<string, Task["status"]> = {
  new_requests: "Not started",
  assigned: "Not started",
  in_progress: "In progress",
  ready_for_review: "In review",
  blocked: "Blocked",
  completed: "Completed",
  rejected: "Blocked",
  cancelled: "Blocked",
};

export function mapTask(task: PortalTask, workspace?: PortalTaskWorkspace): Task {
  return {
    id: task.id,
    name: task.name,
    project: task.project_name,
    team: task.team_name,
    priority: ({ low: "Low", medium: "Medium", high: "High", urgent: "Urgent" } as const)[
      task.priority
    ],
    status: statusByStage[task.stage] ?? "Not started",
    approval:
      task.stage === "new_requests" || task.stage === "ready_for_review"
        ? "Pending"
        : task.stage === "rejected" || task.stage === "cancelled"
          ? "Rejected"
          : "Approved",
    workedSeconds: task.active_seconds,
    startDate: task.start_date ?? "",
    deadline: task.deadline ?? "",
    description: task.description ?? "",
    outcome: "",
    checklist: (task.checklist ?? []).map((item) => ({
      id: item.id,
      text: item.title,
      done: item.completed,
    })),
    comments: (workspace?.comments ?? []).map((item) => ({
      id: item.id,
      body: item.body,
      author: item.author_name,
      initials: item.author_name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2),
      at: new Date(item.created_at).toLocaleString(),
    })),
    attachments: (workspace?.attachments ?? []).map((item) => ({
      id: item.id,
      name: item.file_name,
      size: `${Math.max(1, Math.round(item.size_bytes / 1024))} KB`,
      kind: "file",
    })),
    approvalNote: task.review_note ?? task.blocked_reason ?? undefined,
    canUpdateStatus: task.can_update_stage,
    stage: task.stage,
  };
}

export function mapEmployee(employee: PortalEmployee): Employee {
  return {
    name: employee.name,
    firstName: employee.name.split(" ")[0],
    role: employee.job_title ?? "Employee",
    team: "Employee workspace",
    email: employee.email,
    avatar: employee.avatar_url ?? "",
    employeeId: employee.employee_code,
  };
}

function workingDays(start: Date, end: Date, profile?: PortalWorkProfile) {
  // Work profiles use Python's weekday convention: Monday=0, Sunday=6.
  if (!profile?.working_days?.length) return null;
  let days = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (profile.working_days.includes((cursor.getDay() + 6) % 7)) days++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function mapSummaries(
  summary: PortalSummary,
  profile?: PortalWorkProfile,
  now = new Date(),
): TimeSummary[] {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const format = (date: Date) =>
    date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const specs: Array<[SummaryKey, string, string, Date, Date]> = [
    ["today", "Today", format(now), now, now],
    ["week", "This week", `${format(monday)} – ${format(sunday)}`, monday, sunday],
    [
      "month",
      "This month",
      now.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      monthStart,
      monthEnd,
    ],
  ];
  return specs.map(([key, label, range, start, end]) => {
    const period: PortalPeriod = summary[key];
    const days = workingDays(start, end, profile);
    return {
      key,
      label,
      range,
      breakdown: {
        workedSeconds: period.tracked_active_seconds,
        idleSeconds: period.idle_seconds,
        manualApprovedSeconds: period.manual_approved_seconds,
        manualPendingSeconds: period.manual_pending_seconds,
        manualRejectedSeconds: period.manual_rejected_seconds,
        manualTotalSeconds:
          period.manual_approved_seconds +
          period.manual_pending_seconds +
          period.manual_rejected_seconds,
        points: period.points,
        screenshots: period.screenshot_count,
        sessions: null,
        targetSeconds:
          days !== null && profile?.required_daily_minutes
            ? days * profile.required_daily_minutes * 60
            : 0,
        sources: "Recorded desktop activity and reviewed manual time",
        updatedAt: now.toLocaleString(),
      },
    };
  });
}

export function mapAttendance(summary: PortalSummary, profile?: PortalWorkProfile): Attendance {
  const day = summary.daily_attendance;
  const running = day.is_running ?? summary.todayTimeline.isRunning;
  const first = day.actual_first_activity_at ?? summary.todayTimeline.firstStartedAt ?? null;
  return {
    shiftStart: profile?.shift_start?.slice(0, 5) ?? "—",
    shiftEnd: profile?.shift_end?.slice(0, 5) ?? "—",
    shiftLabel:
      profile?.shift_start && profile.shift_end
        ? `Scheduled shift · ${profile.shift_start.slice(0, 5)} – ${profile.shift_end.slice(0, 5)}`
        : "No shift configured",
    status: running ? "active" : first ? "ended" : "not-started",
    firstActivity: first,
    lastActivity: day.actual_last_activity_at ?? null,
    signOut: day.actual_sign_out_at ?? null,
    sessions: running && first ? [{ id: "current", start: first, end: null }] : [],
    payableSeconds: day.total_payable_seconds,
    lateMinutes: Math.round(day.deductible_late_seconds / 60),
    graceMinutes: profile?.late_grace_minutes ?? 0,
    overtimeSeconds: day.approved_overtime_seconds,
  };
}

export function mapActivity(summary: PortalSummary): ActivityEntry[] {
  const clock = (value: string) =>
    new Date(value).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: summary.todayTimeline.timezone,
    });
  return summary.todayTimeline.intervals.map((item, index) => ({
    id: `${item.startedAt}-${index}`,
    from: clock(item.startedAt),
    to: item.endedAt ? clock(item.endedAt) : "Now",
    task: item.taskName ?? item.projectName ?? item.type,
    seconds: item.durationSeconds,
    kind:
      item.type === "worked" || item.type === "manual"
        ? "Worked"
        : item.type === "idle"
          ? "Idle"
          : "Paused",
  }));
}

export function mapRequests(time: PortalTimeRequest[], leave?: PortalLeaveData): RequestItem[] {
  const requestStatus = (value: string) =>
    (
      ({
        pending: "Pending",
        approved: "Approved",
        rejected: "Rejected",
        cancelled: "Cancelled",
      }) as const
    )[value] ?? "Pending";
  return [
    ...time.map((item) => ({
      id: `time:${item.id}`,
      type: "Manual time" as const,
      title: "Manual time request",
      date: item.requested_date,
      minutes: item.requested_minutes,
      days: null,
      status: requestStatus(item.status),
      submittedAt: new Date(item.created_at).toLocaleString(),
      manager: "Your manager",
      reason: item.reason,
      counted: item.status === "approved",
      approvedMinutes: item.approved_minutes,
    })),
    ...(leave?.requests ?? []).map((item) => ({
      id: `leave:${item.id}`,
      type: "Holiday" as const,
      title: `${item.leave_type} leave · until ${item.end_date}`,
      date: item.start_date,
      minutes: null,
      days: item.requested_days,
      status: requestStatus(item.status),
      submittedAt: "—",
      manager: "Your manager",
      reason: item.reason ?? "",
      counted: false,
    })),
  ];
}
