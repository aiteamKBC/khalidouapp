import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listLeaveBalanceOverview,
  listLeaveRequests,
  recordManualLeave,
  reviewLeaveRequest,
} from "@/api/leaveRequests";
import { listTimeAdjustmentRequests, reviewTimeAdjustmentRequest } from "@/api/timeAdjustments";
import { listEmployees } from "@/api/employees";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { formatDate, formatDateTime, formatMinutes } from "@/lib/format";
import type { TimeAdjustmentStatus } from "@/types";

export const Route = createFileRoute("/_app/holiday-requests")({
  component: HolidayRequestsPage,
});

function HolidayRequestsPage() {
  const [status, setStatus] = useState("pending");
  const [earlyLeaveStatus, setEarlyLeaveStatus] = useState<TimeAdjustmentStatus | "all">("pending");
  const [balanceYear, setBalanceYear] = useState(new Date().getFullYear());
  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const { can, scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: ["leave-requests", status],
    queryFn: () => listLeaveRequests(status),
  });
  const earlyLeaveRequests = useQuery({
    queryKey: ["early-leave-requests", scope, earlyLeaveStatus],
    queryFn: () =>
      listTimeAdjustmentRequests({
        scopedTeamIds: scope,
        status: earlyLeaveStatus,
        requestGroup: "early_leave",
      }),
  });
  const balances = useQuery({
    queryKey: ["leave-balances", scope, balanceYear],
    queryFn: () => listLeaveBalanceOverview(balanceYear),
  });
  const employees = useQuery({
    queryKey: ["employees", scope],
    queryFn: () => listEmployees(scope),
  });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" }) =>
      reviewLeaveRequest(id, decision),
    onSuccess: async (_, { decision }) => {
      toast.success(decision === "approved" ? "Holiday approved" : "Holiday rejected");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["leave-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["leave-balances"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Review failed"),
  });
  const canReview = can(permissions.leaveRequestsManage);
  const reviewEarlyLeave = useMutation({
    mutationFn: ({
      id,
      decision,
      requestedMinutes,
    }: {
      id: string;
      decision: "approved" | "rejected";
      requestedMinutes: number;
    }) =>
      reviewTimeAdjustmentRequest(id, {
        status: decision,
        approvedMinutes: decision === "approved" ? requestedMinutes : undefined,
      }),
    onSuccess: async (_, { decision }) => {
      toast.success(decision === "approved" ? "Early leave approved" : "Early leave rejected");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["early-leave-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["time-adjustments"] }),
        queryClient.invalidateQueries({ queryKey: ["ts"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Early leave review failed"),
  });
  const manualLeave = useMutation({
    mutationFn: () =>
      recordManualLeave({
        employeeId,
        startDate,
        endDate,
        leaveType: "annual",
        reason: reason || undefined,
      }),
    onSuccess: async () => {
      toast.success("Offline holiday recorded and deducted from the employee balance");
      setStartDate("");
      setEndDate("");
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["leave-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["leave-balances"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to record holiday"),
  });

  return (
    <div className="studio-page">
      <PageHeader
        title="Holiday Requests"
        description="Annual leave balances, holiday requests, and early-leave approvals in one place."
      />

      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h3 className="font-extrabold">Leave balance by employee</h3>
            <p className="text-sm text-muted-foreground">
              Annual allowance, used days, remaining days, and every approved leave date.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="leave-balance-year">Year</Label>
            <Input
              id="leave-balance-year"
              className="w-28"
              type="number"
              min={2000}
              max={2200}
              value={balanceYear}
              onChange={(event) => setBalanceYear(Number(event.target.value) || balanceYear)}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Start date</TableHead>
                <TableHead>Allowance</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead className="min-w-80">Approved leave dates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(balances.data ?? []).map((balance) => (
                <TableRow key={balance.employeeId}>
                  <TableCell>
                    <div className="font-bold">{balance.employeeName}</div>
                    <div className="text-xs text-muted-foreground">{balance.employeeCode}</div>
                  </TableCell>
                  <TableCell>
                    {balance.startDate ? formatDate(balance.startDate) : "Not set"}
                  </TableCell>
                  <TableCell className="font-mono-numeric font-bold">
                    {balance.creditDays}
                  </TableCell>
                  <TableCell className="font-mono-numeric">{balance.usedDays}</TableCell>
                  <TableCell className="font-mono-numeric font-bold text-success">
                    {balance.remainingDays}
                  </TableCell>
                  <TableCell>
                    {balance.takenDates.length ? (
                      <div className="flex max-w-xl flex-wrap gap-1.5">
                        {balance.takenDates.map((item) => (
                          <span
                            key={`${item.requestId}-${item.date}`}
                            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary"
                            title={`${item.leaveType} leave`}
                          >
                            <CalendarDays className="h-3 w-3" />
                            {formatDate(item.date)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">No approved leave</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!balances.isLoading && (balances.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No employees are available for this year.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {canReview && (
        <Card className="mb-4 p-4">
          <div className="mb-3">
            <h3 className="font-extrabold">Record offline holiday</h3>
            <p className="text-sm text-muted-foreground">
              Use this when an employee took approved leave outside the portal. It is saved as
              approved and deducted from their annual balance.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose employee" />
                </SelectTrigger>
                <SelectContent>
                  {(employees.data ?? []).map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>From</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div>
              <Label>To</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            <div>
              <Label>Reason</Label>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Offline approved leave"
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                loading={manualLeave.isPending}
                disabled={!employeeId || !startDate || !endDate || manualLeave.isPending}
                onClick={() => manualLeave.mutate()}
              >
                {manualLeave.isPending ? "Recording..." : "Record holiday"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h3 className="font-extrabold">Early leave requests</h3>
            <p className="text-sm text-muted-foreground">
              Leaving before shift end is reviewed here and does not deduct annual leave.
            </p>
          </div>
          <Select
            value={earlyLeaveStatus}
            onValueChange={(value) => setEarlyLeaveStatus(value as typeof earlyLeaveStatus)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Requested period</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(earlyLeaveRequests.data ?? []).map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-bold">{request.employeeName}</TableCell>
                  <TableCell>{formatDate(request.requestedDate)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {request.sourceStartAt && request.sourceEndAt
                      ? `${formatDateTime(request.sourceStartAt)} → ${formatDateTime(request.sourceEndAt)}`
                      : "-"}
                  </TableCell>
                  <TableCell>{formatMinutes(request.requestedMinutes)}</TableCell>
                  <TableCell>{request.reason}</TableCell>
                  <TableCell>
                    <StatusBadge status={request.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {canReview && request.status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          loading={reviewEarlyLeave.isPending}
                          disabled={reviewEarlyLeave.isPending}
                          onClick={() =>
                            reviewEarlyLeave.mutate({
                              id: request.id,
                              decision: "approved",
                              requestedMinutes: request.requestedMinutes,
                            })
                          }
                        >
                          <Check className="mr-1 h-4 w-4" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          loading={reviewEarlyLeave.isPending}
                          disabled={reviewEarlyLeave.isPending}
                          onClick={() =>
                            reviewEarlyLeave.mutate({
                              id: request.id,
                              decision: "rejected",
                              requestedMinutes: request.requestedMinutes,
                            })
                          }
                        >
                          <X className="mr-1 h-4 w-4" />
                          Reject
                        </Button>
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!earlyLeaveRequests.isLoading && (earlyLeaveRequests.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No early leave requests match this status.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-extrabold">Holiday requests</h3>
            <p className="text-sm text-muted-foreground">
              Full-day and multi-day annual, sick, or unpaid leave.
            </p>
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All requests</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(requests.data ?? []).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-bold">{row.employeeName}</TableCell>
                <TableCell>
                  {formatDate(row.startDate)} – {formatDate(row.endDate)}
                </TableCell>
                <TableCell>{row.requestedDays}</TableCell>
                <TableCell className="capitalize">{row.leaveType}</TableCell>
                <TableCell>{row.reason || "-"}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-right">
                  {canReview && row.status === "pending" ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        loading={review.isPending}
                        disabled={review.isPending}
                        onClick={() => review.mutate({ id: row.id, decision: "approved" })}
                      >
                        <Check className="mr-1 h-4 w-4" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={review.isPending}
                        disabled={review.isPending}
                        onClick={() => review.mutate({ id: row.id, decision: "rejected" })}
                      >
                        <X className="mr-1 h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                  ) : (
                    "-"
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!requests.isLoading && (requests.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No holiday requests match this status.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
