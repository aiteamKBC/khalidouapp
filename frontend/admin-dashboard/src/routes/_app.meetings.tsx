import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Images, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listMeetings,
  listMeetingScreenshots,
  reviewMeeting,
  type MeetingRecord,
  type MeetingStatus,
} from "@/api/meetings";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDurationSeconds } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/meetings")({
  component: MeetingsPage,
});

function formatClock(iso?: string | null): string {
  if (!iso) return "…";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "…";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type LifecycleView = {
  label: string;
  className: string;
};

// One unambiguous lifecycle: a meeting is either In progress, then Pending
// review once ended, then Approved or Rejected. It is never two of these at once.
function lifecycleView(meeting: MeetingRecord): LifecycleView {
  if (meeting.lifecycleState === "active") {
    return {
      label: "In progress",
      className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    };
  }
  if (meeting.status === "pending") {
    return {
      label: "Pending review",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    };
  }
  if (meeting.status === "approved") {
    return {
      label: "Approved",
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    };
  }
  return {
    label: "Rejected",
    className: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  };
}

function currentDurationSeconds(meeting: MeetingRecord, nowMs: number): number {
  if (meeting.endedAt) {
    return meeting.recordedSeconds;
  }
  // Active meeting: compute the elapsed time from the start so the dashboard
  // shows a running duration instead of a frozen 0m.
  const startedMs = Date.parse(meeting.startedAt);
  if (!Number.isFinite(startedMs)) return meeting.recordedSeconds;
  return Math.max(0, Math.floor((nowMs - startedMs) / 1000));
}

function MeetingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<MeetingStatus | "all">("pending");
  const [reviewing, setReviewing] = useState<Record<string, "approved" | "rejected">>({});
  const [screenshotMeeting, setScreenshotMeeting] = useState<MeetingRecord | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Meeting review is available to the Super Admin, company-scope admins
  // (General Admin / HR), and team leaders — matching the server authorization.
  // A team leader only sees and decides their own team's meetings.
  const isTeamLeader = (user?.teamLeadTeamIds?.length ?? 0) > 0;
  const canReview = Boolean(
    user &&
      (user.isSuperAdmin || user.dataScope === "company" || isTeamLeader),
  );

  // Keep active-meeting durations ticking without hammering the API.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const meetings = useQuery({
    queryKey: ["meetings", status],
    queryFn: ({ signal }) => listMeetings({ status }, signal),
    enabled: canReview,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: "approved" | "rejected" }) =>
      reviewMeeting(id, { status: nextStatus }),
    onMutate: ({ id, nextStatus }) => {
      setReviewing((current) => ({ ...current, [id]: nextStatus }));
    },
    onSuccess: async (_, variables) => {
      toast.success(variables.nextStatus === "approved" ? "Meeting approved" : "Meeting rejected");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
        queryClient.invalidateQueries({ queryKey: ["attendance"] }),
        queryClient.invalidateQueries({ queryKey: ["payroll"] }),
        queryClient.invalidateQueries({ queryKey: ["ts"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to review meeting"),
    onSettled: (_, __, variables) => {
      setReviewing((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
    },
  });

  if (!canReview) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Access denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Only an administrator, HR, or a team leader can review meetings.
          </p>
        </div>
      </div>
    );
  }

  const rows = meetings.data ?? [];

  return (
    <div>
      <PageHeader
        title="Meetings"
        description="Review desktop Meeting Mode periods. A meeting can be approved or rejected once it has ended; approving pays the covered in-shift time once, rejecting reverts to the underlying activity."
        actions={
          <Select value={status} onValueChange={(value) => setStatus(value as MeetingStatus | "all")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Meeting</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meetings.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Loading meetings…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No meetings to review.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((meeting) => {
                const pending = reviewing[meeting.id];
                const isActive = meeting.lifecycleState === "active";
                const canDecide = meeting.status === "pending" && !isActive;
                const lifecycle = lifecycleView(meeting);
                return (
                  <TableRow key={meeting.id}>
                    <TableCell className="font-medium">{meeting.employeeName}</TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="font-medium">{meeting.title}</div>
                      <div className="text-xs text-muted-foreground">{meeting.reason}</div>
                      {(meeting.projectName || meeting.taskName) && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {[meeting.projectName, meeting.taskName].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      <div className="mt-1 text-[11px] font-semibold text-muted-foreground">
                        Evidence: {meeting.workSessionId ? "linked tracking session" : "desktop record"}
                        {meeting.deviceName ? ` on ${meeting.deviceName}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(meeting.workDate)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatClock(meeting.startedAt)}
                      {" – "}
                      {meeting.endedAt ? formatClock(meeting.endedAt) : "ongoing"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDurationSeconds(currentDurationSeconds(meeting, nowMs))}
                      {isActive && (
                        <span className="ml-1 text-[11px] text-muted-foreground">so far</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex w-fit items-center rounded px-2 py-1 text-xs font-medium ${lifecycle.className}`}
                      >
                        {lifecycle.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setScreenshotMeeting(meeting)}
                          title="View screenshots captured during this meeting"
                        >
                          <Images className="mr-1 h-4 w-4" />
                          Screenshots
                        </Button>
                        {canDecide ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={Boolean(pending)}
                              onClick={() =>
                                reviewMutation.mutate({ id: meeting.id, nextStatus: "approved" })
                              }
                            >
                              <Check className="mr-1 h-4 w-4" />
                              {pending === "approved" ? "Approving…" : "Approve"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={Boolean(pending)}
                              onClick={() =>
                                reviewMutation.mutate({ id: meeting.id, nextStatus: "rejected" })
                              }
                            >
                              <X className="mr-1 h-4 w-4" />
                              {pending === "rejected" ? "Rejecting…" : "Reject"}
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {isActive
                              ? "Ends before review"
                              : meeting.reviewedByName
                                ? `By ${meeting.reviewedByName}`
                                : "—"}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <MeetingScreenshotsDialog
        meeting={screenshotMeeting}
        onClose={() => setScreenshotMeeting(null)}
      />
    </div>
  );
}

function MeetingScreenshotsDialog({
  meeting,
  onClose,
}: {
  meeting: MeetingRecord | null;
  onClose: () => void;
}) {
  const shots = useQuery({
    queryKey: ["meetings", "screenshots", meeting?.id],
    queryFn: ({ signal }) => listMeetingScreenshots(meeting!.id, signal),
    enabled: Boolean(meeting),
  });

  const items = shots.data ?? [];

  return (
    <Dialog open={Boolean(meeting)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Screenshots during “{meeting?.title}”</DialogTitle>
          <DialogDescription>
            Existing captures taken by the desktop agent while the meeting was
            recorded. No new screenshots are triggered by this review.
          </DialogDescription>
        </DialogHeader>
        {shots.isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading screenshots…</p>
        ) : shots.isError ? (
          <p className="py-10 text-center text-sm text-destructive">
            Could not load screenshots for this meeting.
          </p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No screenshots were captured during this meeting’s time range.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((shot) => (
              <a
                key={shot.id}
                href={shot.fullUrl}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-md border"
                title="Open full screenshot"
              >
                <img
                  src={shot.thumbnailUrl}
                  alt={`Screenshot at ${formatClock(shot.capturedAt)}`}
                  className="h-32 w-full object-cover transition group-hover:opacity-90"
                  loading="lazy"
                />
                <div className="flex items-center justify-between px-2 py-1 text-[11px] text-muted-foreground">
                  <span>{formatClock(shot.capturedAt)}</span>
                  {shot.displayName && <span className="truncate">{shot.displayName}</span>}
                </div>
              </a>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
