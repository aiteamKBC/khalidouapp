import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ArchiveReason, PersonArchiveInput } from "@/api/people";
import { ARCHIVE_REASON_LABELS } from "@/lib/employee-archive";

function todayIsoDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function ArchiveEmployeeDialog({
  open,
  name,
  startDate,
  pending = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  name?: string;
  /** Employment start date; the last working day cannot precede it. */
  startDate?: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: PersonArchiveInput) => void;
}) {
  const [reason, setReason] = useState<ArchiveReason | "">("");
  const [lastWorkingDay, setLastWorkingDay] = useState(todayIsoDate());

  useEffect(() => {
    if (open) {
      setReason("");
      setLastWorkingDay(todayIsoDate());
    }
  }, [open]);

  const today = todayIsoDate();
  const dateError = !lastWorkingDay
    ? "Choose the last working day."
    : lastWorkingDay > today
      ? "The last working day cannot be in the future."
      : startDate && lastWorkingDay < startDate
        ? "The last working day cannot be before the start date."
        : null;
  const canSubmit = reason !== "" && dateError === null && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive {name ?? "employee"}?</DialogTitle>
          <DialogDescription>
            They are signed out of the Khaliduo desktop app and portal, hidden from current views,
            and paid only up to and including their last working day. Their history and closed
            payroll records are kept, and HR can restore them later.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="archive-reason">Reason</Label>
            <Select value={reason} onValueChange={(value) => setReason(value as ArchiveReason)}>
              <SelectTrigger id="archive-reason">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="resigned">{ARCHIVE_REASON_LABELS.resigned}</SelectItem>
                <SelectItem value="fired">{ARCHIVE_REASON_LABELS.fired}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="archive-last-working-day">Last working day</Label>
            <Input
              id="archive-last-working-day"
              type="date"
              value={lastWorkingDay}
              min={startDate}
              max={today}
              onChange={(event) => setLastWorkingDay(event.target.value)}
            />
            {dateError ? (
              <p className="text-xs text-destructive">{dateError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Attendance and payroll stop counting after this day.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canSubmit}
            onClick={() => {
              if (reason) onConfirm({ reason, lastWorkingDay });
            }}
          >
            {pending ? "Archiving..." : "Archive employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
