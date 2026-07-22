import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarClock,
  CalendarDays,
  Clock3,
  Coffee,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import {
  listEmployeeBreakRules,
  updateEmployee,
  updateWorkProfile,
  type EmployeeBreakRules,
  type WorkProfile,
} from "@/api/employees";
import { listTeams } from "@/api/teams";
import {
  createScheduleOverride,
  deleteScheduleOverride,
  listScheduleOverrides,
  type ScheduleOverride,
} from "@/api/payroll";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

export const Route = createFileRoute("/_app/breaks")({ component: BreaksPage });

type BreakRule = NonNullable<WorkProfile["breakRules"]>[number];
type BreakDraft = {
  name: string;
  startTime: string;
  endTime: string;
  paid: boolean;
};
type EditorIntent =
  { kind: "company" } | { kind: "employee"; employeeId: string } | { kind: "day" };

const FALLBACK_BREAKS: BreakDraft[] = [
  { name: "Lunch", startTime: "13:00", endTime: "13:30", paid: true },
  { name: "Short break", startTime: "15:30", endTime: "15:45", paid: true },
];

function todayIso() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function toDrafts(rules?: WorkProfile["breakRules"]): BreakDraft[] {
  if (!rules?.length) return FALLBACK_BREAKS.map((item) => ({ ...item }));
  return rules.map((rule) => ({
    name: rule.name,
    startTime: rule.start_time?.slice(0, 5) || "13:00",
    endTime: rule.end_time?.slice(0, 5) || "13:30",
    paid: rule.paid,
  }));
}

function minutesBetween(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return endHour * 60 + endMinute - startHour * 60 - startMinute;
}

function temporaryScheduleOverride(
  overrides: ScheduleOverride[],
  employeeId: string,
  date: string,
  teamIds: string[],
) {
  const relevant = overrides.filter((item) => item.effective_date === date);
  return (
    relevant.find((item) => item.employee_id === employeeId) ??
    relevant.find((item) => item.team_id && teamIds.includes(item.team_id)) ??
    relevant.find((item) => item.scope === "company")
  );
}

