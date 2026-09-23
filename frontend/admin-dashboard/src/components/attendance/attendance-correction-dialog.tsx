import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PencilLine, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  adminCloseSession,
  deleteAttendanceCorrection,
  updateAttendanceCorrection,
  type DailyAttendance,
} from "@/api/attendance";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { formatClock } from "@/lib/format";

function toTimeInput(value?: string | null, timezone?: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone || undefined,
  }).formatToParts(new Date(value));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

type CorrectAttendanceProps = {
  employeeId: string;
  workDate: string;
  attendance: DailyAttendance;
  /** Refresh the surfaces that show this day after a save/remove/close. */
  onSaved: () => Promise<void> | void;
  /** Optional visual variant for the trigger button. */
  buttonVariant?: "default" | "outline" | "ghost";
  buttonSize?: "default" | "sm";
  buttonClassName?: string;
};

/**
 * The single "Correct attendance" entry point reused across every employee-day
 * timeline/detail surface (Employee Monitoring, the Attendance page, the
 * employee ledger dialog, ...). It gates on the timesheets.manage capability and
 * calls the existing attendance-correction API — no separate correction model.
 */
export function CorrectAttendanceButton({
  employeeId,
  workDate,
  attendance,
  onSaved,
  buttonVariant = "outline",
  buttonSize = "sm",
  buttonClassName,
}: CorrectAttendanceProps) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);

  // Authorization is enforced on the backend too; this only hides the action
  // from users who cannot use it.
  if (!can(permissions.timesheetsManage)) {
    return null;
  }

  return (
    <>
      <Button
        variant={buttonVariant}
        size={buttonSize}
        className={buttonClassName}
        onClick={() => setOpen(true)}
      >
        <PencilLine className="mr-1.5 h-4 w-4" />
        {attendance.attendanceCorrection ? "Edit correction" : "Correct attendance"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Correct attendance</DialogTitle>
            <DialogDescription>
              Adjust the payable accounting for this day. Raw tracking evidence —
              sessions, screenshots, heartbeats, and activity events — is always
              preserved.
            </DialogDescription>
          </DialogHeader>
          <AttendanceCorrectionCard
            employeeId={employeeId}
            workDate={workDate}
            attendance={attendance}
            onSaved={async () => {
              await onSaved();
            }}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AttendanceCorrectionCard({
  employeeId,
  workDate,
  attendance,
  onSaved,
  onDone,
}: {
  employeeId: string;
  workDate: string;
  attendance: DailyAttendance;
  onSaved: () => Promise<void>;
  onDone: () => void;
}) {
  const { can } = useAuth();
  const canEndSession = can(permissions.devicesManage);

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [payableMinutesDelta, setPayableMinutesDelta] = useState("0");
  const [reason, setReason] = useState("");

  useEffect(() => {
    setStartTime(toTimeInput(attendance.actualFirstActivityAt, attendance.timezone));
    setEndTime(toTimeInput(attendance.actualLastActivityAt, attendance.timezone));
    setPayableMinutesDelta(String(Math.round(attendance.attendanceAdjustmentSeconds / 60)));
    setReason(attendance.attendanceCorrection?.reason ?? "");
  }, [attendance]);

  const rawStart =
    attendance.attendanceCorrection?.rawFirstActivityAt ?? attendance.actualFirstActivityAt;
  const rawEnd =
    attendance.attendanceCorrection?.rawLastActivityAt ?? attendance.actualLastActivityAt;
  const isRunning = attendance.isRunning;
  // A corrected end while the session is still tracking needs an explicit choice.
  const enteringCorrectedEnd = endTime.trim().length > 0;

  const save = useMutation({
    mutationFn: () =>
      updateAttendanceCorrection(employeeId, workDate, {
        startTime: startTime || null,
        endTime: endTime || null,
        payableMinutesDelta: Number(payableMinutesDelta) || 0,
        reason,
      }),
    onSuccess: async () => {
      toast.success("Attendance correction saved with an audit record.");
      await onSaved();
      onDone();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save the correction."),
  });

  const remove = useMutation({
    mutationFn: () => deleteAttendanceCorrection(employeeId, workDate),
    onSuccess: async () => {
      toast.success("Manual correction removed. Tracking evidence is active again.");
      await onSaved();
      onDone();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not remove the correction."),
  });

  const endAndSave = useMutation({
    mutationFn: async () => {
      // End the live session first (dedicated audited operation), then save the
      // correction. A corrected end alone never stops a running session.
      await adminCloseSession(employeeId, {
        reason: reason.trim() || "Administrative session close",
      });
      return updateAttendanceCorrection(employeeId, workDate, {
        startTime: startTime || null,
        endTime: endTime || null,
        payableMinutesDelta: Number(payableMinutesDelta) || 0,
        reason,
      });
    },
    onSuccess: async () => {
      toast.success("Session closed and attendance correction saved.");
      await onSaved();
      onDone();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Could not close the session and save.",
      ),
  });

  const busy = save.isPending || remove.isPending || endAndSave.isPending;
  const reasonTooShort = reason.trim().length < 3;

  return (
    <div className="space-y-4">
      {isRunning && (
        <div className="flex gap-2 rounded-md border border-amber-300/70 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="font-medium">This employee is still tracking.</p>
            <p className="text-muted-foreground">
              A corrected end changes attendance accounting but does not stop the
              desktop session. Correcting only the start time is safe. If the
              employee can, ask them to Stop tracking normally first.
            </p>
            {attendance.actualLastActivityAt && (
              <p className="text-xs text-muted-foreground">
                Last activity: {formatClock(attendance.actualLastActivityAt, attendance.timezone)}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Corrected start</Label>
          <Input
            type="time"
            value={startTime}
            disabled={busy}
            onChange={(event) => setStartTime(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Raw: {rawStart ? formatClock(rawStart, attendance.timezone) : "—"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Corrected end</Label>
          <Input
            type="time"
            value={endTime}
            disabled={busy}
            onChange={(event) => setEndTime(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Raw: {rawEnd ? formatClock(rawEnd, attendance.timezone) : "—"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Payable minutes adjustment</Label>
          <Input
            type="number"
            min={-1440}
            max={1440}
            value={payableMinutesDelta}
            disabled={busy}
            onChange={(event) => setPayableMinutesDelta(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Positive adds approved time; negative removes it.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Required reason</Label>
        <Input
          value={reason}
          maxLength={2000}
          placeholder="Explain the evidence and why this correction is required."
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Raw tracking evidence is preserved. The editor, reason, and old/new values
        are written to the audit trail.
      </p>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {attendance.attendanceCorrection && (
          <Button
            variant="destructive"
            loading={remove.isPending}
            disabled={save.isPending || endAndSave.isPending}
            onClick={() => remove.mutate()}
          >
            Remove correction
          </Button>
        )}
        <Button
          loading={save.isPending}
          disabled={busy || reasonTooShort}
          onClick={() => save.mutate()}
        >
          <Save className="mr-2 h-4 w-4" />
          {isRunning && enteringCorrectedEnd ? "Save correction only" : "Save correction"}
        </Button>
        {isRunning && enteringCorrectedEnd && canEndSession && (
          <Button
            variant="outline"
            loading={endAndSave.isPending}
            disabled={busy || reasonTooShort}
            onClick={() => endAndSave.mutate()}
          >
            End session and save correction
          </Button>
        )}
      </div>
      {isRunning && enteringCorrectedEnd && !canEndSession && (
        <p className="text-right text-xs text-muted-foreground">
          Ending the live session requires the device-management permission.
        </p>
      )}
    </div>
  );
}
