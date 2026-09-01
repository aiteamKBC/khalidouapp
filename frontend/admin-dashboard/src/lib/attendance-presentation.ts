export type AttendancePresentationIssue = {
  code: string;
  seconds?: number;
};

export type AttendanceNotice = {
  key: string;
  label: string;
  seconds: number;
  tone: "warning" | "info" | "extra";
};

const ISSUE_LABELS: Record<string, string> = {
  late: "Late arrival",
  early_leave: "Left early",
  unexplained_idle: "Deductible idle after grace",
  attendance_corrected: "Attendance corrected",
  missing_check_in: "Missing check-in",
};

export function attendanceStatusBadges(input: {
  status: string;
  deductibleLateSeconds: number;
  earlyLeaveSeconds: number;
}) {
  const statuses = [input.status];
  if (input.deductibleLateSeconds > 0 && !statuses.includes("late")) {
    statuses.push("late");
  }
  if (input.earlyLeaveSeconds > 0 && !statuses.includes("left_early")) {
    statuses.push("left_early");
  }
  return statuses;
}

function fallbackIssueLabel(code: string) {
  const label = code.replaceAll("_", " ");
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : "Attendance issue";
}

export function buildAttendanceNotices(input: {
  issues: AttendancePresentationIssue[];
  pendingManualSeconds: number;
  pendingOvertimeSeconds: number;
}): AttendanceNotice[] {
  const notices: AttendanceNotice[] = [];
  const seenIssueCodes = new Set<string>();
  let hasOvertimeDecisionIssue = false;

  for (const issue of input.issues) {
    if (
      issue.code === "overtime_pending" ||
      issue.code === "overtime_rejected" ||
      issue.code === "overtime_recorded_only"
    ) {
      if (seenIssueCodes.has(issue.code)) continue;
      seenIssueCodes.add(issue.code);
      hasOvertimeDecisionIssue = true;
      notices.push({
        key: issue.code,
        label:
          issue.code === "overtime_pending"
            ? "Extra time pending approval"
            : issue.code === "overtime_rejected"
              ? "Extra time rejected"
              : "Extra time recorded only",
        seconds: Math.max(0, issue.seconds ?? 0),
        tone: "extra",
      });
      continue;
    }
    if (seenIssueCodes.has(issue.code)) continue;
    seenIssueCodes.add(issue.code);
    notices.push({
      key: issue.code,
      label: ISSUE_LABELS[issue.code] ?? fallbackIssueLabel(issue.code),
      seconds: Math.max(0, issue.seconds ?? 0),
      tone: "warning",
    });
  }

  if (input.pendingManualSeconds > 0) {
    notices.push({
      key: "manual_time_pending",
      label: "Manual time pending approval",
      seconds: input.pendingManualSeconds,
      tone: "info",
    });
  }

  // Older materialized rows may not have a specific overtime issue code yet.
  // Keep one backwards-compatible pending notice until the API recalculates it.
  if (!hasOvertimeDecisionIssue && input.pendingOvertimeSeconds > 0) {
    notices.push({
      key: "overtime_pending",
      label: "Extra time pending approval",
      seconds: input.pendingOvertimeSeconds,
      tone: "extra",
    });
  }

  return notices;
}

export function overtimeReviewExplanation(input: {
  issues: AttendancePresentationIssue[];
  unapprovedOvertimeSeconds: number;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
}) {
  if (input.unapprovedOvertimeSeconds <= 0) return null;
  const issueCodes = new Set(input.issues.map((issue) => issue.code));
  if (issueCodes.has("overtime_rejected")) {
    return "This extra time was rejected in Payroll and is not payable.";
  }
  if (issueCodes.has("overtime_recorded_only")) {
    return "Overtime was disabled for this workday. The extra time is preserved for audit but is not payable unless the policy or payroll decision is changed.";
  }
  if (!input.scheduledStartAt || !input.scheduledEndAt) {
    return "No shift was scheduled for this date, so all tracked time is recorded as extra. It is waiting for review and has not been rejected.";
  }
  return "This extra time is waiting for review and has not been rejected.";
}
