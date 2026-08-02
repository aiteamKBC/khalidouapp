import type { EmployeeStatus } from "../types/index.ts";

export const MEMBER_ACTIVITY_FILTERS = [
  "all",
  "active",
  "idle",
  "on_break",
  "off_shift",
  "offline",
] as const;

export type MemberActivityFilter = (typeof MEMBER_ACTIVITY_FILTERS)[number];

export function matchesMemberActivityFilter(
  status: EmployeeStatus,
  filter: MemberActivityFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status === "active" || status === "break_work";
  if (filter === "idle") return status === "idle" || status === "locked" || status === "sleeping";
  return status === filter;
}
