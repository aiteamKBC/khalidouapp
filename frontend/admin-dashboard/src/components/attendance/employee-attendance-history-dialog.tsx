import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { History, Images } from "lucide-react";

import {
  getDailyAttendance,
  getEmployeeAttendanceRange,
  type DailyAttendance,
} from "@/api/attendance";
import { WorkdayTimeline } from "@/components/workday-timeline";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAttendanceStart, formatClock } from "@/lib/format";

type EmployeeAttendanceHistoryDialogProps = {
  employeeId: string | null;
  employeeName?: string;
  startDate: string;
  endDate: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function EmployeeAttendanceHistoryDialog({
  employeeId,
  employeeName,
  startDate,
  endDate,
  open,
  onOpenChange,
}: EmployeeAttendanceHistoryDialogProps) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const currentDay = localDateKey();
  const history = useQuery({
    queryKey: ["attendance-employee-history", employeeId, startDate, endDate],
    queryFn: ({ signal }) =>
      getEmployeeAttendanceRange(employeeId!, startDate, endDate, signal),
    enabled: open && Boolean(employeeId),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
  const dayDetail = useQuery({
    queryKey: ["attendance-employee-history-day", employeeId, selectedDay],
    queryFn: ({ signal }) => getDailyAttendance(employeeId!, selectedDay!, signal),
    enabled: open && Boolean(employeeId) && Boolean(selectedDay),
    staleTime: selectedDay === currentDay ? 30_000 : 5 * 60_000,
    refetchInterval: open && selectedDay === currentDay ? 60_000 : false,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });
  const rows = history.data?.rows ?? [];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedDay(null);
          onOpenChange(nextOpen);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-7xl overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-3 pr-7">
              <div>
                <DialogTitle>
                  {employeeName ?? history.data?.employeeName ?? "Attendance history"}
                </DialogTitle>
                <DialogDescription>
                  Daily attendance from {startDate} through {endDate}. Select a date to inspect its
                  full timeline.
                </DialogDescription>
              </div>
              {employeeId && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" asChild>
                    <Link to="/screenshots" search={{ employeeId, startDate, endDate }}>
                      <Images className="mr-1 h-4 w-4" />
                      Period screenshots
                    </Link>
                  </Button>
                  <Button type="button" variant="outline" size="sm" asChild>
                    <Link to="/history" search={{ employeeId, day: endDate }}>
                      <History className="mr-1 h-4 w-4" />
                      End-day app & site history
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>

          {history.isLoading ? (
            <div className="h-64 animate-pulse rounded-xl bg-muted" />
          ) : history.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
              Attendance history could not be loaded.
            </div>
          ) : history.data ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <MiniMetric
                  label="Scheduled days"
                  value={String(history.data.summary.scheduledDays)}
                />
                <MiniMetric label="Worked days" value={String(history.data.summary.workedDays)} />
                <MiniMetric label="Leave days" value={String(history.data.summary.leaveDays)} />
                <MiniMetric
                  label="Recorded overtime"
                  value={formatDuration(history.data.summary.approvedOvertimeSeconds)}
                />
                <MiniMetric label="Screenshots" value={String(history.data.summary.screenshots)} />
              </div>

              <div className="overflow-hidden rounded-xl border [&>div]:max-h-[54vh] [&>div]:overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_th]:bg-card">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>First / last / sign-out</TableHead>
                      <TableHead>Normal</TableHead>
                      <TableHead>Idle</TableHead>
                      <TableHead>Late</TableHead>
                      <TableHead>Payable</TableHead>
                      <TableHead>Extra / overtime</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Evidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <AttendanceDayRow key={row.id} row={row} onSelectDay={setSelectedDay} />
                    ))}
                    {rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                          No attendance days were found in this period.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedDay)}
        onOpenChange={(nextOpen) => !nextOpen && setSelectedDay(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-3 pr-7">
              <div>
                <DialogTitle>
                  {employeeName ?? history.data?.employeeName ?? "Attendance detail"} ·{" "}
                  {selectedDay}
                </DialogTitle>
                <DialogDescription>
                  Full tracked activity, idle, breaks, extra work and overtime for this day.
                </DialogDescription>
              </div>
              {employeeId && selectedDay && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" asChild>
                    <Link to="/screenshots" search={{ employeeId, day: selectedDay }}>
                      <Images className="mr-1 h-4 w-4" />
                      Day screenshots
                    </Link>
                  </Button>
                  <Button type="button" variant="outline" size="sm" asChild>
                    <Link to="/history" search={{ employeeId, day: selectedDay }}>
                      <History className="mr-1 h-4 w-4" />
                      App & site history
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>

          {dayDetail.isLoading ? (
            <div className="h-64 animate-pulse rounded-xl bg-muted" />
          ) : dayDetail.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
              Attendance detail could not be loaded.
            </div>
          ) : dayDetail.data ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <MiniMetric
                  label="Started"
                  value={formatAttendanceStart(
                    dayDetail.data.actualFirstActivityAt,
                    dayDetail.data.timezone,
                    dayDetail.data.continuedFromPreviousDay,
                    dayDetail.data.continuedSessionStartedAt,
                  )}
                />
                <MiniMetric
                  label="Last activity"
                  value={formatClock(dayDetail.data.actualLastActivityAt, dayDetail.data.timezone)}
                />
                <MiniMetric
                  label="Signed out"
                  value={
                    dayDetail.data.isRunning
                      ? "Open until now"
                      : formatClock(dayDetail.data.actualSignOutAt, dayDetail.data.timezone)
                  }
                />
                <MiniMetric
                  label="Normal"
                  value={formatDuration(dayDetail.data.normalWorkedSeconds)}
                />
                <MiniMetric
                  label="Recorded idle"
                  value={formatDuration(dayDetail.data.recordedIdleSeconds)}
                />
                <MiniMetric
                  label="Paid idle grace"
                  value={formatDuration(dayDetail.data.paidIdleGraceSeconds)}
                />
                <MiniMetric
                  label="Deductible idle"
                  value={formatDuration(dayDetail.data.idleSeconds)}
                />
                <MiniMetric
                  label="Paid breaks"
                  value={formatDuration(dayDetail.data.paidBreakSeconds)}
                />
                <MiniMetric
                  label="Unpaid breaks"
                  value={formatDuration(dayDetail.data.unpaidBreakSeconds)}
                />
                <MiniMetric
                  label="Before shift"
                  value={formatDuration(dayDetail.data.preShiftExtraSeconds)}
                />
                <MiniMetric
                  label="After shift"
                  value={formatDuration(dayDetail.data.postShiftExtraSeconds)}
                />
                <MiniMetric
                  label="Overtime"
                  value={formatDuration(dayDetail.data.recordedOvertimeSeconds)}
                />
                <MiniMetric
                  label="Payable"
                  value={formatDuration(dayDetail.data.totalPayableSeconds)}
                />
              </div>
              <WorkdayTimeline timeline={dayDetail.data.timeline} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AttendanceDayRow({
  row,
  onSelectDay,
}: {
  row: DailyAttendance;
  onSelectDay: (day: string) => void;
}) {
  const overtimeNotes = [
    row.status === "worked_off_day" ? "Extra day" : null,
    row.approvedOvertimeSeconds > 0
      ? `${formatDuration(row.approvedOvertimeSeconds)} approved`
      : null,
    row.unapprovedOvertimeSeconds > 0
      ? `${formatDuration(row.unapprovedOvertimeSeconds)} pending`
      : null,
  ].filter(Boolean);

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap font-semibold">
        <button
          type="button"
          className="rounded text-left text-info underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onSelectDay(row.date)}
        >
          {row.date}
        </button>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        {formatClock(row.scheduledStartAt, row.timezone)} –{" "}
        {formatClock(row.scheduledEndAt, row.timezone)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        {formatAttendanceStart(
          row.actualFirstActivityAt,
          row.timezone,
          row.continuedFromPreviousDay,
          row.continuedSessionStartedAt,
        )}{" "}
        – {formatClock(row.actualLastActivityAt, row.timezone)}
        <span
          className={`block text-[10px] ${
            row.isRunning ? "font-semibold text-emerald-700" : "text-muted-foreground"
          }`}
        >
          Sign-out{" "}
          {row.isRunning ? "Open until now" : formatClock(row.actualSignOutAt, row.timezone)}
        </span>
      </TableCell>
      <TableCell>{formatDuration(row.normalWorkedSeconds)}</TableCell>
      <TableCell>
        {formatDuration(row.recordedIdleSeconds)}
        <span className="block text-[10px] text-muted-foreground">
          {formatDuration(row.idleSeconds)} deductible
        </span>
      </TableCell>
      <TableCell>
        {formatDuration(row.deductibleLateSeconds)}
        <span className="block text-[10px] text-muted-foreground">
          {formatDuration(row.rawLateSeconds)} raw
        </span>
      </TableCell>
      <TableCell className="font-semibold">{formatDuration(row.totalPayableSeconds)}</TableCell>
      <TableCell className="whitespace-nowrap">
        <span
          className={
            row.recordedOvertimeSeconds > 0 ? "font-semibold text-info" : "text-muted-foreground"
          }
        >
          {formatDuration(row.recordedOvertimeSeconds)}
        </span>
        <span className="block text-[10px] text-muted-foreground">
          {overtimeNotes.length ? overtimeNotes.join(" · ") : "No extra time"}
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge status={row.status} />
      </TableCell>
      <TableCell className="text-right">
        <Button type="button" size="sm" variant="outline" asChild>
          <Link to="/screenshots" search={{ employeeId: row.employeeId, day: row.date }}>
            <Images className="mr-1 h-4 w-4" />
            {row.screenshotCount} screenshots
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono-numeric text-lg font-extrabold">{value}</p>
    </div>
  );
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
