import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Monitor,
  TimerReset,
  Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ProtectedImage } from "@/components/ProtectedImage";
import { useAuth } from "@/lib/auth";
import { getDashboardSummary } from "@/api/dashboard";
import { listEmployees } from "@/api/employees";
import { listScreenshots } from "@/api/screenshots";
import { listTimesheets } from "@/api/timesheets";
import { listTeams } from "@/api/teams";
import { listDevices } from "@/api/devices";
import { listTimeAdjustmentRequests } from "@/api/timeAdjustments";
import { formatMinutes } from "@/lib/format";
import type { Employee, Screenshot, Timesheet } from "@/types";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

// ---------- date helpers ----------
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function weekDates(monday: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return isoDate(d);
  });
}
function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type DayAgg = {
  active: number;
  idle: number;
  adjustment: number;
  total: number;
  members: Set<string>;
};

function aggregateByDate(rows: Timesheet[]): Map<string, DayAgg> {
  const map = new Map<string, DayAgg>();
  for (const t of rows) {
    const e = map.get(t.date) ?? {
      active: 0,
      idle: 0,
      adjustment: 0,
      total: 0,
      members: new Set<string>(),
    };
    e.active += t.activeMinutes;
    e.idle += t.idleMinutes;
    e.adjustment += t.adjustmentMinutes;
    e.total += t.totalMinutes;
    if (t.totalMinutes > 0 || t.activeMinutes > 0) e.members.add(t.employeeId);
    map.set(t.date, e);
  }
  return map;
}

function periodTotals(byDate: Map<string, DayAgg>, dates: string[]) {
  const members = new Set<string>();
  let active = 0,
    idle = 0,
    adjustment = 0,
    total = 0;
  for (const date of dates) {
    const e = byDate.get(date);
    if (!e) continue;
    active += e.active;
    idle += e.idle;
    adjustment += e.adjustment;
    total += e.total;
    e.members.forEach((m) => members.add(m));
  }
  const activityPct = active + idle > 0 ? Math.round((active / (active + idle)) * 100) : 0;
  return { active, idle, adjustment, total, members: members.size, activityPct };
}

