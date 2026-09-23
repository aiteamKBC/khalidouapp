import type { ArchiveReason } from "@/api/people";
import { permissions } from "@/lib/permissions";
import type { User } from "@/types";

export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  fired: "Fired",
  resigned: "Resigned",
};

/** Archiving ends payroll at the last working day: HR / Super Admin only. */
export function canArchiveEmployees(user?: User | null) {
  if (!user) return false;
  return (
    (user.role === "hr" || user.isSuperAdmin) &&
    user.permissions.includes(permissions.peopleArchive)
  );
}
