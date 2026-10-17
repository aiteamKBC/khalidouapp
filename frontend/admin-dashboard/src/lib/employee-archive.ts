import type { ArchiveReason } from "@/api/people";
import { hasHrAuthority, permissions } from "@/lib/permissions";
import type { User } from "@/types";

export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  fired: "Fired",
  resigned: "Resigned",
};

/** Archiving ends payroll at the last working day: HR / General Admin / Super Admin only. */
export function canArchiveEmployees(user?: User | null) {
  if (!user) return false;
  return hasHrAuthority(user) && user.permissions.includes(permissions.peopleArchive);
}
