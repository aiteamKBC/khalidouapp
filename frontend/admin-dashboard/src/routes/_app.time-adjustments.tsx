import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
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
import { listEmployees } from "@/api/employees";
import { listTeams } from "@/api/teams";
import { listTimeAdjustmentRequests, reviewTimeAdjustmentRequest } from "@/api/timeAdjustments";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { formatDate, formatDateTime, formatMinutes } from "@/lib/format";
import { toast } from "sonner";
import type { TimeAdjustmentStatus } from "@/types";

export const Route = createFileRoute("/_app/time-adjustments")({
  component: TimeAdjustmentsPage,
});

function TimeAdjustmentsPage() {
  const { can, scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const queryClient = useQueryClient();
  const [teamId, setTeamId] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [status, setStatus] = useState<TimeAdjustmentStatus | "all">("pending");

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
  });

  const canReview = can(permissions.timeRequestsManage);
  const visibleEmployees =
    teamId === "all"
      ? (employees.data ?? [])
      : (employees.data ?? []).filter((employee) => employee.teamIds.includes(teamId));

  return (
    <div className="studio-page">
      <PageHeader
        title="Time Requests"
        description="Review employee requests for approved manual time adjustments."
      />

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            value={teamId}
            onValueChange={(value) => {
              setTeamId(value);
              setEmployeeId("all");
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
          <Select value={employeeId} onValueChange={setEmployeeId}>
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
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reviewed</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(requests.data ?? []).map((request) => (
              <TableRow key={request.id}>
                <TableCell className="font-medium">{request.employeeName}</TableCell>
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
                        loading={reviewMutation.isPending}
                        disabled={reviewMutation.isPending}
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
                        loading={reviewMutation.isPending}
                        disabled={reviewMutation.isPending}
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
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
