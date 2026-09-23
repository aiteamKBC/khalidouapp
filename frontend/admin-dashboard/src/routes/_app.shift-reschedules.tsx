import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Siren, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNotePrompt } from "@/components/note-prompt-dialog";
import {
  createEmergencyShiftReschedule,
  getShiftRescheduleDay,
  listShiftReschedules,
  reviewShiftReschedule,
  sameLengthEnd,
  type ShiftReschedule,
  type ShiftRescheduleStatus,
} from "@/api/shiftReschedules";
import { listEmployees } from "@/api/employees";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_app/shift-reschedules")({
  component: ShiftReschedulesPage,
});

const STATUS_STYLES: Record<ShiftRescheduleStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending review",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  approved: {
    label: "Approved",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  rejected: { label: "Rejected", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
};

function localDateKey(value = new Date()): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function invalidateScheduleViews(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["shift-reschedules"] }),
    queryClient.invalidateQueries({ queryKey: ["attendance"] }),
    queryClient.invalidateQueries({ queryKey: ["payroll"] }),
    queryClient.invalidateQueries({ queryKey: ["ts"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
}

function ShiftReschedulesPage() {
  const { user } = useAuth();
  // Matches the server: only the Super Admin and HR review shift reschedules.
  const canReview = Boolean(user && (user.isSuperAdmin || user.role === "hr"));
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ShiftRescheduleStatus | "all">("pending");
  const [reviewing, setReviewing] = useState<Record<string, "approved" | "rejected">>({});
  const { prompt, dialog } = useNotePrompt();

  const requests = useQuery({
    queryKey: ["shift-reschedules", status],
    queryFn: ({ signal }) => listShiftReschedules(status, signal),
    enabled: canReview,
  });

  const review = useMutation({
    mutationFn: ({
      id,
      decision,
      reviewReason,
    }: {
      id: string;
      decision: "approved" | "rejected";
      reviewReason?: string;
    }) => reviewShiftReschedule(id, { status: decision, reviewReason }),
    onMutate: ({ id, decision }) => setReviewing((current) => ({ ...current, [id]: decision })),
    onSuccess: async (_, { decision }) => {
      toast.success(
        decision === "approved" ? "Shift reschedule approved" : "Shift reschedule rejected",
      );
      await invalidateScheduleViews(queryClient);
    },
    onError: async (error) => {
      toast.error(error instanceof Error ? error.message : "Review failed");
      await queryClient.invalidateQueries({ queryKey: ["shift-reschedules"] });
    },
    onSettled: (_, __, { id }) =>
      setReviewing((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      }),
  });

  async function reject(row: ShiftReschedule) {
    const reviewReason = await prompt({
      title: `Reject ${row.employeeName}'s shift reschedule`,
      description: "The employee sees this reason in the desktop app.",
      placeholder: "Why is this reschedule rejected?",
      confirmLabel: "Reject",
    });
    if (!reviewReason) return;
    review.mutate({ id: row.id, decision: "rejected", reviewReason });
  }

  if (!canReview) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Access denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Only the Super Admin or HR can manage shift reschedules.
          </p>
        </div>
      </div>
    );
  }

  const rows = requests.data ?? [];

  return (
    <div>
      <PageHeader
        title="Shift reschedules"
        description="One-day shift moves requested from the desktop app. The new range keeps the normal shift length; approving it moves paid hours, lateness and overtime for that day. Requests still pending when the day starts expire and the normal shift applies."
        actions={
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as ShiftRescheduleStatus | "all")}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <EmergencyRescheduleCard
        onCreated={() => invalidateScheduleViews(queryClient)}
        currentEmployeeId={user?.employeeId ?? null}
      />

      <Card className="mt-4 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Day</TableHead>
              <TableHead>Normal shift</TableHead>
              <TableHead>New shift</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Loading shift reschedules…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No shift reschedules.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const pending = reviewing[row.id];
                const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.pending;
                const isSelf = Boolean(user?.employeeId && user.employeeId === row.employeeId);
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-bold">{row.employeeName}</div>
                      {row.employeeCode && (
                        <div className="text-xs text-muted-foreground">{row.employeeCode}</div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(row.workDate)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {row.originalStart}–{row.originalEnd}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">
                      {row.requestedStart}–{row.requestedEnd}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="text-sm">{row.reason}</div>
                      {row.source === "admin" && (
                        <div className="mt-1 text-[11px] font-semibold text-muted-foreground">
                          Emergency by {row.createdByName ?? "admin"}
                        </div>
                      )}
                      {row.reviewReason && (
                        <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                          Rejection: {row.reviewReason}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex w-fit items-center rounded px-2 py-1 text-xs font-medium ${style.className}`}
                      >
                        {style.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status === "pending" && !isSelf ? (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={Boolean(pending)}
                            onClick={() => review.mutate({ id: row.id, decision: "approved" })}
                          >
                            <Check className="mr-1 h-4 w-4" />
                            {pending === "approved" ? "Approving…" : "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={Boolean(pending)}
                            onClick={() => void reject(row)}
                          >
                            <X className="mr-1 h-4 w-4" />
                            {pending === "rejected" ? "Rejecting…" : "Reject"}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {row.status === "pending"
                            ? "Your own request"
                            : row.reviewedByName
                              ? `By ${row.reviewedByName}${row.reviewedAt ? ` · ${formatDateTime(row.reviewedAt)}` : ""}`
                              : "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
      {dialog}
    </div>
  );
}

function EmergencyRescheduleCard({
  onCreated,
  currentEmployeeId,
}: {
  onCreated: () => Promise<unknown>;
  currentEmployeeId: string | null;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [workDate, setWorkDate] = useState(() => localDateKey());
  const [start, setStart] = useState("");
  const [reason, setReason] = useState("");
  const employees = useQuery({
    queryKey: ["employees", "shift-reschedule-picker"],
    queryFn: ({ signal }) => listEmployees(undefined, signal),
  });
  const day = useQuery({
    queryKey: ["shift-reschedules", "day", employeeId, workDate],
    queryFn: ({ signal }) => getShiftRescheduleDay(employeeId, workDate, signal),
    enabled: Boolean(employeeId && workDate),
  });
  const shiftMinutes = day.data?.scheduledDay ? day.data.shiftMinutes : 0;
  const end = start && shiftMinutes ? sameLengthEnd(start, shiftMinutes) : null;

  const create = useMutation({
    mutationFn: () =>
      createEmergencyShiftReschedule({
        employeeId,
        workDate,
        requestedStart: start,
        requestedEnd: end ?? "",
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      toast.success("Emergency reschedule applied and attendance recalculated");
      setStart("");
      setReason("");
      await onCreated();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Emergency reschedule failed"),
  });

  const employeeOptions = (employees.data ?? []).filter(
    (employee) => employee.id !== currentEmployeeId,
  );

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Siren className="h-4 w-4 text-rose-600" />
        <h3 className="font-extrabold">Emergency reschedule</h3>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Moves an employee's shift for today or a future day immediately (approved on save). The new
        range keeps the normal shift length and must end before midnight. Breaks keep their times if
        they still fit inside the new range. For today, recorded work is reclassified at once.
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label>Employee</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose employee" />
            </SelectTrigger>
            <SelectContent>
              {employeeOptions.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="emergency-date">Day</Label>
          <Input
            id="emergency-date"
            type="date"
            min={localDateKey()}
            value={workDate}
            onChange={(event) => setWorkDate(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="emergency-start">New start time</Label>
          <Input
            id="emergency-start"
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            disabled={!day.data?.scheduledDay}
          />
        </div>
        <div className="space-y-1">
          <Label>New end time</Label>
          <div className="flex h-9 items-center rounded-md border px-3 text-sm">
            {end ?? (start && shiftMinutes ? "Crosses midnight" : "—")}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {!employeeId
          ? "Choose an employee to see their normal shift."
          : day.isLoading
            ? "Loading normal shift…"
            : day.isError
              ? "Could not load the normal shift for that day."
              : day.data?.scheduledDay
                ? `Normal shift that day: ${day.data.shiftStart}–${day.data.shiftEnd} (${Math.floor(shiftMinutes / 60)}h${shiftMinutes % 60 ? ` ${shiftMinutes % 60}m` : ""}).`
                : "That day is not a scheduled working day for this employee."}
      </p>
      <div className="mt-3 space-y-1">
        <Label htmlFor="emergency-reason">Reason</Label>
        <Textarea
          id="emergency-reason"
          rows={2}
          value={reason}
          maxLength={1000}
          placeholder="Why is this shift being moved?"
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          disabled={
            !employeeId || !workDate || !end || reason.trim().length < 3 || create.isPending
          }
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Applying…" : "Apply emergency reschedule"}
        </Button>
      </div>
    </Card>
  );
}