function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function BreaksPage() {
  const { scopedTeamIds, can } = useAuth();
  const queryClient = useQueryClient();
  const scope = scopedTeamIds();
  const canManage = can("payroll.manage");
  const [editor, setEditor] = useState<EditorIntent | null>(null);

  const rows = useQuery({
    queryKey: ["break-profiles", scope],
    queryFn: () => listEmployeeBreakRules(scope),
  });
  const teams = useQuery({
    queryKey: ["teams", scope],
    queryFn: () => listTeams(scope),
  });
  const overrides = useQuery({
    queryKey: ["schedule-overrides", "upcoming"],
    queryFn: () => listScheduleOverrides(true),
    enabled: canManage,
  });
  const cancelOverride = useMutation({
    mutationFn: deleteScheduleOverride,
    onSuccess: async () => {
      toast.success("One-day schedule exception cancelled");
      await queryClient.invalidateQueries({ queryKey: ["schedule-overrides"] });
    },
    onError: showError,
  });

  const people = rows.data ?? [];
  const scheduleOverrides = overrides.data ?? [];
  const paidEmployees = people.filter((person) =>
    person.breakRules?.some((rule) => rule.paid),
  ).length;

  const saved = async () => {
    setEditor(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["break-profiles"] }),
      queryClient.invalidateQueries({ queryKey: ["schedule-overrides"] }),
    ]);
  };

  return (
    <div className="studio-page">
      <PageHeader
        title="Work Schedule & Attendance"
        description="Manage employee shifts, working days, breaks, overtime eligibility, and payroll inputs from one place."
        actions={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => setEditor({ kind: "day" })}>
                <CalendarDays /> One-day exception
              </Button>
              <Button onClick={() => setEditor({ kind: "company" })}>
                <Users /> Set schedule for everyone
              </Button>
            </>
          ) : undefined
        }
      />

      {!rows.isLoading && !rows.isError && people.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <SummaryCard icon={Users} label="Employees in scope" value={String(people.length)} />
          <SummaryCard
            icon={Coffee}
            label="With paid breaks"
            value={`${paidEmployees} of ${people.length}`}
          />
          <SummaryCard
            icon={CalendarDays}
            label="One-day exceptions"
            value={String(scheduleOverrides.length)}
          />
        </div>
      )}

      {canManage && scheduleOverrides.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold">Scheduled one-day exceptions</h2>
              <p className="text-xs text-muted-foreground">
                Normal working hours and breaks return automatically afterward.
              </p>
            </div>
            <RotateCcw className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {scheduleOverrides.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    {item.employee_name || item.team_name || "All employees"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.effective_date} ·{" "}
                    {item.shift_start && item.shift_end
                      ? `${item.shift_start}–${item.shift_end}`
                      : `${item.break_rules?.length ?? 0} break(s)`}{" "}
                    · {item.reason}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={cancelOverride.isPending && cancelOverride.variables === item.id}
                  onClick={() => cancelOverride.mutate(item.id)}
                >
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {rows.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : rows.isError ? (
        <EmptyState
          icon={Coffee}
          title="Schedules couldn't be loaded"
          description="Check the API connection and try again."
          action={<Button onClick={() => rows.refetch()}>Retry</Button>}
        />
      ) : people.length === 0 ? (
        <EmptyState
          icon={Coffee}
          title="No employees in scope"
          description="Work schedules will appear here once employees are assigned to your teams."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {people.map((person) => {
            const activeOverride = temporaryScheduleOverride(
              scheduleOverrides,
              person.employeeId,
              todayIso(),
              (teams.data ?? [])
                .filter((team) => team.employeeIds.includes(person.employeeId))
                .map((team) => team.id),
            );
            const rules = activeOverride?.break_rules ?? person.breakRules ?? [];
            const shiftStart = activeOverride?.shift_start ?? person.shiftStart;
            const shiftEnd = activeOverride?.shift_end ?? person.shiftEnd;
            const scheduledMinutes = minutesBetween(shiftStart, shiftEnd);
            const scheduleSource = activeOverride?.employee_id
              ? "Employee one-day exception"
              : activeOverride?.team_id
                ? "Team one-day exception"
                : activeOverride?.scope === "company"
                  ? "Company one-day exception"
                  : "Employee permanent profile";
            return (
              <Card key={person.employeeId} className="p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <CalendarClock className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-extrabold">{person.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{person.email}</p>
                    </div>
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditor({ kind: "employee", employeeId: person.employeeId })}
                    >
                      <Pencil /> Edit
                    </Button>
                  )}
                </div>
                {activeOverride && (
                  <div className="mb-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/25 dark:text-amber-200">
                    Temporary policy for today · normal policy returns tomorrow
                  </div>
                )}
                <div className="mb-3 grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border bg-primary/[0.035] px-3 py-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Scheduled shift
                    </p>
                    <p className="mt-0.5 font-mono text-lg font-extrabold tabular-nums">
                      {shiftStart}–{shiftEnd}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                      Source: {scheduleSource}
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">
                    {formatMinutes(scheduledMinutes)}
                  </span>
                </div>
                <div className="space-y-2">
                  {rules.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No break rules configured.</p>
                  ) : (
                    rules.map((rule, index) => (
                      <BreakRuleRow key={`${rule.name}-${index}`} rule={rule} />
                    ))
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <BreakEditorDialog
        intent={editor}
        people={people}
        teams={teams.data ?? []}
        onOpenChange={(open) => !open && setEditor(null)}
        onSaved={saved}
      />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Coffee;
  label: string;
  value: string;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-xl font-extrabold">{value}</p>
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function BreakRuleRow({ rule }: { rule: BreakRule }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="truncate font-bold">{rule.name}</p>
        <p className="text-xs text-muted-foreground">
          {rule.start_time?.slice(0, 5) || "—"}–{rule.end_time?.slice(0, 5) || "—"} · {rule.minutes}{" "}
          min
        </p>
      </div>
      <span
        className={
          rule.paid
            ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-extrabold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "rounded-full bg-muted px-2.5 py-1 text-xs font-extrabold text-muted-foreground"
        }
      >
        {rule.paid ? "Paid" : "Unpaid"}
      </span>
    </div>
  );
}

function BreakEditorDialog({
  intent,
  people,
  teams,
  onOpenChange,
  onSaved,
}: {
  intent: EditorIntent | null;
  people: EmployeeBreakRules[];
  teams: Awaited<ReturnType<typeof listTeams>>;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [scope, setScope] = useState<"employee" | "employees" | "team" | "company">("company");
  const [employeeId, setEmployeeId] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [shiftStart, setShiftStart] = useState("09:00");
  const [shiftEnd, setShiftEnd] = useState("17:00");
  const [breaks, setBreaks] = useState<BreakDraft[]>(FALLBACK_BREAKS);
  const [reason, setReason] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [workingDays, setWorkingDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [lateGraceMinutes, setLateGraceMinutes] = useState(15);
  const [overtimeEnabled, setOvertimeEnabled] = useState(false);
  const [overtimeMultiplier, setOvertimeMultiplier] = useState(1.5);
  const [salaryAmount, setSalaryAmount] = useState(0);
  const [salaryCurrency, setSalaryCurrency] = useState("EGP");
  const [salaryType, setSalaryType] = useState<"monthly" | "hourly">("monthly");

  const selectedEmployee = people.find((person) => person.employeeId === employeeId);
  const permanent = intent?.kind !== "day";
  const heading =
    intent?.kind === "company"
      ? "Set schedule for everyone"
      : intent?.kind === "employee"
        ? `Edit ${selectedEmployee?.name || "employee"} schedule`
        : "Schedule a one-day exception";

  useEffect(() => {
    if (!intent) return;
    const nextScope = intent.kind === "employee" ? "employee" : "company";
    const nextEmployeeId = intent.kind === "employee" ? intent.employeeId : "";
    const source = people.find((person) => person.employeeId === nextEmployeeId) ?? people[0];
    setScope(nextScope);
    setEmployeeId(nextEmployeeId);
    setEmployeeIds([]);
    setTeamId("");
    setEffectiveDate(todayIso());
    setShiftStart(source?.shiftStart ?? "09:00");
    setShiftEnd(source?.shiftEnd ?? "17:00");
    setBreaks(toDrafts(source?.breakRules));
    setEmployeeName(source?.name ?? "");
    setJobTitle(source?.jobTitle ?? "");
    setTimezone(source?.timezone ?? "Africa/Cairo");
    setWorkingDays(source?.workingDays ?? [0, 1, 2, 3, 4]);
    setLateGraceMinutes(source?.lateGraceMinutes ?? 15);
    setOvertimeEnabled(source?.overtimeEnabled ?? false);
    setOvertimeMultiplier(source?.overtimeRateMultiplier ?? 1.5);
    setSalaryAmount(source?.salaryAmount ?? 0);
    setSalaryCurrency(source?.salaryCurrency ?? "EGP");
    setSalaryType(source?.salaryType ?? "monthly");
    setReason(
      intent.kind === "company"
        ? "Company work schedule update"
        : intent.kind === "employee"
          ? "Employee work schedule update"
          : "One-day work schedule exception",
    );
  }, [intent, people]);

  const rules = useMemo(
    () =>
      breaks.map((item) => ({
        name: item.name.trim(),
        start_time: item.startTime,
        end_time: item.endTime,
        minutes: minutesBetween(item.startTime, item.endTime),
        paid: item.paid,
      })),
    [breaks],
  );
  const invalid =
    !shiftStart ||
    !shiftEnd ||
    minutesBetween(shiftStart, shiftEnd) <= 0 ||
    rules.length === 0 ||
    rules.some(
      (rule) =>
        !rule.name || rule.minutes <= 0 || rule.start_time < shiftStart || rule.end_time > shiftEnd,
    ) ||
    rules.some(
      (rule, index) =>
        index > 0 &&
        [...rules].sort((a, b) => a.start_time.localeCompare(b.start_time))[index - 1].end_time >
          [...rules].sort((a, b) => a.start_time.localeCompare(b.start_time))[index].start_time,
    ) ||
    !reason.trim() ||
    (scope === "employee" && !employeeId) ||
    (scope === "employees" && employeeIds.length === 0) ||
    (scope === "team" && !teamId) ||
    (!permanent && !effectiveDate);

  const save = useMutation({
    mutationFn: async () => {
      if (permanent && intent?.kind === "employee") {
        await updateEmployee(employeeId, {
          name: employeeName.trim(),
          jobTitle: jobTitle.trim(),
          timezone,
        });
        await updateWorkProfile(employeeId, {
          shiftStart,
          shiftEnd,
          requiredDailyMinutes: minutesBetween(shiftStart, shiftEnd),
          workingDays,
          weeklyOffDays: [0, 1, 2, 3, 4, 5, 6].filter((day) => !workingDays.includes(day)),
          breakRules: rules,
          lateGraceMinutes,
          overtimeEnabled,
          overtimeBasis: "outside_shift",
          overtimeRateMultiplier: overtimeMultiplier,
          salaryAmount,
          salaryCurrency: salaryCurrency as WorkProfile["salaryCurrency"],
          salaryType,
        });
        return { affected_employees: 1 };
      }
      return createScheduleOverride({
        scope,
        employee_id: scope === "employee" ? employeeId : undefined,
        employee_ids: scope === "employees" ? employeeIds : undefined,
        team_id: scope === "team" ? teamId : undefined,
        override_type: "both",
        permanent,
        effective_date: permanent ? undefined : effectiveDate,
        shift_start: shiftStart,
        shift_end: shiftEnd,
        break_rules: rules,
        reason: reason.trim(),
      });
    },
    onSuccess: (data) => {
      toast.success(
        permanent
          ? `Work schedule updated for ${data.affected_employees} employee(s)`
          : `One-day change scheduled for ${data.affected_employees} employee(s)`,
      );
      onSaved();
    },
    onError: showError,
  });

  const chooseEmployee = (value: string) => {
    setEmployeeId(value);
    const employee = people.find((person) => person.employeeId === value);
    if (employee) {
      setShiftStart(employee.shiftStart);
      setShiftEnd(employee.shiftEnd);
      setBreaks(toDrafts(employee.breakRules));
      setEmployeeName(employee.name);
      setJobTitle(employee.jobTitle ?? "");
      setTimezone(employee.timezone);
      setWorkingDays(employee.workingDays);
      setLateGraceMinutes(employee.lateGraceMinutes);
      setOvertimeEnabled(employee.overtimeEnabled);
      setOvertimeMultiplier(employee.overtimeRateMultiplier);
      setSalaryAmount(employee.salaryAmount);
      setSalaryCurrency(employee.salaryCurrency ?? "EGP");
      setSalaryType(employee.salaryType);
    }
  };

  return (
    <Dialog open={Boolean(intent)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>
            {permanent
              ? "This becomes the normal policy until you change it again."
              : "This applies only on the selected date. The normal policy returns automatically afterward."}
          </DialogDescription>
        </DialogHeader>

        {intent?.kind === "day" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Apply to">
              <Select
                value={scope}
                onValueChange={(value) => {
                  const nextScope = value as typeof scope;
                  setScope(nextScope);
                  if (nextScope === "company") {
                    setEmployeeId("");
                    setEmployeeIds([]);
                    setShiftStart(people[0]?.shiftStart ?? "09:00");
                    setShiftEnd(people[0]?.shiftEnd ?? "17:00");
                    setBreaks(toDrafts(people[0]?.breakRules));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">All employees</SelectItem>
                  <SelectItem value="employees">Selected employees</SelectItem>
                  <SelectItem value="team">One team</SelectItem>
                  <SelectItem value="employee">One employee</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date">
              <Input
                type="date"
                min={todayIso()}
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </Field>
            {scope === "employee" && (
              <div className="sm:col-span-2">
                <Field label="Employee">
                  <Select value={employeeId} onValueChange={chooseEmployee}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {people.map((person) => (
                        <SelectItem key={person.employeeId} value={person.employeeId}>
                          {person.name} · {person.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
            {scope === "employees" && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Employees</Label>
                <div className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
                  {people.map((person) => (
                    <label
                      key={person.employeeId}
                      className="flex items-center gap-2 rounded-lg p-2 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={employeeIds.includes(person.employeeId)}
                        onCheckedChange={(checked) =>
                          setEmployeeIds((current) =>
                            checked === true
                              ? [...new Set([...current, person.employeeId])]
                              : current.filter((id) => id !== person.employeeId),
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{person.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {person.email}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{employeeIds.length} selected</p>
              </div>
            )}
            {scope === "team" && (
              <div className="sm:col-span-2">
                <Field label="Team">
                  <Select value={teamId} onValueChange={setTeamId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose team" />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name} · {team.employeeIds.length} employees
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}

        {permanent && intent?.kind === "employee" && (
          <div className="grid gap-3 rounded-2xl border bg-muted/10 p-4 sm:grid-cols-2">
            <Field label="Employee name">
              <Input
                value={employeeName}
                onChange={(event) => setEmployeeName(event.target.value)}
              />
            </Field>
            <Field label="Job title">
              <Input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
            </Field>
            <Field label="Timezone">
              <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            </Field>
            <Field label="Late grace (minutes)">
              <Input
                type="number"
                min="0"
                value={lateGraceMinutes}
                onChange={(event) => setLateGraceMinutes(Number(event.target.value))}
              />
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Working days
              </Label>
              <div className="flex flex-wrap gap-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, day) => (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={workingDays.includes(day) ? "default" : "outline"}
                    onClick={() =>
                      setWorkingDays((current) =>
                        current.includes(day)
                          ? current.filter((item) => item !== day)
                          : [...current, day].sort(),
                      )
                    }
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <Field label="Salary type">
              <Select
                value={salaryType}
                onValueChange={(value) => setSalaryType(value as typeof salaryType)}
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
            <Field label={salaryType === "monthly" ? "Monthly salary" : "Hourly rate"}>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={salaryAmount}
                onChange={(event) => setSalaryAmount(Number(event.target.value))}
              />
            </Field>
            <Field label="Currency">
              <Select value={salaryCurrency} onValueChange={setSalaryCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["EGP", "GBP", "USD", "EUR", "SAR", "AED"].map((currency) => (
                    <SelectItem key={currency} value={currency}>
                      {currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Hourly rate preview">
              <Input
                readOnly
                value={
                  salaryType === "hourly"
                    ? salaryAmount.toFixed(2)
                    : (
                        salaryAmount / Math.max(1, (minutesBetween(shiftStart, shiftEnd) / 60) * 30)
                      ).toFixed(2)
                }
              />
            </Field>
            <label className="flex items-center gap-3 rounded-xl border bg-card p-3 sm:col-span-2">
              <Switch checked={overtimeEnabled} onCheckedChange={setOvertimeEnabled} />
              <span className="flex-1">
                <span className="block text-sm font-bold">Overtime eligible</span>
                <span className="text-xs text-muted-foreground">
                  Extra time is always recorded; payment still requires approval.
                </span>
              </span>
              <Input
                className="w-24"
                type="number"
                min="1"
                step="0.25"
                disabled={!overtimeEnabled}
                value={overtimeMultiplier}
                onChange={(event) => setOvertimeMultiplier(Number(event.target.value))}
              />
            </label>
          </div>
        )}

        <div className="rounded-2xl border bg-muted/10 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-extrabold">Working hours</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                These hours drive lateness, eligible idle time, daily targets, payroll, and
                overtime.
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">
              {minutesBetween(shiftStart, shiftEnd) > 0
                ? formatMinutes(minutesBetween(shiftStart, shiftEnd))
                : "Invalid shift"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Shift starts">
              <Input
                type="time"
                value={shiftStart}
                onChange={(event) => setShiftStart(event.target.value)}
              />
            </Field>
            <Field label="Shift ends">
              <Input
                type="time"
                value={shiftEnd}
                onChange={(event) => setShiftEnd(event.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border bg-muted/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-extrabold">Break schedule</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Every break must stay inside the employee's scheduled shift.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setBreaks((current) => [
                  ...current,
                  { name: "New break", startTime: "14:00", endTime: "14:15", paid: true },
                ])
              }
            >
              <Plus /> Add break
            </Button>
          </div>

          {breaks.map((item, index) => (
            <div
              key={index}
              className="grid items-end gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(150px,1fr)_120px_120px_92px_auto]"
            >
              <Field label="Name">
                <Input
                  value={item.name}
                  onChange={(event) =>
                    setBreaks((current) =>
                      current.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, name: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Starts">
                <Input
                  type="time"
                  value={item.startTime}
                  onChange={(event) =>
                    setBreaks((current) =>
                      current.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, startTime: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Ends">
                <Input
                  type="time"
                  value={item.endTime}
                  onChange={(event) =>
                    setBreaks((current) =>
                      current.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, endTime: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <div className="pb-2">
                <Label className="mb-2 block text-xs">Paid</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={item.paid}
                    onCheckedChange={(paid) =>
                      setBreaks((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, paid } : row,
                        ),
                      )
                    }
                  />
                  <span className="text-xs font-bold">{item.paid ? "Yes" : "No"}</span>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${item.name}`}
                onClick={() => setBreaks((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        <Field label="Reason">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this policy changing?"
          />
        </Field>

        <div className="flex items-start gap-2 rounded-xl border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
          Paid breaks remain inside the scheduled shift. A one-day exception automatically returns
          to the employee's normal schedule on the next day.
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={save.isPending || invalid}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : permanent ? "Save policy" : "Schedule change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Something went wrong");
}
