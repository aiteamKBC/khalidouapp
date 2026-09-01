import { StatusBadge, type AnyStatus } from "@/components/ui/status-badge";
import { attendanceStatusBadges } from "@/lib/attendance-presentation";

type AttendanceStatusBadgesProps = {
  status: AnyStatus;
  deductibleLateSeconds: number;
  earlyLeaveSeconds: number;
};

export function AttendanceStatusBadges({
  status,
  deductibleLateSeconds,
  earlyLeaveSeconds,
}: AttendanceStatusBadgesProps) {
  const statuses = attendanceStatusBadges({
    status,
    deductibleLateSeconds,
    earlyLeaveSeconds,
  });

  return (
    <div className="flex flex-wrap gap-1.5">
      {statuses.map((attendanceStatus) => (
        <StatusBadge key={attendanceStatus} status={attendanceStatus as AnyStatus} />
      ))}
    </div>
  );
}
