import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MetricTile } from "@/components/ui/metric-tile";
import { StatusBadge } from "@/components/ui/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ProtectedImage } from "@/components/ProtectedImage";
import { SCREENSHOT_REFRESH_INTERVAL_MS } from "@/lib/screenshot-display";
import {
  matchesMemberActivityFilter,
  memberActivitySummary,
  MEMBER_ACTIVITY_FILTERS,
  type MemberActivityFilter,
} from "@/lib/member-activity-status";
import { useAuth } from "@/lib/auth";
import { listDailyAttendance } from "@/api/attendance";
import { listDashboardWorkTrend } from "@/api/dashboard";
import { employeeIsOnline, listMonitoringEmployees } from "@/api/employees";
import { listScreenshotPreviews } from "@/api/screenshots";
import { listTeams } from "@/api/teams";
import { listDevices } from "@/api/devices";
import { listTimeAdjustmentRequests } from "@/api/timeAdjustments";
import { formatMinutes } from "@/lib/format";
import type { Employee, Screenshot, Timesheet } from "@/types";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

const LIVE_REFRESH_MS = 30_000;
const ACTION_REFRESH_MS = 30_000;
const MEDIA_REFRESH_MS = 15 * 60_000;
const employeeNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
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

function compareEmployeesByName(left: Employee, right: Employee): number {
  return employeeNameCollator.compare(left.name, right.name);
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

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function seededEmployeeRank(employeeId: string, seed: number): number {
  let hash = 2166136261 ^ seed;
  for (let index = 0; index < employeeId.length; index += 1) {
    hash ^= employeeId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
  const [activityFilter, setActivityFilter] = useState<MemberActivityFilter>("active");
  const [attentionOpen, setAttentionOpen] = useState(false);
  const activitySectionRef = useRef<HTMLDivElement>(null);
  const [loadMedia, setLoadMedia] = useState(false);
  const [activityRotationSeed, setActivityRotationSeed] = useState(randomSeed);
  const { can, scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const canViewTimeRequests = can("time_requests.view");
  const canViewAttendance = can("timesheets.view");
  const scopeKey = scope?.join(",") ?? "all";
  const dashboardDay = isoDate(new Date());
  const now = new Date();
  const thisMonday = startOfWeek(now);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const thisWeek = weekDates(thisMonday);
  const lastWeek = weekDates(lastMonday);
  const sunday = new Date(thisMonday);
  sunday.setDate(thisMonday.getDate() + 6);
  const trendStart = isoDate(lastMonday);
  const trendEnd = isoDate(sunday);

  const emps = useQuery({
    queryKey: ["dashboard-monitoring-employees", scope],
    queryFn: ({ signal }) => listMonitoringEmployees(scope, signal),
    staleTime: 20_000,
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    placeholderData: (previous) => previous,
    meta: { suppressGlobalLoading: true },
  });
  const trend = useQuery({
    queryKey: ["dashboard-work-trend", scope, trendStart, trendEnd],
    queryFn: ({ signal }) => listDashboardWorkTrend(scope, trendStart, trendEnd, signal),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    meta: { suppressGlobalLoading: true },
  });
  useEffect(() => {
    setLoadMedia(false);
    setActivityRotationSeed(randomSeed());
  }, [scopeKey]);
  useEffect(() => {
    const section = activitySectionRef.current;
    if (!section || loadMedia) return;
    if (typeof IntersectionObserver === "undefined") {
      setLoadMedia(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setLoadMedia(true);
        observer.disconnect();
      },
      { rootMargin: "300px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [loadMedia, scopeKey]);

  // Select six stable rows first, then request only their previews. Fetching the
  // latest screenshots company-wide allowed one busy employee to consume the
  // whole result page and made other rows look empty.
  const matchingActivityEmployees = (emps.data ?? [])
    .filter((employee) => employee.currentDeviceId)
    .filter((employee) => matchesMemberActivityFilter(employee.status, activityFilter))
    .sort(compareEmployeesByName);
  const visibleActivityEmployees = [...matchingActivityEmployees]
    .sort(
      (left, right) =>
        seededEmployeeRank(left.id, activityRotationSeed) -
        seededEmployeeRank(right.id, activityRotationSeed),
    )
    .slice(0, 6);
  const visibleActivityEmployeeIds = visibleActivityEmployees.map((employee) => employee.id);
  const shots = useQuery({
    queryKey: ["screenshot-previews", scope, "dashboard", dashboardDay, visibleActivityEmployeeIds],
    queryFn: ({ signal }) =>
      listScreenshotPreviews(
        {
          employeeIds: visibleActivityEmployeeIds,
          day: dashboardDay,
          limitPerEmployee: 3,
        },
        signal,
      ),
    enabled: loadMedia && visibleActivityEmployeeIds.length > 0,
    staleTime: MEDIA_REFRESH_MS - 15_000,
    refetchInterval: MEDIA_REFRESH_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    meta: { suppressGlobalLoading: true },
  });
  const teams = useQuery({
    queryKey: ["teams", scope],
    queryFn: ({ signal }) => listTeams(scope, signal),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (previous) => previous,
    meta: { suppressGlobalLoading: true },
  });
  const devices = useQuery({
    queryKey: ["devices", scope],
    queryFn: ({ signal }) => listDevices(scope, signal),
    staleTime: LIVE_REFRESH_MS,
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    meta: { suppressGlobalLoading: true },
  });
  const requests = useQuery({
    queryKey: ["time-adjustments", scope, "pending"],
    queryFn: ({ signal }) =>
      listTimeAdjustmentRequests({ scopedTeamIds: scope, status: "pending" }, signal),
    enabled: canViewTimeRequests,
    staleTime: ACTION_REFRESH_MS,
    refetchInterval: ACTION_REFRESH_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    meta: { suppressGlobalLoading: true },
  });
  const todayAttendance = useQuery({
    queryKey: ["daily-attendance", "dashboard", dashboardDay, scope],
    queryFn: ({ signal }) =>
      listDailyAttendance(
        {
          day: dashboardDay,
          teamId: scope?.length === 1 ? scope[0] : undefined,
        },
        signal,
      ),
    enabled: canViewAttendance,
    staleTime: ACTION_REFRESH_MS,
    refetchInterval: ACTION_REFRESH_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    meta: { suppressGlobalLoading: true },
  });

  const byDate = aggregateByDate(trend.data ?? []);
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
  for (const t of trend.data ?? []) {
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
    { label: "Active work", minutes: activeWork, className: "bg-success", color: "#28c879" },
    { label: "Idle", minutes: idle, className: "bg-slate-400", color: "#94a3b8" },
    { label: "Manual (approved)", minutes: manual, className: "bg-info", color: "#60a5fa" },
  ];
  const classifiedTotal = Math.max(1, activeWork + idle + manual);
  const classificationTrend = series.map((day) => ({
    day: day.day,
    activity: day.activity,
    activeHours: day.activeHours,
    idleHours: day.idleHours,
  }));

  // Member activity uses exactly the same six employee IDs for both rendering
  // and the bounded preview request.
  const byEmployee = new Map<string, Screenshot[]>();
  for (const screenshot of shots.data ?? []) {
    const previews = byEmployee.get(screenshot.employeeId) ?? [];
    previews.push(screenshot);
    byEmployee.set(screenshot.employeeId, previews);
  }
  const memberActivity = visibleActivityEmployees
    .map((employee) => {
      const images = [...(byEmployee.get(employee.id) ?? [])]
        .sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt))
        .slice(0, 3);
      return {
        employee,
        shots: images,
        latest: Math.max(
          images[0] ? +new Date(images[0].capturedAt) : 0,
          employee.lastHeartbeat ? +new Date(employee.lastHeartbeat) : 0,
        ),
      };
    })
    .sort((a, b) => b.latest - a.latest);
  const filteredActivity = memberActivity;
  const activitySummary = memberActivitySummary(
    activityFilter,
    matchingActivityEmployees.length,
    filteredActivity.length,
  );

  const online = (emps.data ?? []).filter(employeeIsOnline).sort(compareEmployeesByName);
  const onlinePreview = online.slice(0, 4);
  const hiddenOnlineCount = Math.max(0, online.length - onlinePreview.length);

  const dateRange = `${fmtDay(thisMonday)} - ${fmtDay(sunday)}`;
  const loading = trend.isPending && !trend.data;
  const attentionLoading =
    (canViewTimeRequests && !requests.data && requests.isPending) ||
    (!emps.data && emps.isPending) ||
    (canViewAttendance && !todayAttendance.data && todayAttendance.isPending);
  const activityMediaLoading =
    visibleActivityEmployeeIds.length > 0 && (!loadMedia || (shots.isPending && !shots.data));
  const offlineDevices = (devices.data ?? []).filter((device) => device.status === "offline");
  const lateStarts = (todayAttendance.data ?? []).filter((attendance) => {
    if (
      attendance.status !== "not_started" ||
      !attendance.scheduledStartAt ||
      attendance.actualFirstActivityAt
    ) {
      return false;
    }
    const graceDeadline =
      new Date(attendance.scheduledStartAt).getTime() + attendance.lateGraceMinutes * 60_000;
    return Date.now() > graceDeadline;
  });
  const idleNow = (emps.data ?? []).filter((employee) => employee.status === "idle");
  const teamsWithoutOwner = (teams.data ?? []).filter(
    (team) => team.status === "active" && team.ownerIds.length === 0,
  );
  const actionItems = [
    ...(canViewTimeRequests
      ? [
          {
            to: "/time-adjustments" as const,
            label: "Review time requests",
            description: "Pending approvals from employees",
            count: requests.data?.length ?? 0,
            icon: TimerReset,
            tone: "text-info bg-info/10",
          },
        ]
      : []),
    {
      to: "/live-activity" as const,
      label: "Check idle employees",
      description: "People online but currently idle",
      count: idleNow.length,
      icon: Clock,
      tone: "text-warning-foreground bg-warning/20",
    },
    ...(canViewAttendance
      ? [
          {
            to: "/attendance" as const,
            label: "Follow up late starts",
            description: "Scheduled employees still missing after their grace time",
            count: lateStarts.length,
            icon: AlertTriangle,
            tone: "text-warning-foreground bg-warning/20",
          },
        ]
      : []),
  ].filter((item) => item.count > 0);
  const attentionCount = actionItems.reduce((total, item) => total + item.count, 0);
  const failedDataSources = [
    { label: "live employee status", failed: emps.isError },
    { label: "weekly work totals", failed: trend.isError },
    { label: "teams", failed: teams.isError },
    { label: "devices", failed: devices.isError },
    { label: "time requests", failed: canViewTimeRequests && requests.isError },
    {
      label: "today's attendance",
      failed: canViewAttendance && todayAttendance.isError,
    },
  ].filter((source) => source.failed);
  const hasDataError = failedDataSources.length > 0;

  return (
    <div className="studio-page">
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

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile
          onClick={() => setAttentionOpen(true)}
          value={attentionLoading || hasDataError ? "—" : attentionCount}
          label={
            attentionLoading
              ? "Checking health"
              : hasDataError
                ? "Data unavailable"
                : attentionCount
                  ? "Need attention"
                  : "All healthy"
          }
          hint={
            attentionLoading
              ? "Loading live checks"
              : hasDataError
                ? "Retry failed checks"
                : attentionCount
                  ? "Open issue list"
                  : "Live summary"
          }
          icon={hasDataError || attentionCount ? AlertTriangle : CheckCircle2}
          tone={hasDataError ? "danger" : attentionCount ? "amber" : "green"}
        />
        {canViewTimeRequests && (
          <MetricTile
            to="/time-adjustments"
            value={!requests.data && requests.isPending ? "—" : (requests.data?.length ?? 0)}
            label="Time requests"
            hint={!requests.data && requests.isPending ? "Loading…" : "Pending review"}
            icon={TimerReset}
            tone="blue"
          />
        )}
        {canViewAttendance && (
          <MetricTile
            to="/attendance"
            value={!todayAttendance.data && todayAttendance.isPending ? "—" : lateStarts.length}
            label="Late starts"
            hint={
              !todayAttendance.data && todayAttendance.isPending ? "Loading…" : "Past grace time"
            }
            icon={Users}
            tone="muted"
          />
        )}
        <MetricTile
          to="/devices"
          value={!devices.data && devices.isPending ? "—" : offlineDevices.length}
          label="Devices offline"
          hint={
            !devices.data && devices.isPending
              ? "Loading…"
              : `of ${devices.data?.length ?? 0} devices`
          }
          icon={Monitor}
          tone="danger"
        />
        <MetricTile
          to="/teams"
          value={!teams.data && teams.isPending ? "—" : teamsWithoutOwner.length}
          label="Teams unowned"
          hint={!teams.data && teams.isPending ? "Loading…" : "Assign an owner"}
          icon={AlertTriangle}
          tone="amber"
        />
      </div>

      <Dialog open={attentionOpen} onOpenChange={setAttentionOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {hasDataError ? "Dashboard data unavailable" : "Need attention"}
            </DialogTitle>
            <DialogDescription>
              {hasDataError
                ? `Couldn't load: ${failedDataSources.map((source) => source.label).join(", ")}.`
                : attentionCount
                  ? `${attentionCount} open items need admin follow-up.`
                  : "Everything looks healthy right now."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {hasDataError && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">
                Retry the failed checks before relying on the dashboard summary.
              </div>
            )}
            {actionItems.length === 0 && !hasDataError ? (
              <div className="rounded-2xl border border-dashed bg-muted/30 p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-success/10 text-success">
                    <CheckCircle2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-extrabold">No open issues</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Time requests, idle status, and scheduled starts look clean.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              actionItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    onClick={() => setAttentionOpen(false)}
                    className="group flex items-center gap-3 rounded-2xl border bg-card p-3.5 transition hover:-translate-y-0.5 hover:border-[#e5185d]/25 hover:shadow-sm"
                  >
                    <span
                      className={`grid h-11 w-11 place-items-center rounded-[14px] ${item.tone}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold">{item.label}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    <span className="font-mono-numeric rounded-full bg-muted px-3 py-1.5 text-sm font-extrabold">
                      {item.count}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-[#e5185d]" />
                  </Link>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {hasDataError && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div>
              <p className="text-sm font-medium">Some dashboard data couldn't be loaded</p>
              <p className="text-xs text-muted-foreground">
                Unavailable: {failedDataSources.map((source) => source.label).join(", ")}.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              emps.refetch();
              trend.refetch();
              teams.refetch();
              devices.refetch();
              if (canViewTimeRequests) requests.refetch();
              if (canViewAttendance) todayAttendance.refetch();
            }}
          >
            Retry all
          </Button>
        </div>
      )}

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
                const connected = members.filter(employeeIsOnline).length;
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

      {/* Main dashboard canvas */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(400px,0.95fr)] 2xl:grid-cols-[minmax(0,1.7fr)_minmax(440px,0.9fr)]">
        <div className="space-y-4">
          {/* Hero metrics */}
          <div className="grid gap-3 lg:grid-cols-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)
            ) : trend.isError && !trend.data ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 lg:col-span-3">
                <p className="text-sm font-extrabold">Weekly totals couldn't be loaded</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Live employee status remains available while this section retries separately.
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  onClick={() => trend.refetch()}
                >
                  Retry weekly totals
                </Button>
              </div>
            ) : (
              <>
                <HeroCard
                  to="/reports"
                  label="Weekly activity"
                  sublabel="Active share"
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
                  sublabel="Approved + tracked"
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
                  sublabel="With time today"
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

          <Card
            ref={activitySectionRef}
            className="studio-card overflow-hidden rounded-2xl border-border/70 shadow-none"
          >
            <CardHeader className="gap-3 space-y-0 border-b border-border/70 p-[18px] xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2.5">
                <CardTitle className="text-sm font-extrabold">Member activity</CardTitle>
                <span className="text-[11px] font-extrabold text-foreground">
                  {activitySummary.total}
                </span>
                <span className="rounded-full border bg-muted/40 px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
                  {activitySummary.preview} - live status every 30 sec - rotates every 15 min
                </span>
                {shots.isFetching && shots.data && (
                  <span className="text-[10px] font-bold text-muted-foreground">
                    Refreshing previews…
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MEMBER_ACTIVITY_FILTERS.map((filter) => (
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
            <CardContent className="grid gap-3 p-[18px] md:grid-cols-2">
              {emps.isPending &&
                !emps.data &&
                Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-[168px] rounded-[18px]" />
                ))}
              {emps.isError && !emps.data && (
                <div className="rounded-[18px] border border-destructive/30 bg-destructive/5 p-5 md:col-span-2">
                  <p className="text-sm font-extrabold">Member activity couldn't be loaded</p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    onClick={() => emps.refetch()}
                  >
                    Retry members
                  </Button>
                </div>
              )}
              {!emps.isPending && !emps.isError && filteredActivity.length === 0 && (
                <div className="rounded-[18px] border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground md:col-span-2">
                  <p>
                    {activityFilter === "all"
                      ? "No members with registered devices."
                      : `No ${activityFilter} members right now.`}
                  </p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    disabled={emps.isFetching}
                    onClick={() => emps.refetch()}
                  >
                    {emps.isFetching ? "Refreshing status..." : "Refresh status"}
                  </Button>
                </div>
              )}
              {filteredActivity.map(({ employee, shots: images }) => (
                <div
                  key={employee.id}
                  className="overflow-hidden rounded-[18px] border border-border/80 bg-card/70"
                >
                  <Link
                    to="/employees/$employeeId"
                    params={{ employeeId: employee.id }}
                    className="flex min-w-0 items-center gap-2 border-b border-border/70 px-3 py-2.5 transition hover:bg-muted/60"
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="text-xs">{initials(employee.name)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate text-[12.5px] font-bold">{employee.name}</span>
                    <StatusBadge status={employee.status} className="ml-auto shrink-0" />
                  </Link>
                  <div className="grid grid-cols-3 gap-2 p-3">
                    {activityMediaLoading &&
                      Array.from({ length: 3 }).map((_, index) => (
                        <Skeleton key={index} className="aspect-video w-full rounded-[12px]" />
                      ))}
                    {!activityMediaLoading && shots.isError && !shots.data && (
                      <div className="col-span-3 flex min-h-24 flex-col items-center justify-center rounded-[13px] border border-destructive/30 bg-destructive/5 px-4 text-center">
                        <p className="text-xs text-muted-foreground">
                          Screenshot previews are temporarily unavailable.
                        </p>
                        <Button
                          className="mt-2"
                          variant="outline"
                          size="sm"
                          onClick={() => shots.refetch()}
                        >
                          Retry previews
                        </Button>
                      </div>
                    )}
                    {!activityMediaLoading &&
                      !(shots.isError && !shots.data) &&
                      images.length === 0 && (
                        <p className="col-span-3 flex min-h-24 items-center justify-center rounded-[13px] border border-dashed bg-muted/20 px-4 text-center text-xs text-muted-foreground">
                          No screenshots captured today.
                        </p>
                      )}
                    {!activityMediaLoading &&
                      images.map((shot) => (
                        <Link
                          key={shot.id}
                          to="/screenshots"
                          className="group relative overflow-hidden rounded-[12px] border border-border bg-background transition hover:border-primary/40 hover:shadow-md"
                        >
                          <ProtectedImage
                            src={shot.thumbnailUrl}
                            alt={`Screenshot from ${employee.name}`}
                            className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.04]"
                          />
                          <span className="absolute bottom-1 right-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white">
                            {new Date(shot.capturedAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </Link>
                      ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="studio-card rounded-2xl border-border/70 shadow-none">
            <CardHeader className="px-[18px] pb-3 pt-[18px]">
              <CardTitle className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                Insights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 px-[18px] pb-[18px]">
              {loading ? (
                <Skeleton className="h-[330px] rounded-[18px]" />
              ) : trend.isError && !trend.data ? (
                <div className="rounded-[18px] border border-destructive/30 bg-destructive/5 p-5">
                  <p className="text-sm font-extrabold">Insights couldn't be loaded</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This does not block live status or screenshots.
                  </p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    onClick={() => trend.refetch()}
                  >
                    Retry insights
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[13.5px] font-extrabold">Work time classification</p>
                        <p className="font-mono-numeric mt-1 text-3xl font-extrabold">
                          {Math.round((activeWork / classifiedTotal) * 100)}%
                          <span className="ml-1 text-sm font-normal text-muted-foreground">
                            active work
                          </span>
                        </p>
                      </div>
                      <span className="rounded-full border bg-muted/45 px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                        This week
                      </span>
                    </div>

                    <div className="mt-4 h-[176px] overflow-hidden rounded-[18px] border border-[#2563eb]/20 bg-[#0f3568] p-3 shadow-inner dark:border-[#2e58a4]/40 dark:bg-[#102a58]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={classificationTrend}
                          margin={{ top: 10, right: 8, bottom: 0, left: -18 }}
                        >
                          <defs>
                            <linearGradient id="classification-trend" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.58} />
                              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.08} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#2f72c9" strokeOpacity={0.72} />
                          <XAxis
                            dataKey="day"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "#bfdbfe", fontSize: 10, fontWeight: 700 }}
                            dy={5}
                          />
                          <Tooltip
                            cursor={{ stroke: "#bfdbfe", strokeOpacity: 0.4 }}
                            contentStyle={{
                              background: "#0b1635",
                              border: "1px solid rgba(96,165,250,.35)",
                              borderRadius: 12,
                              color: "#fff",
                              fontSize: 12,
                            }}
                            formatter={(value: number) => [`${Math.round(value)}%`, "Activity"]}
                          />
                          <Area
                            type="monotone"
                            dataKey="activity"
                            stroke="#bfdbfe"
                            strokeWidth={3}
                            fill="url(#classification-trend)"
                            dot={{ r: 3.5, fill: "#ffffff", stroke: "#60a5fa", strokeWidth: 2 }}
                            activeDot={{ r: 5, fill: "#ffffff", stroke: "#e5185d", strokeWidth: 2 }}
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                      {classified.map((seg) => (
                        <div
                          key={seg.label}
                          className="rounded-xl border bg-muted/30 px-3 py-2"
                          title={`${seg.label}: ${formatMinutes(seg.minutes)}`}
                        >
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <span className={`h-2 w-2 rounded-full ${seg.className}`} />
                            {seg.label}
                          </span>
                          <span className="font-mono-numeric mt-1 block text-base font-extrabold">
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
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Needs attention
                      </p>
                      <MemberList items={lowMembers} tone="text-warning-foreground" />
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="studio-card rounded-2xl border-border/70 shadow-none">
            <CardHeader className="flex-row items-center justify-between space-y-0 px-[18px] pb-3 pt-[18px]">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Who's online
              </CardTitle>
              {emps.data && (
                <span className="text-xs text-muted-foreground">
                  {online.length} online /{" "}
                  {emps.data.filter((employee) => employee.status === "idle").length} idle /{" "}
                  {emps.data.filter((employee) => employee.status === "on_break").length} on break /{" "}
                  {emps.data.filter((employee) => employee.status === "off_shift").length} off shift
                  / {emps.data.filter((employee) => employee.status === "offline").length} offline
                </span>
              )}
            </CardHeader>
            <CardContent className="px-[18px] pb-[18px]">
              {emps.isPending && !emps.data ? (
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-[66px] rounded-[14px]" />
                  ))}
                </div>
              ) : emps.isError && !emps.data ? (
                <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-xs text-muted-foreground">
                    Live employee status is temporarily unavailable.
                  </p>
                  <Button
                    className="mt-2"
                    variant="outline"
                    size="sm"
                    onClick={() => emps.refetch()}
                  >
                    Retry live status
                  </Button>
                </div>
              ) : online.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one is currently online.</p>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {onlinePreview.map((e) => (
                    <OnlineRow key={e.id} employee={e} />
                  ))}
                  {hiddenOnlineCount > 0 && (
                    <Link
                      to="/people"
                      search={{ tab: "live" }}
                      className="flex min-h-[66px] items-center justify-center rounded-[14px] border border-dashed bg-muted/40 px-3 py-2.5 text-sm font-extrabold text-muted-foreground transition hover:border-primary/30 hover:bg-muted hover:text-foreground"
                    >
                      +{hiddenOnlineCount} more online
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="studio-card rounded-2xl border-border/70 shadow-none">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border/70 px-[18px] pb-3 pt-[18px]">
              <div>
                <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Action queue
                </CardTitle>
                <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                  What needs admin attention now
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                  actionItems.length ? "bg-[#fce3ec] text-[#e5185d]" : "bg-success/10 text-success"
                }`}
              >
                {actionItems.length ? `${attentionCount} open` : "All clear"}
              </span>
            </CardHeader>
            <CardContent className="space-y-2.5 px-[18px] pb-[18px] pt-[14px]">
              {actionItems.length === 0 ? (
                <div className="rounded-[16px] border border-dashed bg-muted/25 p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-success/10 text-success">
                      <CheckCircle2 className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-extrabold">No urgent admin actions</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Requests, devices, teams, and starts look clean.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                actionItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      to={item.to}
                      className="group flex items-center gap-3 rounded-[16px] border border-border/80 bg-card p-3 transition hover:-translate-y-0.5 hover:border-[#e5185d]/25 hover:shadow-sm"
                    >
                      <span
                        className={`grid h-10 w-10 place-items-center rounded-[13px] ${item.tone}`}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-extrabold">{item.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                      <span className="font-mono-numeric rounded-full bg-muted px-2.5 py-1 text-sm font-extrabold">
                        {item.count}
                      </span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-[#e5185d]" />
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function formatSignedMinutes(delta: number): string {
  const sign = delta >= 0 ? "+" : "-";
  return `${sign}${formatMinutes(Math.abs(delta))}`;
}
function formatLiveSince(value?: string): string {
  if (!value) return "Live now";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 45) return "Live now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m live`;
  const hours = Math.round(minutes / 60);
  return `${hours}h live`;
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
      className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap text-[12px] font-extrabold ${up ? "text-success" : "text-destructive"}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      <span className="text-[11px] font-bold text-muted-foreground">vs last week</span>
    </span>
  );
}

function HeroCard({
  to,
  label,
  sublabel,
  value,
  icon: Icon,
  color,
  gradientId,
  series,
  trend,
}: {
  to: "/reports" | "/timesheets" | "/employees";
  label: string;
  sublabel: string;
  value: string | number;
  icon: LucideIcon;
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
      <Card className="studio-card h-full overflow-hidden rounded-2xl shadow-none transition duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/25">
        <CardContent className="relative min-h-[152px] px-6 pb-5 pt-6 sm:px-6 sm:pb-5 sm:pt-6">
          <span
            className="absolute right-6 top-6 grid h-9 w-9 place-items-center rounded-xl border"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
              borderColor: `color-mix(in srgb, ${color} 24%, transparent)`,
              color,
            }}
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 pr-14">
            <p className="truncate text-[12px] font-extrabold uppercase leading-[1.15] tracking-[0.08em] text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 truncate text-[11px] font-bold leading-[1.2] text-muted-foreground/80">
              {sublabel}
            </p>
          </div>

          <div className="mt-6 grid grid-cols-[minmax(0,1fr)_132px] items-end gap-5">
            <div className="min-w-0">
              <p className="font-mono-numeric truncate text-[34px] font-extrabold leading-none tracking-tight">
                {value}
              </p>
              <div className="mt-2 overflow-hidden">{trend}</div>
            </div>
            <div className="h-16 w-[132px] justify-self-end">
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
  const isActive = employee.status === "active";
  const statusLabel = isActive
    ? "Live now"
    : employee.status === "idle"
      ? "Idle online"
      : employee.status === "on_break"
        ? "On break"
        : employee.status === "off_shift"
          ? "Off shift"
          : "Online";
  const statusClasses = isActive
    ? "bg-success/12 text-success ring-success/20"
    : "bg-warning/15 text-warning-foreground ring-warning/20";
  return (
    <Link
      to="/employees/$employeeId"
      params={{ employeeId: employee.id }}
      className="group flex min-w-0 items-center gap-3 rounded-[14px] border bg-card px-3 py-2.5 shadow-sm transition hover:-translate-y-0.5 hover:border-success/30 hover:shadow-md"
    >
      <span className="relative shrink-0">
        <span
          className={`absolute inset-[-4px] rounded-full ${isActive ? "bg-success/18 animate-pulse" : "bg-warning/12"}`}
        />
        <Avatar className="relative h-10 w-10 border-2 border-card">
          <AvatarFallback className="text-xs font-extrabold">
            {initials(employee.name)}
          </AvatarFallback>
        </Avatar>
        <span
          className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-card ${isActive ? "bg-success" : "bg-warning"}`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-xs font-extrabold">{employee.name}</p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold ring-1 ${statusClasses}`}
          >
            {statusLabel}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[10.5px] font-semibold text-muted-foreground">
          {formatLiveSince(employee.lastHeartbeat)} / {formatMinutes(employee.workedTodayMinutes)}{" "}
          today
        </p>
      </div>
    </Link>
  );
}
