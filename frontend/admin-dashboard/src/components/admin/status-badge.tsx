import type { ComponentProps } from "react";
import { StatusBadge as Base } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
export type { AnyStatus } from "@/components/ui/status-badge";

export function StatusBadge({ className, ...props }: ComponentProps<typeof Base>) {
  const { status } = props;
  const tone = [
    "active",
    "online",
    "complete",
    "approved",
    "paid",
    "present",
    "approved_leave",
  ].includes(status)
    ? "green"
    : [
          "idle",
          "expired",
          "missing",
          "pending",
          "needs_review",
          "app_pending",
          "late",
          "left_early",
        ].includes(status)
      ? "amber"
      : ["offline", "revoked", "rejected", "absent"].includes(status)
        ? "rose"
        : [
              "in_progress",
              "on_break",
              "break_work",
              "off_shift",
              "draft",
              "invited",
              "off_day",
              "worked_off_day",
            ].includes(status)
          ? "plum"
          : "muted";
  return <Base {...props} className={cn("admin-status", `admin-status-${tone}`, className)} />;
}