function DashboardPage() {
  const [activityFilter, setActivityFilter] = useState<"all" | Employee["status"]>("all");
  const { scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();

  const summary = useQuery({
    queryKey: ["dashboard", scope],
    queryFn: () => getDashboardSummary(scope),
  });
  const emps = useQuery({ queryKey: ["employees", scope], queryFn: () => listEmployees(scope) });
  const shots = useQuery({
    queryKey: ["screenshots", scope],
    queryFn: () => listScreenshots(scope),
  });
  const month = useQuery({
    queryKey: ["timesheets", "monthly", scope],
    queryFn: () => listTimesheets(scope, "monthly"),
  });
  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });
  const devices = useQuery({ queryKey: ["devices", scope], queryFn: () => listDevices(scope) });
  const requests = useQuery({
    queryKey: ["time-adjustments", scope, "pending"],
    queryFn: () => listTimeAdjustmentRequests({ scopedTeamIds: scope, status: "pending" }),
  });

  const now = new Date();
  const thisMonday = startOfWeek(now);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const thisWeek = weekDates(thisMonday);
  const lastWeek = weekDates(lastMonday);
  const sunday = new Date(thisMonday);
  sunday.setDate(thisMonday.getDate() + 6);

  const byDate = aggregateByDate(month.data ?? []);
  const week = periodTotals(byDate, thisWeek);
  const prev = periodTotals(byDate, lastWeek);

  // Daily series for sparklines
  const series = thisWeek.map((date) => {
    const e = byDate.get(date);
    const active = e?.active ?? 0;
    const idle = e?.idle ?? 0;
    return {
      day: new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: "short" }),
      activity: active + idle > 0 ? Math.round((active / (active + idle)) * 100) : 0,
      hours: (e?.total ?? 0) / 60,
      activeHours: active / 60,
      idleHours: idle / 60,
      members: e?.members.size ?? 0,
    };
  });

  // Per-employee weekly activity (for top / low performers)
  const weekSet = new Set(thisWeek);
  const empWeek = new Map<string, { active: number; idle: number }>();
  for (const t of month.data ?? []) {
    if (!weekSet.has(t.date)) continue;
    const e = empWeek.get(t.employeeId) ?? { active: 0, idle: 0 };
    e.active += t.activeMinutes;
    e.idle += t.idleMinutes;
    empWeek.set(t.employeeId, e);
  }
  const nameById = new Map((emps.data ?? []).map((e) => [e.id, e]));
  const ranked = [...empWeek.entries()]
    .map(([id, v]) => ({
      employee: nameById.get(id),
      pct: v.active + v.idle > 0 ? Math.round((v.active / (v.active + v.idle)) * 100) : 0,
    }))
    .filter((r) => r.employee)
    .sort((a, b) => b.pct - a.pct);
  const topMembers = ranked.slice(0, 3);
  const lowMembers = [...ranked].reverse().slice(0, 3);

  // Work-time classification (this week)
  const manual = week.adjustment;
  const activeWork = Math.max(0, week.active - manual);
  const idle = week.idle;
  const classified = [
    { label: "Active work", minutes: activeWork, className: "bg-success" },
    { label: "Idle", minutes: idle, className: "bg-slate-400" },
    { label: "Manual (approved)", minutes: manual, className: "bg-info" },
  ];
  const classifiedTotal = Math.max(1, activeWork + idle + manual);

  // Recent activity grouped by employee
  const byEmployee = new Map<string, Screenshot[]>();
  for (const shot of shots.data ?? []) {
    byEmployee.set(shot.employeeId, [...(byEmployee.get(shot.employeeId) ?? []), shot]);
  }
  const recentActivity = [...byEmployee.entries()]
    .map(([id, list]) => ({
      employee: nameById.get(id),
      shots: [...list]
        .sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt))
        .slice(0, 3),
      latest: Math.max(...list.map((s) => +new Date(s.capturedAt))),
    }))
    .filter((r) => r.employee)
    .sort((a, b) => b.latest - a.latest)
    .slice(0, 4);
  const filteredActivity = recentActivity.filter(
    ({ employee }) => activityFilter === "all" || employee?.status === activityFilter,
  );

  const online = (emps.data ?? [])
    .filter((e) => e.status !== "offline")
    .sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1));

  const dateRange = `${fmtDay(thisMonday)} – ${fmtDay(sunday)}`;
  const loading = month.isLoading || summary.isLoading;
  const offlineDevices = (devices.data ?? []).filter((device) => device.status === "offline");
  const inactiveToday = (emps.data ?? []).filter(
    (employee) => employee.status === "offline" && employee.workedTodayMinutes === 0,
  );
  const teamsWithoutOwner = (teams.data ?? []).filter(
    (team) => team.status === "active" && team.ownerIds.length === 0,
  );
  const attentionCount =
    (requests.data?.length ?? 0) + inactiveToday.length + teamsWithoutOwner.length;
  const hasDataError =
    summary.isError ||
    emps.isError ||
    month.isError ||
    teams.isError ||
    devices.isError ||
    requests.isError;

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Dashboard"
        description={dateRange}
        actions={
          <Button
            asChild
            className="rounded-[10px] bg-gradient-to-br from-[#e5185d] to-[#c40e4c] shadow-[0_8px_18px_-8px_#e5185d] hover:brightness-105"
          >
            <Link to="/reports">
              Open reports <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <QuickSignal
          to="/time-adjustments"
          value={attentionCount}
          label={attentionCount ? "Need attention" : "All healthy"}
          sublabel="Live summary"
          icon={attentionCount ? AlertTriangle : CheckCircle2}
          tone={attentionCount ? "warning" : "success"}
        />
        <QuickSignal
          to="/time-adjustments"
          value={requests.data?.length ?? 0}
          label="Time requests"
          sublabel="Pending review"
          icon={TimerReset}
          tone="info"
        />
        <QuickSignal
          to="/employees"
          value={inactiveToday.length}
          label="Not started"
          sublabel="Today"
          icon={Users}
          tone="muted"
        />
        <QuickSignal
          to="/devices"
          value={offlineDevices.length}
          label="Devices offline"
          sublabel={`of ${devices.data?.length ?? 0} devices`}
          icon={Monitor}
          tone="danger"
        />
        <QuickSignal
          to="/teams"
          value={teamsWithoutOwner.length}
          label="Teams unowned"
          sublabel="Assign an owner"
          icon={AlertTriangle}
          tone="warning"
        />
      </div>

      {hasDataError && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div>
              <p className="text-sm font-medium">Some dashboard data couldn't be loaded</p>
              <p className="text-xs text-muted-foreground">
                Visible figures may be incomplete until the connection recovers.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              summary.refetch();
              emps.refetch();
              month.refetch();
              teams.refetch();
              devices.refetch();
              requests.refetch();
            }}
          >
            Retry all
          </Button>
        </div>
      )}

      {/* Hero metrics */}
      <div className="grid gap-3 md:grid-cols-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)
        ) : (
          <>
            <HeroCard
              to="/reports"
              label="Weekly activity"
              value={`${week.activityPct}%`}
              icon={Activity}
              color="var(--success)"
              gradientId="spark-activity"
              series={series.map((s) => s.activity)}
              trend={<Trend delta={week.activityPct - prev.activityPct} suffix="%" />}
            />
            <HeroCard
              to="/timesheets"
              label="Worked this week"
              value={formatMinutes(week.total)}
              icon={Clock}
              color="var(--primary)"
              gradientId="spark-worked"
              series={series.map((s) => s.hours)}
              trend={<Trend delta={week.total - prev.total} formatter={formatSignedMinutes} />}
            />
            <HeroCard
              to="/employees"
              label="Members worked"
              value={week.members}
              icon={Users}
              color="var(--info)"
              gradientId="spark-members"
              series={series.map((s) => s.members)}
              trend={<Trend delta={week.members - prev.members} />}
            />
          </>
        )}
      </div>

      {import.meta.env.VITE_SHOW_EXTENDED_DASHBOARD === "true" && (
        <div>
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Weekly work trend</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Active and idle hours across the current week
                </p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/timesheets">
                  Details <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 10, right: 8, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="active-work-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="idle-work-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.24} />
                        <stop offset="100%" stopColor="var(--warning)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="day"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                      }}
                      formatter={(value: number) => [`${value.toFixed(1)}h`]}
                    />
                    <Area
                      type="monotone"
                      dataKey="activeHours"
                      name="Active"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      fill="url(#active-work-fill)"
                    />
                    <Area
                      type="monotone"
                      dataKey="idleHours"
                      name="Idle"
                      stroke="var(--warning)"
                      strokeWidth={2}
                      fill="url(#idle-work-fill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Teams today</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Live coverage by team</p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/teams">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {!teams.isLoading && !teams.isError && (teams.data ?? []).length === 0 && (
                <div className="rounded-xl border border-dashed p-6 text-center">
                  <p className="text-sm font-medium">No teams yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create a team to compare coverage here.
                  </p>
                  <Button asChild size="sm" className="mt-3">
                    <Link to="/teams">Create team</Link>
                  </Button>
                </div>
              )}
              {(teams.data ?? []).slice(0, 5).map((team) => {
                const members = (emps.data ?? []).filter((employee) =>
                  employee.teamIds.includes(team.id),
                );
                const connected = members.filter(
                  (employee) => employee.status !== "offline",
                ).length;
                return (
                  <Link
                    key={team.id}
                    to="/teams/$teamId"
                    params={{ teamId: team.id }}
                    className="group flex items-center gap-3 rounded-xl border border-transparent p-3 transition hover:border-border hover:bg-muted/50"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                      {initials(team.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{team.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {connected} online of {members.length}
                      </p>
                    </div>
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-success"
                        style={{
                          width: `${members.length ? (connected / members.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent activity + Insights */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1.62fr_1fr]">
        <Card className="studio-card overflow-hidden rounded-2xl shadow-none">
          <CardHeader className="flex-row items-center justify-between space-y-0 p-[18px]">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm font-extrabold">Recent activity</CardTitle>
              <span className="text-[11px] font-bold text-muted-foreground">
                {filteredActivity.length} of {recentActivity.length} members
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["all", "active", "idle", "offline"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActivityFilter(filter)}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-bold capitalize transition ${activityFilter === filter ? "border-[#e5185d] bg-[#fce3ec] text-[#e5185d] dark:bg-[#38142b] dark:text-[#f0538b]" : "bg-card text-muted-foreground hover:border-[#e5185d]/40"}`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-0 border-t p-0">
            {filteredActivity.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">No recent screenshots.</p>
            )}
            {filteredActivity.map(({ employee, shots: images }) => (
              <div
                key={employee!.id}
                className="grid items-center gap-3 border-b border-border px-[18px] py-[15px] last:border-0 md:grid-cols-[150px_minmax(0,1fr)]"
              >
                <Link
                  to="/employees/$employeeId"
                  params={{ employeeId: employee!.id }}
                  className="flex min-w-0 items-center gap-2 rounded-md p-1 transition hover:bg-muted/60"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="text-xs">{initials(employee!.name)}</AvatarFallback>
                  </Avatar>
                  <span className="truncate text-[12.5px] font-bold">{employee!.name}</span>
                  <StatusBadge status={employee!.status} className="ml-auto shrink-0" />
                </Link>
                <div className="grid grid-cols-3 gap-2.5">
                  {images.map((shot) => (
                    <Link
                      key={shot.id}
                      to="/screenshots"
                      className="group overflow-hidden rounded-[9px] ring-1 ring-border transition hover:ring-primary/40 hover:shadow-md"
                    >
                      <ProtectedImage
                        src={shot.thumbnailUrl}
                        alt={`Screenshot from ${employee!.name}`}
                        className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.03]"
                      />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="studio-card rounded-2xl shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-[13.5px] font-extrabold">Work time classification</p>
              <p className="font-mono-numeric mt-1 text-3xl font-extrabold">
                {Math.round((activeWork / classifiedTotal) * 100)}%
                <span className="ml-1 text-sm font-normal text-muted-foreground">active work</span>
              </p>
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted">
                {classified.map((seg) =>
                  seg.minutes > 0 ? (
                    <div
                      key={seg.label}
                      className={seg.className}
                      style={{ width: `${(seg.minutes / classifiedTotal) * 100}%` }}
                      title={`${seg.label}: ${formatMinutes(seg.minutes)}`}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                {classified.map((seg) => (
                  <div key={seg.label} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className={`h-2 w-2 rounded-full ${seg.className}`} />
                      {seg.label}
                    </span>
                    <span className="font-mono-numeric font-bold">
                      {Math.round((seg.minutes / classifiedTotal) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Top activity</p>
                <MemberList items={topMembers} tone="text-success" />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Needs attention</p>
                <MemberList items={lowMembers} tone="text-warning-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Who's online */}
      <Card className="studio-card mt-4 rounded-2xl shadow-none">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Who's online
          </CardTitle>
          {summary.data && (
            <span className="text-xs text-muted-foreground">
              {summary.data.onlineEmployees} online · {summary.data.idleEmployees} idle ·{" "}
              {summary.data.offlineEmployees} offline
            </span>
          )}
        </CardHeader>
        <CardContent>
          {online.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one is currently online.</p>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              {online.map((e) => (
                <OnlineRow key={e.id} employee={e} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QuickSignal({
  to,
  value,
  label,
  sublabel,
  icon: Icon,
  tone,
}: {
  to: "/time-adjustments" | "/employees" | "/devices" | "/teams";
  value: number;
  label: string;
  sublabel: string;
  icon: LucideIcon;
  tone: "warning" | "danger" | "muted" | "info" | "success";
}) {
  const styles = {
    warning: "bg-[#fbf1dd] text-[#c47d0e] dark:bg-[#2c2413] dark:text-[#e0a648]",
    danger: "bg-[#fbe9e9] text-[#dc2626] dark:bg-[#331a1d] dark:text-[#f2626e]",
    muted: "bg-[#efe9f1] text-[#5d5578] dark:bg-[#271d3a] dark:text-[#a79dbb]",
    info: "bg-[#e8eefc] text-[#3b6fe0] dark:bg-[#182543] dark:text-[#6f9bf0]",
    success: "bg-[#e6f6ec] text-[#16a34a] dark:bg-[#123122] dark:text-[#37d17f]",
  }[tone];
  return (
    <Link
      to={to}
      className="studio-card group flex min-w-0 items-start gap-3 rounded-[14px] border bg-card p-3.5 transition hover:-translate-y-0.5 hover:border-[#e5185d]/20"
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[11px] ${styles}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <strong className="font-mono-numeric block text-2xl font-extrabold leading-none">
          {value}
        </strong>
        <span className="mt-1.5 block truncate text-xs font-bold">{label}</span>
        <span className="mt-0.5 block truncate text-[10.5px] font-semibold text-muted-foreground">
          {sublabel}
        </span>
      </span>
    </Link>
  );
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function formatSignedMinutes(delta: number): string {
  const sign = delta >= 0 ? "+" : "-";
  return `${sign}${formatMinutes(Math.abs(delta))}`;
}

function Trend({
  delta,
  suffix = "",
  formatter,
}: {
  delta: number;
  suffix?: string;
  formatter?: (delta: number) => string;
}) {
  const up = delta >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const label = formatter ? formatter(delta) : `${up ? "+" : ""}${delta}${suffix}`;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-success" : "text-destructive"}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function HeroCard({
  to,
  label,
  value,
  icon: Icon,
  color,
  gradientId,
  series,
  trend,
}: {
  to: "/reports" | "/timesheets" | "/employees";
  label: string;
  value: string | number;
  icon: typeof Activity;
  color: string;
  gradientId: string;
  series: number[];
  trend: React.ReactNode;
}) {
  const data = series.map((v, i) => ({ i, v }));
  return (
    <Link
      to={to}
      className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="studio-card h-full rounded-2xl shadow-none transition duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/25">
        <CardContent className="p-[18px]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="font-mono-numeric text-3xl font-extrabold tracking-tight">{value}</p>
              <div className="mt-1">{trend}</div>
            </div>
            <div className="h-10 w-28">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={color}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function MemberList({
  items,
  tone,
}: {
  items: { employee?: Employee; pct: number }[];
  tone: string;
}) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">No data yet.</p>;
  return (
    <ul className="space-y-2">
      {items.map(({ employee, pct }) => (
        <li key={employee!.id}>
          <Link
            to="/employees/$employeeId"
            params={{ employeeId: employee!.id }}
            className="flex items-center gap-2 rounded-md p-1 transition hover:bg-muted"
          >
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold ${tone}`}
            >
              {pct}
            </span>
            <span className="truncate text-xs">{employee!.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function OnlineRow({ employee }: { employee: Employee }) {
  return (
    <Link
      to="/employees/$employeeId"
      params={{ employeeId: employee.id }}
      className="group flex items-center gap-2.5 rounded-full border bg-muted/40 py-1.5 pl-1.5 pr-3.5 transition hover:border-primary/20 hover:bg-muted"
    >
      <Avatar className="h-[30px] w-[30px]">
        <AvatarFallback className="text-xs">{initials(employee.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold">{employee.name}</p>
        <p className="truncate text-[10px] font-semibold text-muted-foreground">
          {formatMinutes(employee.workedTodayMinutes)} today
        </p>
      </div>
    </Link>
  );
}
