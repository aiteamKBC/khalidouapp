export type TaskStatus = "Not started" | "In progress" | "In review" | "Blocked" | "Completed";
export type ApprovalState = "Not submitted" | "Pending" | "Approved" | "Rejected";
export type Priority = "Low" | "Medium" | "High" | "Urgent";

export const TASK_STATUSES: TaskStatus[] = [
  "Not started",
  "In progress",
  "In review",
  "Blocked",
  "Completed",
];

export const PRIORITIES: Priority[] = ["Low", "Medium", "High", "Urgent"];

export type ChecklistItem = { id: string; text: string; done: boolean };
export type TaskComment = {
  id: string;
  author: string;
  initials: string;
  at: string;
  body: string;
};
export type TaskAttachment = { id: string; name: string; size: string; kind: string };

export type Task = {
  id: string;
  name: string;
  project: string;
  team: string;
  priority: Priority;
  status: TaskStatus;
  approval: ApprovalState;
  workedSeconds: number;
  startDate: string;
  deadline: string;
  description: string;
  outcome: string;
  checklist: ChecklistItem[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
  approvalNote?: string;
  canUpdateStatus: boolean;
  stage: string;
};

export type Breakdown = {
  workedSeconds: number;
  idleSeconds: number;
  manualApprovedSeconds: number;
  manualPendingSeconds: number;
  manualRejectedSeconds: number;
  manualTotalSeconds: number | null;
  points: number | null;
  screenshots: number | null;
  sessions: number | null;
  targetSeconds: number;
  sources: string;
  updatedAt: string;
};

export type SummaryKey = "today" | "week" | "month";

export type TimeSummary = {
  key: SummaryKey;
  label: string;
  range: string;
  breakdown: Breakdown;
};

export type Attendance = {
  signOut: string | null;
  shiftStart: string;
  shiftEnd: string;
  shiftLabel: string;
  status: "active" | "not-started" | "ended";
  firstActivity: string | null;
  lastActivity: string | null;
  sessions: { id: string; start: string; end: string | null }[];
  payableSeconds: number;
  lateMinutes: number;
  graceMinutes: number;
  overtimeSeconds: number;
};

export type ActivityEntry = {
  id: string;
  from: string;
  to: string;
  task: string;
  kind: "Worked" | "Paused" | "Idle";
  seconds: number;
};

export type RequestStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";
export type RequestType = "Manual time" | "Holiday" | "Early leave";

export type RequestItem = {
  id: string;
  type: RequestType;
  title: string;
  date: string;
  minutes: number | null;
  days: number | null;
  status: RequestStatus;
  submittedAt: string;
  manager: string;
  reason: string;
  counted: boolean;
  approvedMinutes?: number | null;
};

export type Employee = {
  name: string;
  firstName: string;
  role: string;
  team: string;
  email: string;
  avatar: string;
  employeeId: string;
};

export type Notification = {
  id: string;
  title: string;
  body: string;
  at: string;
  unread: boolean;
  icon: string;
};

export function countedSeconds(breakdown: Breakdown): number {
  return breakdown.workedSeconds + breakdown.manualApprovedSeconds;
}
