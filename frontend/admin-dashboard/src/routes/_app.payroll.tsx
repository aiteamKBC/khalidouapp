import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Clock3,
  Download,
  FileSpreadsheet,
  Filter,
  Lock,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import {
  listEmployees,
  getWorkProfile,
  updateWorkProfile,
  type WorkProfileInput,
} from "@/api/employees";
import {
  addPayrollAdjustment,
  createScheduleOverride,
  downloadPayroll,
  getPayrollEntry,
  getPayrollExceptions,
  getPayrollSheet,
  removePayrollAdjustment,
  updatePayrollEntry,
  updatePayrollRunStatus,
  type PayrollEntry,
  type PayrollEntryUpdate,
} from "@/api/payroll";
import { useAuth } from "@/lib/auth";
import { formatMinutes } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/payroll")({ component: PayrollPage });

const currentMonth = new Date().toISOString().slice(0, 7);

function PayrollPage() {
  const { scopedTeamIds, can } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth);
  const [tab, setTab] = useState<"sheet" | "exceptions">("sheet");
  const [team, setTeam] = useState("all");
  const [status, setStatus] = useState("all");
  const [signal, setSignal] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const employees = useQuery({
    queryKey: ["employees", scopedTeamIds()],
    queryFn: () => listEmployees(scopedTeamIds()),
  });
  const filters = useMemo(
    () => ({
      month,
      team: team === "all" ? undefined : team,
      employee_id: employeeId === "all" ? undefined : employeeId,
      status: status === "all" ? undefined : status,
      overtime_eligible: signal === "overtime" ? true : undefined,
      has_lateness: signal === "late" ? true : undefined,
      has_idle: signal === "idle" ? true : undefined,
      has_deductions: signal === "deductions" ? true : undefined,
      has_manual_adjustments: signal === "adjustments" ? true : undefined,
    }),
    [month, team, employeeId, status, signal],
  );
  const sheet = useQuery({
    queryKey: ["payroll-sheet", filters],
    queryFn: () => getPayrollSheet(filters),
    refetchInterval: 60_000,
  });
  const exceptions = useQuery({
    queryKey: ["payroll-exceptions", month],
    queryFn: () => getPayrollExceptions(month),
    enabled: tab === "exceptions",
  });

  const statusMutation = useMutation({
    mutationFn: (next: "draft" | "approved" | "locked" | "paid") =>
      updatePayrollRunStatus(sheet.data!.run.id, next),
    onSuccess: () => {
      toast.success("Payroll status updated");
      void queryClient.invalidateQueries({ queryKey: ["payroll-sheet"] });
    },
    onError: showError,
  });
  const canManage = can("payroll.manage");
  const locked = ["locked", "paid"].includes(sheet.data?.run.status ?? "");
  const currencyTotals = Object.entries(sheet.data?.summary.currencies ?? {});

  return (
    <div className="studio-page-wide space-y-5">
      <PageHeader
        title="Payroll & attendance control"
        description="Review attendance signals, make payroll decisions, then approve and lock the monthly sheet."
        actions={
          <>
            <Button variant="outline" onClick={() => setOverrideOpen(true)} disabled={!canManage}>
              <CalendarClock className="mr-2 h-4 w-4" />
              Schedule override
            </Button>
            <ExportMenu month={month} />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Employees"
          value={sheet.data?.summary.employees ?? 0}
          icon={Users}
          hint="In this payroll"
        />
        <StatCard
          label="Needs review"
          value={sheet.data?.summary.needs_review ?? 0}
          icon={AlertTriangle}
          tone="warning"
          hint="Open decisions"
        />
        <StatCard
          label="Late"
          value={sheet.data?.summary.late_employees ?? 0}
          icon={Clock3}
          tone="destructive"
          hint="After grace period"
        />
        <StatCard
          label="Overtime"
          value={sheet.data?.summary.overtime_employees ?? 0}
          icon={CalendarClock}
          tone="info"
          hint="Recorded, not auto-paid"
        />
        <StatCard
          label="Net payroll"
          value={
            currencyTotals.length === 1
              ? money(currencyTotals[0][1].final, currencyTotals[0][0])
              : `${currencyTotals.length} currencies`
          }
          icon={Banknote}
          tone="success"
          hint={
            currencyTotals.length > 1
              ? currencyTotals.map(([code, totals]) => money(totals.final, code)).join(" · ")
              : "After decisions"
          }
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 lg:grid-cols-[180px_minmax(180px,1fr)_180px_180px_auto]">
            <Field label="Payroll month">
              <Input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </Field>
            <Field label="Employee">
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {(employees.data ?? []).map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Team">
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {(sheet.data?.teams ?? []).map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="needs_review">Needs review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void sheet.refetch()}
                disabled={sheet.isFetching}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${sheet.isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {[
              ["all", "All signals"],
              ["late", "Has lateness"],
              ["idle", "Has idle"],
              ["overtime", "Overtime eligible"],
              ["deductions", "Has deductions"],
              ["adjustments", "Manual adjustments"],
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={signal === value ? "default" : "outline"}
                onClick={() => setSignal(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border bg-card p-1 shadow-sm">
          <Button
            size="sm"
            variant={tab === "sheet" ? "default" : "ghost"}
            onClick={() => setTab("sheet")}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Payroll sheet
          </Button>
          <Button
            size="sm"
            variant={tab === "exceptions" ? "default" : "ghost"}
            onClick={() => setTab("exceptions")}
          >
            <AlertTriangle className="mr-2 h-4 w-4" />
            Attendance exceptions
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Run:</span>
          {sheet.data?.run.status && <StatusBadge status={sheet.data.run.status as never} />}
          {canManage && sheet.data && (
            <RunActions
              status={sheet.data.run.status}
              pending={statusMutation.isPending}
              onChange={(value) => statusMutation.mutate(value)}
            />
          )}
        </div>
      </div>

      {tab === "sheet" ? (
        <PayrollTable
          entries={sheet.data?.entries ?? []}
          loading={sheet.isLoading}
          onOpen={setSelectedEntryId}
        />
      ) : (
        <ExceptionsView
          data={exceptions.data ?? {}}
          loading={exceptions.isLoading}
          onOpen={setSelectedEntryId}
        />
      )}

      <PayrollReviewSheet
        entryId={selectedEntryId}
        open={Boolean(selectedEntryId)}
        onOpenChange={(open) => !open && setSelectedEntryId(null)}
        canManage={canManage && !locked}
        month={month}
      />
      <ScheduleOverrideDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        employees={employees.data ?? []}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ["payroll-sheet"] })}
      />
    </div>
  );
}

function PayrollTable({
  entries,
  loading,
  onOpen,
}: {
  entries: PayrollEntry[];
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20 py-4">
        <CardTitle className="text-base">Monthly payroll sheet</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 min-w-[210px] bg-card">Employee</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Worked</TableHead>
              <TableHead>Leave / absent</TableHead>
              <TableHead>Normal</TableHead>
              <TableHead>Payable</TableHead>
              <TableHead>Manual</TableHead>
              <TableHead>Breaks</TableHead>
              <TableHead>Idle</TableHead>
              <TableHead>Late</TableHead>
              <TableHead>Early leave</TableHead>
              <TableHead>Overtime</TableHead>
              <TableHead>Base</TableHead>
              <TableHead>Deductions</TableHead>
              <TableHead>Bonuses</TableHead>
              <TableHead>Final</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={18} className="h-40 text-center text-muted-foreground">
                  Calculating payroll…
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={18} className="h-40 text-center text-muted-foreground">
                  No employees match these filters.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="sticky left-0 z-10 bg-card">
                    <div className="font-semibold">{entry.employee_name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {entry.team || "No team"} · {entry.job_title || "No job title"}
                    </div>
                  </TableCell>
                  <TimeCell
                    seconds={entry.expected_seconds}
                    note={`${entry.expected_work_days} scheduled days`}
                  />
                  <TimeCell
                    seconds={entry.worked_seconds}
                    note={`${entry.worked_days} worked days`}
                  />
                  <TableCell className="whitespace-nowrap">
                    <div className="font-semibold">{entry.leave_days} leave</div>
                    <div
                      className={
                        entry.absence_days
                          ? "text-xs text-destructive"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      {entry.absence_days} absent
                    </div>
                  </TableCell>
                  <TimeCell seconds={entry.normal_seconds} />
                  <TimeCell seconds={entry.total_payable_seconds} />
                  <TimeCell
                    seconds={entry.approved_manual_seconds}
                    note={
                      entry.pending_manual_seconds
                        ? `${shortTime(entry.pending_manual_seconds)} pending`
                        : undefined
                    }
                    warning={entry.pending_manual_seconds > 0}
                  />
                  <TimeCell
                    seconds={entry.paid_break_seconds}
                    note={`${shortTime(entry.unpaid_break_seconds)} unpaid`}
                  />
                  <TimeCell seconds={entry.idle_seconds} warning={entry.idle_seconds > 0} />
                  <TableCell
                    className={
                      entry.late_minutes
                        ? "font-semibold text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    <div>{entry.late_minutes}m deductible</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {entry.raw_late_minutes}m raw
                    </div>
                  </TableCell>
                  <TableCell
                    className={
                      entry.early_leave_minutes
                        ? "font-semibold text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {entry.early_leave_minutes}m
                  </TableCell>
                  <TimeCell
                    seconds={entry.recorded_overtime_seconds}
                    note={entry.overtime_eligible ? "Eligible" : "Recorded only"}
                    warning={
                      entry.recorded_overtime_seconds > 0 && entry.overtime_decision === "pending"
                    }
                  />
                  <TableCell className="whitespace-nowrap font-medium">
                    {money(entry.base_salary, entry.currency)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-semibold text-destructive">
                    -{money(entry.total_deductions, entry.currency)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-semibold text-success">
                    +{money(entry.total_bonuses + entry.overtime_amount, entry.currency)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-base font-extrabold">
                    {money(entry.final_salary, entry.currency)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={entry.status as never} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => onOpen(entry.id)}>
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PayrollReviewSheet({
  entryId,
  open,
  onOpenChange,
  canManage,
  month,
}: {
  entryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  month: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PayrollEntryUpdate>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["payroll-entry", entryId],
    queryFn: () => getPayrollEntry(entryId!),
    enabled: Boolean(entryId),
  });
  useEffect(() => {
    if (!detail.data) return;
    const entry = detail.data;
    setForm({
      deduct_lateness: entry.deduct_lateness,
      lateness_deduction_amount: entry.lateness_deduction_amount,
      lateness_note: entry.lateness_note,
      deduct_idle: entry.deduct_idle,
      idle_deduction_amount: entry.idle_deduction_amount,
      idle_note: entry.idle_note,
      deduct_unpaid_breaks: entry.deduct_unpaid_breaks,
      unpaid_break_deduction_amount: entry.unpaid_break_deduction_amount,
      unpaid_break_note: entry.unpaid_break_note,
      overtime_decision: entry.overtime_decision,
      overtime_multiplier: entry.overtime_multiplier,
      custom_overtime_amount: entry.custom_overtime_amount,
      overtime_note: entry.overtime_note,
      bonus_amount: entry.bonus_amount,
      additional_deduction_amount: entry.additional_deduction_amount,
      adjustment_note: entry.adjustment_note,
      status: entry.status === "locked" || entry.status === "paid" ? "approved" : entry.status,
    });
  }, [detail.data]);
  const save = useMutation({
    mutationFn: () => updatePayrollEntry(entryId!, form),
    onSuccess: () => {
      toast.success("Payroll decision saved");
      void queryClient.invalidateQueries({ queryKey: ["payroll-sheet"] });
      void queryClient.invalidateQueries({ queryKey: ["payroll-entry", entryId] });
    },
    onError: showError,
  });
  const entry = detail.data;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader className="border-b pb-4">
          <SheetTitle>{entry?.employee_name ?? "Payroll review"}</SheetTitle>
          <SheetDescription>
            {entry
              ? `${entry.team || "No team"} · ${entry.job_title || "No job title"} · ${month}`
              : "Loading calculation…"}
          </SheetDescription>
        </SheetHeader>
        {entry && (
          <div className="space-y-5 py-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniMetric label="Base salary" value={money(entry.base_salary, entry.currency)} />
              <MiniMetric label="Worked" value={shortTime(entry.worked_seconds)} />
              <MiniMetric
                label="Deductions"
                value={money(entry.total_deductions, entry.currency)}
                tone="danger"
              />
              <MiniMetric
                label="Final salary"
                value={money(entry.final_salary, entry.currency)}
                tone="success"
              />
            </div>
            <Section
              title="Attendance evidence"
              description="Raw attendance stays visible; nothing is deducted automatically."
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniMetric label="Expected" value={shortTime(entry.expected_seconds)} />
                <MiniMetric label="Idle" value={shortTime(entry.idle_seconds)} />
                <MiniMetric label="Late" value={`${entry.late_minutes}m`} />
                <MiniMetric label="Absent" value={`${entry.absence_days} days`} />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniMetric
                  label="Manual approved"
                  value={shortTime(entry.approved_manual_seconds)}
                />
                <MiniMetric
                  label="Manual pending"
                  value={shortTime(entry.pending_manual_seconds)}
                />
                <MiniMetric label="Paid breaks" value={shortTime(entry.paid_break_seconds)} />
                <MiniMetric label="Unpaid breaks" value={shortTime(entry.unpaid_break_seconds)} />
              </div>
            </Section>
            <DecisionBlock
              title="Lateness decision"
              checked={form.deduct_lateness === true}
              disabled={!canManage}
              onChecked={(checked) => setForm({ ...form, deduct_lateness: checked })}
              amount={Number(form.lateness_deduction_amount ?? 0)}
              onAmount={(value) => setForm({ ...form, lateness_deduction_amount: value })}
              note={form.lateness_note ?? ""}
              onNote={(value) => setForm({ ...form, lateness_note: value })}
              currency={entry.currency}
            />
            <DecisionBlock
              title="Idle decision"
              checked={form.deduct_idle === true}
              disabled={!canManage}
              onChecked={(checked) => setForm({ ...form, deduct_idle: checked })}
              amount={Number(form.idle_deduction_amount ?? 0)}
              onAmount={(value) => setForm({ ...form, idle_deduction_amount: value })}
              note={form.idle_note ?? ""}
              onNote={(value) => setForm({ ...form, idle_note: value })}
              currency={entry.currency}
            />
            <DecisionBlock
              title="Unpaid break decision"
              checked={form.deduct_unpaid_breaks === true}
              disabled={!canManage}
              onChecked={(checked) => setForm({ ...form, deduct_unpaid_breaks: checked })}
              amount={Number(form.unpaid_break_deduction_amount ?? 0)}
              onAmount={(value) => setForm({ ...form, unpaid_break_deduction_amount: value })}
              note={form.unpaid_break_note ?? ""}
              onNote={(value) => setForm({ ...form, unpaid_break_note: value })}
              currency={entry.currency}
            />
            <Section
              title="Overtime decision"
              description={`${shortTime(entry.recorded_overtime_seconds)} recorded · ${entry.overtime_eligible ? "Employee is eligible" : "Employee is not eligible by default"}`}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Decision">
                  <Select
                    value={form.overtime_decision ?? "pending"}
                    disabled={!canManage}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        overtime_decision: value as PayrollEntry["overtime_decision"],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending review</SelectItem>
                      <SelectItem value="paid">Pay overtime</SelectItem>
                      <SelectItem value="rejected">Reject overtime</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Multiplier">
                  <Select
                    value={String(form.overtime_multiplier ?? 1)}
                    disabled={!canManage || form.overtime_decision !== "paid"}
                    onValueChange={(value) =>
                      setForm({ ...form, overtime_multiplier: Number(value) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 1.25, 1.5, 2].map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value}x
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={`Custom amount (${entry.currency})`}>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!canManage || form.overtime_decision !== "paid"}
                    value={form.custom_overtime_amount ?? ""}
                    placeholder="Auto calculate"
                    onChange={(event) =>
                      setForm({
                        ...form,
                        custom_overtime_amount:
                          event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Decision note (required when paid or rejected)">
                <Textarea
                  disabled={!canManage}
                  value={form.overtime_note ?? ""}
                  onChange={(event) => setForm({ ...form, overtime_note: event.target.value })}
                />
              </Field>
            </Section>
            <Section
              title="Bonus & manual deduction"
              description="Direct monthly corrections. Any deduction requires a reason."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={`Bonus (${entry.currency})`}>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!canManage}
                    value={form.bonus_amount ?? 0}
                    onChange={(event) =>
                      setForm({ ...form, bonus_amount: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label={`Manual deduction (${entry.currency})`}>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!canManage}
                    value={form.additional_deduction_amount ?? 0}
                    onChange={(event) =>
                      setForm({ ...form, additional_deduction_amount: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>
              <Field label="Reason / payroll note">
                <Textarea
                  disabled={!canManage}
                  value={form.adjustment_note ?? ""}
                  onChange={(event) => setForm({ ...form, adjustment_note: event.target.value })}
                />
              </Field>
            </Section>
            <Section
              title="Row review status"
              description="Mark this employee reviewed after all attendance and payroll decisions are complete."
            >
              <Field label="Status">
                <Select
                  value={form.status ?? "draft"}
                  disabled={!canManage}
                  onValueChange={(value) =>
                    setForm({ ...form, status: value as "draft" | "needs_review" | "approved" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="needs_review">Needs review</SelectItem>
                    <SelectItem value="approved">Reviewed & approved</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </Section>
            <Section
              title="Calculation breakdown"
              description="The exact components behind the final salary."
            >
              <CalculationGrid entry={entry} />
            </Section>
            <Section
              title="Manual adjustments"
              description="Audited bonus, deduction, correction, unpaid leave, or exception entries."
            >
              <div className="space-y-2">
                {(entry.adjustments ?? []).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div>
                      <div className="text-sm font-semibold capitalize">
                        {item.type.replaceAll("_", " ")} · {money(item.amount, entry.currency)}
                      </div>
                      <div className="text-xs text-muted-foreground">{item.reason}</div>
                    </div>
                    {canManage && <RemoveAdjustmentButton id={item.id} entryId={entry.id} />}
                  </div>
                ))}
                {(entry.adjustments ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No extra adjustments.</p>
                )}
              </div>
              {canManage && (
                <Button variant="outline" onClick={() => setAdjustmentOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add adjustment
                </Button>
              )}
            </Section>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setProfileOpen(true)}>
                <Settings2 className="mr-2 h-4 w-4" />
                Employee payroll profile
              </Button>
            </div>
          </div>
        )}
        <SheetFooter className="sticky bottom-0 border-t bg-card py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canManage && (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save decisions"}
            </Button>
          )}
        </SheetFooter>
        {entry && (
          <EmployeeProfileDialog
            employeeId={entry.employee_id}
            open={profileOpen}
            onOpenChange={setProfileOpen}
          />
        )}
        {entry && (
          <AdjustmentDialog entry={entry} open={adjustmentOpen} onOpenChange={setAdjustmentOpen} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DecisionBlock({
  title,
  checked,
  disabled,
  onChecked,
  amount,
  onAmount,
  note,
  onNote,
  currency,
}: {
  title: string;
  checked: boolean;
  disabled: boolean;
  onChecked: (value: boolean) => void;
  amount: number;
  onAmount: (value: number) => void;
  note: string;
  onNote: (value: string) => void;
  currency: string;
}) {
  return (
    <Section
      title={title}
      description="Shown for review. Enable only if it should reduce this payroll."
    >
      <label className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3 text-sm font-semibold">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onChecked(value === true)}
        />
        Apply deduction
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Deduction amount (${currency})`}>
          <Input
            type="number"
            min="0"
            step="0.01"
            disabled={disabled || !checked}
            value={amount}
            onChange={(event) => onAmount(Number(event.target.value))}
          />
        </Field>
        <Field label="Reason (required when deducted)">
          <Input
            disabled={disabled || !checked}
            value={note}
            onChange={(event) => onNote(event.target.value)}
          />
        </Field>
      </div>
    </Section>
  );
}

function EmployeeProfileDialog({
  employeeId,
  open,
  onOpenChange,
}: {
  employeeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ["employee-work-profile", employeeId],
    queryFn: () => getWorkProfile(employeeId),
    enabled: open,
  });
  const [form, setForm] = useState<WorkProfileInput>({});
  useEffect(() => {
    if (profile.data)
      setForm({
        shiftStart: profile.data.shiftStart ?? "09:00",
        shiftEnd: profile.data.shiftEnd ?? "17:00",
        workingDays: profile.data.workingDays ?? undefined,
        weeklyOffDays: profile.data.weeklyOffDays ?? undefined,
        requiredDailyMinutes: profile.data.requiredDailyMinutes ?? undefined,
        breakRules: profile.data.breakRules,
        lateGraceMinutes: profile.data.lateGraceMinutes ?? undefined,
        deductionPolicy: profile.data.deductionPolicy,
        overtimeEnabled: profile.data.overtimeEnabled,
        overtimeBasis: profile.data.overtimeBasis ?? "outside_shift",
        overtimeRateMultiplier: profile.data.overtimeRateMultiplier ?? 1.5,
        salaryAmount: profile.data.salaryAmount ?? 0,
        salaryCurrency: profile.data.salaryCurrency ?? "EGP",
        salaryType: profile.data.salaryType,
      });
  }, [profile.data]);
  const save = useMutation({
    mutationFn: () => updateWorkProfile(employeeId, form),
    onSuccess: () => {
      toast.success("Employee payroll profile saved");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["payroll-sheet"] });
    },
    onError: showError,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Employee payroll profile</DialogTitle>
          <DialogDescription>
            Salary, shift, lateness grace, and overtime eligibility used for future calculations.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Salary type">
            <Select
              value={form.salaryType ?? "monthly"}
              onValueChange={(value) =>
                setForm({ ...form, salaryType: value as "monthly" | "hourly" })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Salary / hourly rate">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.salaryAmount ?? 0}
              onChange={(event) => setForm({ ...form, salaryAmount: Number(event.target.value) })}
            />
          </Field>
          <Field label="Currency">
            <Select
              value={form.salaryCurrency ?? "EGP"}
              onValueChange={(value) =>
                setForm({ ...form, salaryCurrency: value as WorkProfileInput["salaryCurrency"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["EGP", "GBP", "USD", "EUR", "SAR", "AED"].map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Late grace minutes">
            <Input
              type="number"
              min="0"
              value={form.lateGraceMinutes ?? 15}
              onChange={(event) =>
                setForm({ ...form, lateGraceMinutes: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Shift start">
            <Input
              type="time"
              value={form.shiftStart ?? ""}
              onChange={(event) => setForm({ ...form, shiftStart: event.target.value })}
            />
          </Field>
          <Field label="Shift end">
            <Input
              type="time"
              value={form.shiftEnd ?? ""}
              onChange={(event) => setForm({ ...form, shiftEnd: event.target.value })}
            />
          </Field>
          <label className="flex items-center gap-3 rounded-xl border p-4 sm:col-span-2">
            <Checkbox
              checked={form.overtimeEnabled === true}
              onCheckedChange={(value) => setForm({ ...form, overtimeEnabled: value === true })}
            />
            <span>
              <span className="block text-sm font-semibold">Overtime eligible</span>
              <span className="text-xs text-muted-foreground">
                Overtime is always recorded; this sets the employee default eligibility.
              </span>
            </span>
          </label>
          <Field label="Default multiplier">
            <Input
              type="number"
              min="0"
              step="0.25"
              disabled={!form.overtimeEnabled}
              value={form.overtimeRateMultiplier ?? 1.5}
              onChange={(event) =>
                setForm({ ...form, overtimeRateMultiplier: Number(event.target.value) })
              }
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleOverrideDialog({
  open,
  onOpenChange,
  employees,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Awaited<ReturnType<typeof listEmployees>>;
  onSaved: () => void;
}) {
  const [scope, setScope] = useState<"employee" | "employees" | "company">("employee");
  const [employeeId, setEmployeeId] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [type, setType] = useState<"shift" | "breaks" | "both">("shift");
  const [permanent, setPermanent] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [breaks, setBreaks] = useState([
    { name: "Lunch", start_time: "13:00", end_time: "13:30", paid: true },
    { name: "Short break", start_time: "15:30", end_time: "15:45", paid: true },
  ]);
  const [reason, setReason] = useState("");
  const breakRules = breaks.map((item) => ({
    ...item,
    minutes: minutesBetween(item.start_time, item.end_time),
  }));
  const invalidBreak = breakRules.some((item) => item.minutes <= 0);
  const save = useMutation({
    mutationFn: () =>
      createScheduleOverride({
        scope,
        employee_id: scope === "employee" ? employeeId : undefined,
        employee_ids: scope === "employees" ? employeeIds : undefined,
        override_type: type,
        permanent,
        effective_date: permanent ? undefined : effectiveDate,
        shift_start: type !== "breaks" ? start : undefined,
        shift_end: type !== "breaks" ? end : undefined,
        break_rules: type !== "shift" ? breakRules : undefined,
        reason,
      }),
    onSuccess: (data) => {
      toast.success(`Override saved for ${data.affected_employees} employee(s)`);
      onOpenChange(false);
      onSaved();
    },
    onError: showError,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Shift & break override</DialogTitle>
          <DialogDescription>
            Apply a one-day exception or update the permanent employee/company schedule.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Scope">
            <Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">One employee</SelectItem>
                <SelectItem value="employees">Selected employees</SelectItem>
                <SelectItem value="company">All employees</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="What changes">
            <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shift">Shift only</SelectItem>
                <SelectItem value="breaks">Breaks only</SelectItem>
                <SelectItem value="both">Shift and breaks</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {scope === "employee" && (
            <Field label="Employee">
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {scope === "employees" && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Employees</Label>
              <div className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
                {employees.map((employee) => (
                  <label
                    key={employee.id}
                    className="flex items-center gap-2 rounded-lg p-2 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={employeeIds.includes(employee.id)}
                      onCheckedChange={(checked) =>
                        setEmployeeIds((current) =>
                          checked === true
                            ? [...new Set([...current, employee.id])]
                            : current.filter((id) => id !== employee.id),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{employee.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {employee.email}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{employeeIds.length} selected</p>
            </div>
          )}
          <label className="flex items-center gap-3 rounded-lg border p-3">
            <Checkbox
              checked={permanent}
              onCheckedChange={(value) => setPermanent(value === true)}
            />
            <span>
              <span className="block text-sm font-semibold">Permanent change</span>
              <span className="text-xs text-muted-foreground">
                Otherwise this applies to one day only.
              </span>
            </span>
          </label>
          {!permanent && (
            <Field label="Date">
              <Input
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </Field>
          )}
          {type !== "breaks" && (
            <>
              <Field label="Shift start">
                <Input
                  type="time"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </Field>
              <Field label="Shift end">
                <Input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
              </Field>
            </>
          )}
          {type !== "shift" && (
            <div className="space-y-3 sm:col-span-2">
              <Label>Breaks</Label>
              {breaks.map((item, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_130px_130px_auto]"
                >
                  <Input
                    value={item.name}
                    onChange={(event) =>
                      setBreaks(
                        breaks.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, name: event.target.value } : row,
                        ),
                      )
                    }
                  />
                  <Input
                    type="time"
                    value={item.start_time}
                    onChange={(event) =>
                      setBreaks(
                        breaks.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, start_time: event.target.value } : row,
                        ),
                      )
                    }
                  />
                  <Input
                    type="time"
                    value={item.end_time}
                    onChange={(event) =>
                      setBreaks(
                        breaks.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, end_time: event.target.value } : row,
                        ),
                      )
                    }
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={item.paid}
                      onCheckedChange={(value) =>
                        setBreaks(
                          breaks.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, paid: value === true } : row,
                          ),
                        )
                      }
                    />
                    Paid
                  </label>
                </div>
              ))}
            </div>
          )}
          <div className="sm:col-span-2">
            <Field label="Reason (required)">
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={
              save.isPending ||
              !reason.trim() ||
              (scope === "employee" && !employeeId) ||
              (scope === "employees" && employeeIds.length === 0) ||
              (type !== "shift" && invalidBreak)
            }
          >
            {save.isPending ? "Saving…" : "Apply override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: PayrollEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState("bonus");
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => addPayrollAdjustment(entry.id, { adjustment_type: type, amount, reason }),
    onSuccess: () => {
      toast.success("Adjustment added");
      onOpenChange(false);
      setAmount(0);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["payroll-entry", entry.id] });
      void queryClient.invalidateQueries({ queryKey: ["payroll-sheet"] });
    },
    onError: showError,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add manual adjustment</DialogTitle>
          <DialogDescription>
            Every adjustment is saved with its author, time, amount, and reason.
          </DialogDescription>
        </DialogHeader>
        <Field label="Type">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                "bonus",
                "deduction",
                "late_deduction",
                "idle_deduction",
                "overtime_exception",
                "salary_correction",
                "unpaid_leave",
                "other",
              ].map((item) => (
                <SelectItem key={item} value={item}>
                  {item.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={`Amount (${entry.currency})`}>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
        </Field>
        <Field label="Reason">
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || amount <= 0 || reason.trim().length < 3}
            onClick={() => save.mutate()}
          >
            Add adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveAdjustmentButton({ id, entryId }: { id: string; entryId: string }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removePayrollAdjustment(id),
    onSuccess: () => {
      toast.success("Adjustment removed");
      void queryClient.invalidateQueries({ queryKey: ["payroll-entry", entryId] });
      void queryClient.invalidateQueries({ queryKey: ["payroll-sheet"] });
    },
    onError: showError,
  });
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-destructive"
      disabled={remove.isPending}
      onClick={() => remove.mutate()}
    >
      Remove
    </Button>
  );
}

function ExceptionsView({
  data,
  loading,
  onOpen,
}: {
  data: Record<string, PayrollEntry[]>;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  const labels: Record<string, string> = {
    late: "Late employees",
    high_idle: "High idle time",
    missing_work: "Missing work",
    missing_breaks: "Missing breaks",
    overtime: "Overtime recorded",
    pending_manual: "Pending manual time",
    pending_holiday: "Pending holiday requests",
    pending_permission: "Pending permission requests",
  };
  if (loading)
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          Loading attendance exceptions…
        </CardContent>
      </Card>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Object.entries(labels).map(([key, label]) => (
        <Card key={key}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">{label}</CardTitle>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
              {data[key]?.length ?? 0}
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data[key] ?? []).slice(0, 8).map((entry) => (
              <button
                key={entry.id}
                className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition hover:bg-muted/50"
                onClick={() => onOpen(entry.id)}
              >
                <div>
                  <div className="text-sm font-semibold">{entry.employee_name}</div>
                  <div className="text-xs text-muted-foreground">{entry.team || "No team"}</div>
                </div>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            ))}
            {(data[key]?.length ?? 0) === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No exceptions</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RunActions({
  status,
  pending,
  onChange,
}: {
  status: string;
  pending: boolean;
  onChange: (value: "draft" | "approved" | "locked" | "paid") => void;
}) {
  if (status === "paid")
    return <span className="text-sm font-semibold text-success">Paid and closed</span>;
  if (status === "locked")
    return (
      <>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onChange("draft")}>
          <Lock className="mr-2 h-4 w-4" />
          Unlock
        </Button>
        <Button size="sm" disabled={pending} onClick={() => onChange("paid")}>
          <Banknote className="mr-2 h-4 w-4" />
          Mark paid
        </Button>
      </>
    );
  if (status === "approved")
    return (
      <Button size="sm" disabled={pending} onClick={() => onChange("locked")}>
        <Lock className="mr-2 h-4 w-4" />
        Lock payroll
      </Button>
    );
  return (
    <Button size="sm" disabled={pending} onClick={() => onChange("approved")}>
      <ShieldCheck className="mr-2 h-4 w-4" />
      Approve payroll
    </Button>
  );
}

function ExportMenu({ month }: { month: string }) {
  const [pending, setPending] = useState(false);
  const run = async (format: "csv" | "excel" | "pdf") => {
    setPending(true);
    try {
      await downloadPayroll(month, format);
      toast.success(`${format.toUpperCase()} export downloaded`);
    } catch (error) {
      showError(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Select
      disabled={pending}
      onValueChange={(value) => void run(value as "csv" | "excel" | "pdf")}
    >
      <SelectTrigger className="w-[150px]">
        <Download className="mr-2 h-4 w-4" />
        <SelectValue placeholder={pending ? "Exporting…" : "Export"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="excel">Excel</SelectItem>
        <SelectItem value="csv">CSV</SelectItem>
        <SelectItem value="pdf">PDF</SelectItem>
      </SelectContent>
    </Select>
  );
}

function CalculationGrid({ entry }: { entry: PayrollEntry }) {
  const rows = [
    ["Base salary", money(entry.base_salary, entry.currency)],
    ["Hourly rate", money(entry.hourly_rate, entry.currency)],
    ["Expected hours", shortTime(entry.expected_seconds)],
    ["Worked hours", shortTime(entry.worked_seconds)],
    ["Normal payable hours", shortTime(entry.normal_seconds)],
    ["Total payable hours", shortTime(entry.total_payable_seconds)],
    ["Scheduled / worked days", `${entry.expected_work_days} / ${entry.worked_days}`],
    ["Leave / absence days", `${entry.leave_days} / ${entry.absence_days}`],
    ["Paid breaks", shortTime(entry.paid_break_seconds)],
    ["Unpaid breaks", shortTime(entry.unpaid_break_seconds)],
    ["Lateness raw / deductible", `${entry.raw_late_minutes}m / ${entry.late_minutes}m`],
    ["Early leave", `${entry.early_leave_minutes}m`],
    ["Idle time", shortTime(entry.idle_seconds)],
    ["Manual approved", shortTime(entry.approved_manual_seconds)],
    ["Overtime recorded", shortTime(entry.recorded_overtime_seconds)],
    ["Overtime approved", shortTime(entry.approved_overtime_seconds)],
    ["Overtime paid", money(entry.overtime_amount, entry.currency)],
    ["Deductions", money(entry.total_deductions, entry.currency)],
    ["Bonuses", money(entry.total_bonuses, entry.currency)],
    ["Final salary", money(entry.final_salary, entry.currency)],
  ];
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between bg-card px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-semibold">{value}</span>
        </div>
      ))}
    </div>
  );
}
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-extrabold">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
function MiniMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success";
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono-numeric text-lg font-extrabold ${tone === "danger" ? "text-destructive" : tone === "success" ? "text-success" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
function TimeCell({
  seconds,
  note,
  warning,
}: {
  seconds: number;
  note?: string;
  warning?: boolean;
}) {
  return (
    <TableCell className={warning ? "text-warning-foreground" : ""}>
      <div className="whitespace-nowrap font-mono-numeric font-semibold">{shortTime(seconds)}</div>
      {note && (
        <div className="mt-0.5 whitespace-nowrap text-[10px] text-muted-foreground">{note}</div>
      )}
    </TableCell>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function shortTime(seconds: number) {
  return formatMinutes(Math.round(seconds / 60));
}
function minutesBetween(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return endHour * 60 + endMinute - startHour * 60 - startMinute;
}
function money(value: number, currency: string) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value) + ` ${currency}`;
}
function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Something went wrong");
}
