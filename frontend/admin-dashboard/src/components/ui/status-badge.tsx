import { cn } from "@/lib/utils";
import type {
  DeviceStatus,
  EmployeeStatus,
  TeamStatus,
  TimeAdjustmentStatus,
  UserStatus,
} from "@/types";

export type AnyStatus =
  | EmployeeStatus
  | DeviceStatus
  | TeamStatus
  | UserStatus
  | TimeAdjustmentStatus
  | "invited"
  | "expired"
  | "revoked"
  | "complete"
  | "draft"
  | "needs_review"
  | "paid"
  | "in_progress"
  | "missing"
  | "present"
  | "late"
  | "left_early"
  | "not_started"
  | "absent"
  | "approved_leave"
  | "off_day"
  | "worked_off_day";

const styles: Record<string, string> = {
  active: "bg-success/15 text-success ring-success/30",
  online: "bg-success/15 text-success ring-success/30",
  complete: "bg-success/15 text-success ring-success/30",
  idle: "bg-warning/15 text-warning-foreground ring-warning/40",
  in_progress: "bg-info/15 text-info ring-info/30",
  locked: "bg-muted text-muted-foreground ring-border",
  sleeping: "bg-muted text-muted-foreground ring-border",
  inactive: "bg-muted text-muted-foreground ring-border",
  archived: "bg-muted text-muted-foreground ring-border",
  used: "bg-muted text-muted-foreground ring-border",
  expired: "bg-warning/15 text-warning-foreground ring-warning/40",
  missing: "bg-warning/15 text-warning-foreground ring-warning/40",
  pending: "bg-warning/15 text-warning-foreground ring-warning/40",
  needs_review: "bg-warning/15 text-warning-foreground ring-warning/40",
  draft: "bg-info/15 text-info ring-info/30",
  invited: "bg-info/15 text-info ring-info/30",
  approved: "bg-success/15 text-success ring-success/30",
  present: "bg-success/15 text-success ring-success/30",
  approved_leave: "bg-success/15 text-success ring-success/30",
  off_day: "bg-info/15 text-info ring-info/30",
  worked_off_day: "bg-info/15 text-info ring-info/30",
  paid: "bg-success/15 text-success ring-success/30",
  rejected: "bg-destructive/15 text-destructive ring-destructive/30",
  late: "bg-warning/15 text-warning-foreground ring-warning/40",
  left_early: "bg-warning/15 text-warning-foreground ring-warning/40",
  not_started: "bg-muted text-muted-foreground ring-border",
  absent: "bg-destructive/15 text-destructive ring-destructive/30",
  offline: "bg-destructive/15 text-destructive ring-destructive/30",
  revoked: "bg-destructive/25 text-destructive ring-destructive/40",
};

export function StatusBadge({ status, className }: { status: AnyStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset capitalize",
        styles[status] ?? "bg-muted text-muted-foreground ring-border",
        className,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", {
          "bg-success": [
            "active",
            "online",
            "complete",
            "approved",
            "paid",
            "present",
            "approved_leave",
          ].includes(status),
          "bg-warning": [
            "idle",
            "missing",
            "pending",
            "expired",
            "needs_review",
            "late",
            "left_early",
          ].includes(status),
          "bg-info": ["in_progress", "invited", "draft", "off_day", "worked_off_day"].includes(
            status,
          ),
          "bg-muted-foreground": ["locked", "sleeping", "inactive", "archived", "used"].includes(
            status,
          ),
          "bg-destructive": ["offline", "revoked", "rejected", "absent"].includes(status),
        })}
      />
      {status.replace("_", " ")}
    </span>
  );
}
