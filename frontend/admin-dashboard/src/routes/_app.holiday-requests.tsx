import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listLeaveRequests, recordManualLeave, reviewLeaveRequest } from "@/api/leaveRequests";
import { listEmployees } from "@/api/employees";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_app/holiday-requests")({ component: HolidayRequestsPage });

function HolidayRequestsPage() {
  const [status, setStatus] = useState("pending");
  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const { can, scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const queryClient = useQueryClient();
  const requests = useQuery({ queryKey: ["leave-requests", status], queryFn: () => listLeaveRequests(status) });
  const employees = useQuery({ queryKey: ["employees", scope], queryFn: () => listEmployees(scope) });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => reviewLeaveRequest(id, decision),
    onSuccess: async (_, { decision }) => {
      toast.success(decision === "approved" ? "Holiday approved" : "Holiday rejected");
      await queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Review failed"),
  });
  const canReview = can(permissions.leaveRequestsManage);
  const manualLeave = useMutation({
    mutationFn: () => recordManualLeave({ employeeId, startDate, endDate, leaveType: "annual", reason: reason || undefined }),
    onSuccess: async () => {
      toast.success("Offline holiday recorded and deducted from the employee balance");
      setStartDate(""); setEndDate(""); setReason("");
      await queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to record holiday"),
  });
  return <div className="studio-page">
    <PageHeader title="Holiday Requests" description="Holiday credits and employee leave approvals. Only HR and Admin can approve or reject." />
    {canReview && <Card className="mb-4 p-4"><div className="mb-3"><h3 className="font-extrabold">Record offline holiday</h3><p className="text-sm text-muted-foreground">Use this when an employee took approved leave outside the portal. It is saved as approved and deducted from their annual balance.</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><div><Label>Employee</Label><Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger><SelectValue placeholder="Choose employee" /></SelectTrigger><SelectContent>{(employees.data ?? []).map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}</SelectContent></Select></div><div><Label>From</Label><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div><div><Label>To</Label><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div><div><Label>Reason</Label><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Offline approved leave" /></div><div className="flex items-end"><Button className="w-full" disabled={!employeeId || !startDate || !endDate || manualLeave.isPending} onClick={() => manualLeave.mutate()}>{manualLeave.isPending ? "Recording..." : "Record holiday"}</Button></div></div></Card>}
    <Card className="mb-4 p-4"><Select value={status} onValueChange={setStatus}><SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="all">All requests</SelectItem></SelectContent></Select></Card>
    <Card className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Dates</TableHead><TableHead>Days</TableHead><TableHead>Type</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
      {(requests.data ?? []).map((row) => <TableRow key={row.id}><TableCell className="font-bold">{row.employeeName}</TableCell><TableCell>{formatDate(row.startDate)} – {formatDate(row.endDate)}</TableCell><TableCell>{row.requestedDays}</TableCell><TableCell className="capitalize">{row.leaveType}</TableCell><TableCell>{row.reason || "-"}</TableCell><TableCell><StatusBadge status={row.status} /></TableCell><TableCell className="text-right">{canReview && row.status === "pending" ? <div className="flex justify-end gap-2"><Button size="sm" onClick={() => review.mutate({ id: row.id, decision: "approved" })}><Check className="mr-1 h-4 w-4" />Approve</Button><Button size="sm" variant="outline" onClick={() => review.mutate({ id: row.id, decision: "rejected" })}><X className="mr-1 h-4 w-4" />Reject</Button></div> : "-"}</TableCell></TableRow>)}
    </TableBody></Table></Card>
  </div>;
}
