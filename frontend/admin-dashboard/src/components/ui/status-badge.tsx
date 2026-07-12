import { cn } from "@/lib/utils";
import type {
  DeviceStatus,
  EmployeeStatus,
  EnrollmentCodeStatus,
  TeamStatus,
  TimeAdjustmentStatus,
  UserStatus,
} from "@/types";

type AnyStatus =
  | EmployeeStatus
  | DeviceStatus
  | EnrollmentCodeStatus
  | TeamStatus
  | UserStatus
  | TimeAdjustmentStatus
  | "revoked"
  | "complete"
  | "in_progress"
  | "missing";

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
  approved: "bg-success/15 text-success ring-success/30",
  rejected: "bg-destructive/15 text-destructive ring-destructive/30",
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
          "bg-success": ["active", "online", "complete", "approved"].includes(status),
          "bg-warning": ["idle", "missing", "pending", "expired"].includes(status),
          "bg-info": status === "in_progress",
          "bg-muted-foreground": ["locked", "sleeping", "inactive", "archived", "used"].includes(
            status,
          ),
          "bg-destructive": ["offline", "revoked", "rejected"].includes(status),
        })}
      />
      {status.replace("_", " ")}
    </span>
  );
}
