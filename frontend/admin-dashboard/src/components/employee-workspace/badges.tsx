import { WorkspaceIcon } from "./WorkspaceIcon";
import type {
  ApprovalState,
  Priority,
  RequestStatus,
  TaskStatus,
} from "@/components/employee-workspace/model";

const approvalStyles: Record<ApprovalState, { cls: string; icon: string }> = {
  Approved: { cls: "bg-ew-ok-2 text-ew-ok", icon: "ri-checkbox-circle-fill" },
  Pending: { cls: "bg-ew-warn-2 text-ew-warn", icon: "ri-time-fill" },
  Rejected: { cls: "bg-ew-bad-2 text-ew-bad", icon: "ri-close-circle-fill" },
  "Not submitted": { cls: "bg-ew-bg-2 text-ew-muted", icon: "ri-subtract-line" },
};

const priorityStyles: Record<Priority, { cls: string; dot: string; icon: string }> = {
  Urgent: { cls: "text-ew-bad", dot: "bg-ew-bad", icon: "ri-alarm-warning-line" },
  High: { cls: "text-ew-pink", dot: "bg-ew-pink", icon: "ri-arrow-up-line" },
  Medium: { cls: "text-ew-warn", dot: "bg-ew-warn", icon: "ri-subtract-line" },
  Low: { cls: "text-ew-muted", dot: "bg-ew-dot", icon: "ri-arrow-down-line" },
};

const statusDot: Record<TaskStatus, string> = {
  "Not started": "bg-ew-dot",
  "In progress": "bg-ew-plum-2",
  "In review": "bg-ew-warn",
  Blocked: "bg-ew-bad",
  Completed: "bg-ew-ok",
};

const requestStyles: Record<RequestStatus, string> = {
  Approved: "bg-ew-ok-2 text-ew-ok",
  Pending: "bg-ew-warn-2 text-ew-warn",
  Rejected: "bg-ew-bad-2 text-ew-bad",
  Cancelled: "bg-ew-bg-2 text-ew-muted",
};

export function ApprovalBadge({ state }: { state: ApprovalState }) {
  const style = approvalStyles[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[11px] font-semibold whitespace-nowrap ${style.cls}`}
      title={`Manager approval: ${state}`}
    >
      <span className="flex h-3 w-3 items-center justify-center">
        <WorkspaceIcon className={`${style.icon} text-[11px]`} aria-hidden="true" />
      </span>
      {state}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: Priority }) {
  const style = priorityStyles[priority];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap ${style.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      {priority}
    </span>
  );
}

export function StatusTag({ status }: { status: TaskStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-ew-line bg-white px-1.5 py-[2px] text-[11.5px] font-medium text-ew-ink-2 whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full ${statusDot[status]}`} aria-hidden="true" />
      {status}
    </span>
  );
}

export function RequestStatusTag({ status }: { status: RequestStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-[3px] text-[11px] font-semibold whitespace-nowrap ${requestStyles[status]}`}
    >
      {status}
    </span>
  );
}

export function CountChip({ counted }: { counted: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-[2px] text-[10px] font-semibold tracking-wide whitespace-nowrap ${
        counted ? "bg-ew-ok-2 text-ew-ok" : "bg-ew-bg-2 text-ew-muted"
      }`}
    >
      {counted ? "COUNTED" : "NOT COUNTED"}
    </span>
  );
}
