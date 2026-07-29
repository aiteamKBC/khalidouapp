import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, X } from "lucide-react";
import { useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listEmployees } from "@/api/employees";
import { listTeams } from "@/api/teams";
import {
  bulkReviewTimeAdjustmentRequests,
  listTimeAdjustmentRequests,
  reviewTimeAdjustmentRequest,
} from "@/api/timeAdjustments";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { formatDate, formatDateTime, formatMinutes } from "@/lib/format";
import { toast } from "sonner";
import type { TimeAdjustmentStatus } from "@/types";

export const Route = createFileRoute("/_app/time-adjustments")({
  component: TimeAdjustmentsPage,
});

const requestTypeLabel: Record<string, string> = {
  idle_time: "Idle time",
  early_leave: "Early leave",
  manual_time: "Manual time",
};

type BulkReviewAction = {
  status: "approved" | "rejected";
  scope: "selected" | "filtered";
  requestIds?: string[];
};

function TimeAdjustmentsPage() {
  const { can, scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const queryClient = useQueryClient();
  const [teamId, setTeamId] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [status, setStatus] = useState<TimeAdjustmentStatus | "all">("pending");
  const [reviewingRequests, setReviewingRequests] = useState<
    Record<string, "approved" | "rejected">
  >({});
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkReviewAction | null>(null);

  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });
  const employees = useQuery({
    queryKey: ["employees", scope],
    queryFn: () => listEmployees(scope),
  });
  const requests = useQuery({
    queryKey: ["time-adjustments", scope, teamId, employeeId, status],
    queryFn: () =>
      listTimeAdjustmentRequests({
        scopedTeamIds: scope,
        teamId,
        employeeId,
        status,
        requestGroup: "time",
      }),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      nextStatus,
      approvedMinutes,
    }: {
      id: string;
      nextStatus: "approved" | "rejected";
      approvedMinutes?: number;
    }) =>
      reviewTimeAdjustmentRequest(id, {
        status: nextStatus,
        approvedMinutes,
      }),
    onMutate: ({ id, nextStatus }) => {
      setReviewingRequests((current) => ({ ...current, [id]: nextStatus }));
    },
    onSuccess: async (_, variables) => {
      toast.success(variables.nextStatus === "approved" ? "Request approved" : "Request rejected");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-adjustments"] }),
        queryClient.invalidateQueries({ queryKey: ["ts"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to review request"),
    onSettled: (_, __, variables) => {
      setReviewingRequests((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
    },
  });

  const bulkReviewMutation = useMutation({
    mutationFn: (action: BulkReviewAction) =>
      bulkReviewTimeAdjustmentRequests({
        status: action.status,
        requestIds: action.scope === "selected" ? action.requestIds : undefined,
        allFiltered: action.scope === "filtered",
        teamId,
        employeeId,
        requestGroup: "time",
      }),
    onSuccess: async (result) => {
      const actionLabel = result.status === "approved" ? "approved" : "rejected";
      toast.success(
        `${result.reviewedCount} ${result.reviewedCount === 1 ? "request" : "requests"} ${actionLabel}`,
      );
      if (result.skippedCount > 0) {
        toast.warning(
          `${result.skippedCount} ${result.skippedCount === 1 ? "request was" : "requests were"} skipped because they were already reviewed, outside your scope, or belonged to your own employee account.`,
        );
      }
      setSelectedRequestIds([]);
      setBulkAction(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-adjustments"] }),
        queryClient.invalidateQueries({ queryKey: ["attendance"] }),
        queryClient.invalidateQueries({ queryKey: ["ts"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to review requests"),
  });

  const canReview = can(permissions.timeRequestsManage);
  const visibleEmployees =
    teamId === "all"
      ? (employees.data ?? [])
      : (employees.data ?? []).filter((employee) => employee.teamIds.includes(teamId));
  const pendingRequests = (requests.data ?? []).filter((request) => request.status === "pending");
  const pendingRequestIds = new Set(pendingRequests.map((request) => request.id));
  const selectedPendingIds = selectedRequestIds.filter((id) => pendingRequestIds.has(id));
  const allVisiblePendingSelected =
    pendingRequests.length > 0 && selectedPendingIds.length === pendingRequests.length;
  const someVisiblePendingSelected = selectedPendingIds.length > 0 && !allVisiblePendingSelected;
  const reviewBusy = bulkReviewMutation.isPending;

  const toggleVisiblePending = (checked: boolean) => {
    setSelectedRequestIds(checked ? pendingRequests.map((request) => request.id) : []);
  };

  const toggleRequest = (requestId: string, checked: boolean) => {
    setSelectedRequestIds((current) =>
      checked
        ? current.includes(requestId)
          ? current
          : [...current, requestId]
        : current.filter((id) => id !== requestId),
    );
  };

  return (
    <div className="studio-page">
      <PageHeader
        title="Time Requests"
        description="Review requests to add missing tracked time or approve explained idle time."
      />

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            value={teamId}
            onValueChange={(value) => {
              setTeamId(value);
              setEmployeeId("all");
              setSelectedRequestIds([]);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {(teams.data ?? []).map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={employeeId}
            onValueChange={(value) => {
              setEmployeeId(value);
              setSelectedRequestIds([]);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {visibleEmployees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as typeof status);
              setSelectedRequestIds([]);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        {canReview && pendingRequests.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div className="text-sm text-muted-foreground">
              {selectedPendingIds.length > 0
                ? `${selectedPendingIds.length} selected`
                : "Select requests to approve or reject together."}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={selectedPendingIds.length === 0 || reviewBusy}
                onClick={() =>
                  setBulkAction({
                    status: "approved",
                    scope: "selected",
                    requestIds: selectedPendingIds,
                  })
                }
              >
                <Check className="mr-1 h-4 w-4" />
                Approve selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selectedPendingIds.length === 0 || reviewBusy}
                onClick={() =>
                  setBulkAction({
                    status: "rejected",
                    scope: "selected",
                    requestIds: selectedPendingIds,
                  })
                }
              >
                <X className="mr-1 h-4 w-4" />
                Reject selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={reviewBusy}
                onClick={() =>
                  setBulkAction({
                    status: "approved",
                    scope: "filtered",
                  })
                }
              >
                <CheckCheck className="mr-1 h-4 w-4" />
                Approve all filtered
              </Button>
            </div>
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                {canReview && pendingRequests.length > 0 ? (
                  <Checkbox
                    aria-label="Select all visible pending requests"
                    checked={
                      allVisiblePendingSelected
                        ? true
                        : someVisiblePendingSelected
                          ? "indeterminate"
                          : false
                    }
                    disabled={reviewBusy}
                    onCheckedChange={(checked) => toggleVisiblePending(checked === true)}
                  />
                ) : null}
              </TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reviewed</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(requests.data ?? []).map((request) => {
              const reviewingStatus = reviewingRequests[request.id];
              return (
                <TableRow key={request.id}>
                  <TableCell>
                    {canReview && request.status === "pending" ? (
                      <Checkbox
                        aria-label={`Select ${request.employeeName}'s request`}
                        checked={selectedPendingIds.includes(request.id)}
                        disabled={reviewBusy || Boolean(reviewingStatus)}
                        onCheckedChange={(checked) => toggleRequest(request.id, checked === true)}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell className="font-medium">{request.employeeName}</TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {requestTypeLabel[request.requestType ?? "manual_time"] ?? "Manual time"}
                    </div>
                    {request.sourceStartAt && request.sourceEndAt ? (
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(request.sourceStartAt)} →{" "}
                        {formatDateTime(request.sourceEndAt)}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatDate(request.requestedDate)}</TableCell>
                  <TableCell>{formatMinutes(request.requestedMinutes)}</TableCell>
                  <TableCell className="max-w-md text-sm text-muted-foreground">
                    {request.reason}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={request.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {request.reviewedAt
                      ? `${request.reviewedByName ?? "Admin"} at ${formatDateTime(request.reviewedAt)}`
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canReview && request.status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          loading={reviewingStatus === "approved"}
                          disabled={reviewBusy || Boolean(reviewingStatus)}
                          onClick={() =>
                            reviewMutation.mutate({
                              id: request.id,
                              nextStatus: "approved",
                              approvedMinutes: request.requestedMinutes,
                            })
                          }
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          loading={reviewingStatus === "rejected"}
                          disabled={reviewBusy || Boolean(reviewingStatus)}
                          onClick={() =>
                            reviewMutation.mutate({ id: request.id, nextStatus: "rejected" })
                          }
                        >
                          <X className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open && !bulkReviewMutation.isPending) setBulkAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction?.status === "approved" ? "Approve requests?" : "Reject requests?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAction?.scope === "filtered"
                ? "This will approve every pending time request matching the current team and employee filters, including results not currently visible in the table."
                : `This will ${bulkAction?.status === "approved" ? "approve" : "reject"} ${bulkAction?.requestIds?.length ?? 0} selected request${bulkAction?.requestIds?.length === 1 ? "" : "s"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkReviewMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!bulkAction || bulkReviewMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (bulkAction) bulkReviewMutation.mutate(bulkAction);
              }}
            >
              {bulkReviewMutation.isPending
                ? "Reviewing..."
                : bulkAction?.status === "approved"
                  ? "Approve"
                  : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
