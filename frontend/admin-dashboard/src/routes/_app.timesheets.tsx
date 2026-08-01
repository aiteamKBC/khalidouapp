import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Activity, AlertTriangle, Camera, Clock3, Coffee, Download, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { listTimesheetEmployeeOptions, listTimesheets } from "@/api/timesheets";
import { listTeams } from "@/api/teams";
import { retryTransientRequest } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { downloadCSV, formatClock, formatMinutes, formatRelative } from "@/lib/format";
import { paginateRows } from "@/lib/timesheet-pagination";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/_app/timesheets")({
  component: TimesheetsPage,
});

function TimesheetsPage() {
  const { scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const [view, setView] = useState<"daily" | "weekly" | "monthly">("daily");
  const [date, setDate] = useState(todayDateValue);
  const [teamId, setTeamId] = useState("all");
  const [empId, setEmpId] = useState("all");
  const [page, setPage] = useState(0);
  const perPage = 50;
  const isCurrentPeriod = selectedPeriodIncludesToday(view, date);

  const emps = useQuery({
    queryKey: ["timesheetEmployeeOptions", scope, teamId],
    queryFn: ({ signal }) => listTimesheetEmployeeOptions(scope, teamId, signal),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (previous) => previous,
    retry: retryTransientRequest,
  });
  const teams = useQuery({
    queryKey: ["teams", scope],
    queryFn: ({ signal }) => listTeams(scope, signal),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: retryTransientRequest,
  });

  const ts = useQuery({
    queryKey: ["ts", scope, view, date, teamId],
    queryFn: ({ signal }) => listTimesheets(scope, view, date, teamId, signal),
    placeholderData: (previous) => previous,
    staleTime: isCurrentPeriod ? 30_000 : 5 * 60_000,
    refetchInterval: isCurrentPeriod ? 60_000 : false,
    refetchIntervalInBackground: false,
    retry: retryTransientRequest,
  });

  const filtered = useMemo(
    () =>
      (ts.data ?? []).filter((t) => {
        if (teamId !== "all" && t.teamId !== teamId) return false;
        if (empId !== "all" && t.employeeId !== empId) return false;
        return true;
      }),
    [ts.data, teamId, empId],
  );

  const pagination = useMemo(() => paginateRows(filtered, page, perPage), [filtered, page]);
  const employeeNameById = useMemo(
    () => new Map((emps.data ?? []).map((employee) => [employee.id, employee.name])),
    [emps.data],
  );
  const teamNameById = useMemo(
    () => new Map((teams.data ?? []).map((team) => [team.id, team.name])),
    [teams.data],
  );
  const totals = useMemo(
    () =>
      filtered.reduce(
        (sum, row) => ({
          total: sum.total + row.totalMinutes,
          active: sum.active + row.activeMinutes,
          idle: sum.idle + row.idleMinutes,
          screenshots: sum.screenshots + row.screenshotCount,
        }),
        { total: 0, active: 0, idle: 0, screenshots: 0 },
      ),
    [filtered],
  );
  const empName = (id: string, fallback?: string) => fallback ?? employeeNameById.get(id) ?? id;
  const teamName = (id: string) => (id ? (teamNameById.get(id) ?? id) : "Unassigned");

  return (
    <div className="studio-page">
      <PageHeader
        title="Timesheets"
        description="Daily and weekly time-tracked records per employee."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              downloadCSV(
                "timesheets.csv",
                filtered.map((t) => ({
                  date: t.date,
                  employee: empName(t.employeeId, t.employeeName),
                  team: teamName(t.teamId),
                  total_minutes: t.totalMinutes,
                  active_minutes: t.activeMinutes,
                  idle_minutes: t.idleMinutes,
                  manual_adjustment_minutes: t.adjustmentMinutes,
                  deleted_screenshot_minutes: t.deductedMinutes,
                  points: t.points,
                  screenshots: t.screenshotCount,
                  status: t.status,
                })),
              )
            }
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        }
      />

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tabs
            value={view}
            onValueChange={(v) => {
              setView(v as "daily" | "weekly" | "monthly");
              setPage(0);
            }}
          >
            <TabsList>
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="weekly">Weekly</TabsTrigger>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(0);
            }}
          />
          <Select
            value={teamId}
            onValueChange={(value) => {
              setTeamId(value);
              setEmpId("all");
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {(teams.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={empId}
            onValueChange={(value) => {
              setEmpId(value);
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {(emps.data ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              setDate(todayDateValue());
              setTeamId("all");
              setEmpId("all");
              setPage(0);
            }}
          >
            Reset
          </Button>
        </div>
        {(teams.isError || emps.isError) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
            <span className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Some filter options could not be loaded.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (teams.isError) void teams.refetch();
                if (emps.isError) void emps.refetch();
              }}
            >
              Retry filters
            </Button>
          </div>
        )}
        {(teams.isFetching || emps.isFetching) && !teams.isPending && !emps.isPending && (
          <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Refreshing filter options…
          </p>
        )}
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TimesheetMetric icon={Clock3} label="Tracked time" value={formatMinutes(totals.total)} />
        <TimesheetMetric
          icon={Activity}
          label="Active"
          value={formatMinutes(totals.active)}
          tone="green"
        />
        <TimesheetMetric
          icon={Coffee}
          label="Idle"
          value={formatMinutes(totals.idle)}
          tone="amber"
        />
        <TimesheetMetric icon={Camera} label="Screenshots" value={totals.screenshots} />
      </div>

      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="text-sm font-extrabold">
            {filtered.length} {filtered.length === 1 ? "record" : "records"}
          </p>
          {ts.isFetching && !ts.isPending && (
            <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Updating timesheets…
            </span>
          )}
        </div>
        {ts.isError && ts.data && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
            <span>Latest refresh failed. Previously loaded records are still shown.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void ts.refetch()}>
              Retry
            </Button>
          </div>
        )}
        <div className="divide-y divide-border">
          {ts.isPending ? (
            Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="p-4">
                <div className="h-16 animate-pulse rounded-2xl bg-muted" />
              </div>
            ))
          ) : ts.isError && !ts.data ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-sm font-extrabold">Timesheets could not be loaded</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Check the connection and try this section again.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => void ts.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            pagination.rows.map((t) => {
              const activePct = t.totalMinutes
                ? Math.round((t.activeMinutes / t.totalMinutes) * 100)
                : 0;
              const idlePct = t.totalMinutes
                ? Math.round((t.idleMinutes / t.totalMinutes) * 100)
                : 0;
              return (
                <div
                  key={t.id}
                  className="grid gap-4 p-4 transition hover:bg-muted/40 lg:grid-cols-[minmax(0,1.25fr)_minmax(260px,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">
                      {empName(t.employeeId, t.employeeName)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {teamName(t.teamId)} · {t.date}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.status === "missing" ? (
                        "No time recorded"
                      ) : (
                        <>
                          First start {formatClock(t.startTime)} ·{" "}
                          {t.endTime ? `Last end ${formatClock(t.endTime)}` : "Open session"}
                          {t.sessionCount > 1 ? ` · ${t.sessionCount} separate sessions` : ""}
                        </>
                      )}
                    </p>
                    {t.status === "in_progress" && t.lastSignalAt && (
                      <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                        Last device sync {formatRelative(t.lastSignalAt)}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-bold text-muted-foreground">Tracked time mix</span>
                      <span className="font-mono-numeric font-extrabold">
                        {formatMinutes(t.totalMinutes)}
                      </span>
                    </div>
                    <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                      <span
                        className="bg-success"
                        style={{ width: `${Math.max(0, activePct)}%` }}
                      />
                      <span className="bg-warning" style={{ width: `${Math.max(0, idlePct)}%` }} />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                      <span>Active {formatMinutes(t.activeMinutes)}</span>
                      <span>Idle {formatMinutes(t.idleMinutes)}</span>
                      <span>Manual {formatMinutes(t.adjustmentMinutes)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
                      {t.screenshotCount} shots
                    </span>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
                      {t.points.toFixed(2)} pts
                    </span>
                    <StatusBadge status={t.status} />
                  </div>
                </div>
              );
            })
          )}
          {!ts.isPending && !ts.isError && pagination.rows.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No timesheets match these filters.
            </div>
          )}
        </div>
        {!ts.isPending && !ts.isError && filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Showing {pagination.start + 1}–{pagination.end} of {filtered.length} records · Page{" "}
              {pagination.page + 1} of {pagination.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page === 0}
                onClick={() => setPage(pagination.page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page + 1 >= pagination.totalPages}
                onClick={() => setPage(pagination.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function todayDateValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function selectedPeriodIncludesToday(view: "daily" | "weekly" | "monthly", selectedDate: string) {
  const selected = parseLocalDate(selectedDate);
  const today = parseLocalDate(todayDateValue());
  if (!selected || !today) return false;

  if (view === "monthly") {
    return (
      selected.getFullYear() === today.getFullYear() && selected.getMonth() === today.getMonth()
    );
  }
  if (view === "weekly") {
    return startOfLocalWeek(selected).getTime() === startOfLocalWeek(today).getTime();
  }
  return selected.getTime() === today.getTime();
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function startOfLocalWeek(value: Date) {
  const start = new Date(value);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  start.setHours(0, 0, 0, 0);
  return start;
}

function TimesheetMetric({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone?: "default" | "green" | "amber";
}) {
  const toneClass = {
    default: "bg-primary/10 text-primary",
    green: "bg-success/10 text-success",
    amber: "bg-warning/20 text-warning-foreground",
  }[tone];

  return (
    <Card className="p-5">
      <div className="flex min-h-[96px] flex-col items-center justify-center gap-3 text-center">
        <span className={`grid h-11 w-11 place-items-center rounded-2xl ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="font-mono-numeric text-3xl font-extrabold leading-none">{value}</p>
          <p className="mt-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
        </div>
      </div>
    </Card>
  );
}
