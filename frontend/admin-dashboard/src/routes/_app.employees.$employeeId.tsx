import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowLeft,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  Clock3,
  Star,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ProtectedImage } from "@/components/ProtectedImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { DatePicker } from "@/components/ui/date-picker";
import { WorkdayTimeline } from "@/components/workday-timeline";
import { getEmployee } from "@/api/employees";
import { getWorkdayTimeline, listSessions, listActivity } from "@/api/sessions";
import { listScreenshotPage } from "@/api/screenshots";
import { listTimesheets } from "@/api/timesheets";
import { listDevices } from "@/api/devices";
import { listTeams } from "@/api/teams";
import { listTasks } from "@/api/projects";
import { formatMinutes, formatRelative, formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_app/employees/$employeeId")({
  component: EmployeeDetailPage,
});

function EmployeeDetailPage() {
  const { employeeId } = Route.useParams();
  const [activeTab, setActiveTab] = useState("profile");
  const [timelineDay, setTimelineDay] = useState(() => {
    return toDateKey(new Date());
  });
  const emp = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => getEmployee(employeeId),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
  const sessions = useQuery({
    queryKey: ["sessions", employeeId],
    queryFn: () => listSessions(employeeId),
    enabled: activeTab === "sessions",
  });
  const activity = useQuery({
    queryKey: ["activity", employeeId],
    queryFn: () => listActivity(employeeId),
    enabled: activeTab === "activity",
  });
  const timeline = useQuery({
    queryKey: ["workday-timeline", employeeId, timelineDay],
    queryFn: () => getWorkdayTimeline(employeeId, timelineDay),
    enabled: activeTab === "profile" || activeTab === "workday",
    refetchInterval: activeTab === "profile" || activeTab === "workday" ? 60_000 : false,
  });
  const shots = useQuery({
    queryKey: ["emp-shots", employeeId],
    queryFn: () =>
      listScreenshotPage({ page: 1, pageSize: 24, employeeId }).then((page) => page.items),
    enabled: activeTab === "screenshots",
    staleTime: 45_000,
    placeholderData: (previous) => previous,
  });
  const ts = useQuery({
    queryKey: ["emp-ts", employeeId],
    queryFn: () => listTimesheets(),
    enabled: activeTab === "profile" || activeTab === "timesheets",
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
  const devs = useQuery({
    queryKey: ["devices"],
    queryFn: () => listDevices(),
    enabled: activeTab === "devices",
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
  const teams = useQuery({
    queryKey: ["teams"],
    queryFn: () => listTeams(),
    enabled: activeTab === "profile",
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
  const tasks = useQuery({
    queryKey: ["employee-detail-tasks", employeeId],
    queryFn: () => listTasks(),
    enabled: activeTab === "profile",
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  if (!emp.data) return <div className="text-sm text-muted-foreground">Loading...</div>;

  const e = emp.data;
  const device = (devs.data ?? []).find((item) => item.id === e.currentDeviceId);
  const empTeams = (teams.data ?? []).filter((team) => e.teamIds.includes(team.id));
  const empShots = (shots.data ?? []).filter((screenshot) => screenshot.employeeId === e.id);
  const empTs = (ts.data ?? []).filter((timesheet) => timesheet.employeeId === e.id);
  const todayKey = toDateKey(new Date());
  const weekStart = startOfWeek(new Date());
  const monthKey = todayKey.slice(0, 7);
  const todayTimesheet = empTs.find((timesheet) => timesheet.date === todayKey);
  const weekTimesheets = empTs.filter((timesheet) => {
    const date = dateKeyToDate(timesheet.date);
    return date >= weekStart;
  });
  const monthTimesheets = empTs.filter((timesheet) => timesheet.date.startsWith(monthKey));
  const todaySummary = {
    totalMinutes: todayTimesheet?.totalMinutes ?? e.workedTodayMinutes,
    activeMinutes: todayTimesheet?.activeMinutes ?? e.activeMinutes,
    idleMinutes: todayTimesheet?.idleMinutes ?? e.idleMinutes,
    points: todayTimesheet?.points ?? 0,
    screenshots: todayTimesheet?.screenshotCount ?? 0,
  };
  const weekSummary = summarizeTimesheets(weekTimesheets);
  const monthSummary = summarizeTimesheets(monthTimesheets);
  const employeeTasks = (tasks.data ?? [])
    .filter(
      (task) =>
        task.status === "active" &&
        (task.assigneeEmployeeId === e.id ||
          task.collaboratorEmployeeIds.includes(e.id) ||
          task.checklist.some((item) => item.assigneeEmployeeId === e.id)),
    )
    .slice(0, 5);

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/people" search={{ tab: "directory" }}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to people
        </Link>
      </Button>
      <PageHeader
        title={e.name}
        description={`Employee profile · ${e.code} · ${e.jobTitle || "No job title"}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={e.accountStatus === "invited" ? "invited" : e.status} />
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="profile">Overview</TabsTrigger>
          <TabsTrigger value="workday">Workday</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
          <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-3">
              <EmployeeMetricCard
                title="Today"
                icon={Clock3}
                minutes={todaySummary.totalMinutes}
                activeMinutes={todaySummary.activeMinutes}
                idleMinutes={todaySummary.idleMinutes}
                points={todaySummary.points}
                screenshots={todaySummary.screenshots}
              />
              <EmployeeMetricCard
                title="This week"
                icon={CalendarDays}
                minutes={weekSummary.totalMinutes || todaySummary.totalMinutes}
                activeMinutes={weekSummary.activeMinutes || todaySummary.activeMinutes}
                idleMinutes={weekSummary.idleMinutes || todaySummary.idleMinutes}
                points={weekSummary.points}
                screenshots={weekSummary.screenshots}
              />
              <EmployeeMetricCard
                title="This month"
                icon={Star}
                minutes={monthSummary.totalMinutes || weekSummary.totalMinutes || todaySummary.totalMinutes}
                activeMinutes={monthSummary.activeMinutes || weekSummary.activeMinutes || todaySummary.activeMinutes}
                idleMinutes={monthSummary.idleMinutes || weekSummary.idleMinutes || todaySummary.idleMinutes}
                points={monthSummary.points}
                screenshots={monthSummary.screenshots}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Today's activity</CardTitle>
                <p className="text-sm text-muted-foreground">
                  A manager-friendly preview of the employee's workday activity.
                </p>
              </CardHeader>
              <CardContent>
                <WorkdayTimeline timeline={timeline.data} />
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BriefcaseBusiness className="h-5 w-5 text-primary" />
                    Assigned tasks
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Tasks currently assigned to this employee or owned through checklist items.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {employeeTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex flex-col gap-2 rounded-xl border border-border bg-card/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{task.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {task.projectName || "No project"} · {task.teamName || "No team"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold capitalize text-primary">
                          {task.stage.replace(/_/g, " ")}
                        </span>
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize text-muted-foreground">
                          {task.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                  {employeeTasks.length === 0 && (
                    <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No assigned tasks right now.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-primary" />
                    Admin snapshot
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Admin-only context kept separate from the employee-facing preview.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="rounded-xl border border-border p-3">
                    <div className="mb-2 font-semibold">Profile</div>
                    <div className="space-y-2">
                      <Row k="Email" v={e.email} />
                      <Row k="Employee code" v={e.code} />
                      <Row k="Job title" v={e.jobTitle || "-"} />
                      <Row k="Teams" v={empTeams.map((team) => team.name).join(", ") || "-"} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <div className="mb-2 font-semibold">Current status</div>
                    <div className="space-y-2">
                      <Row
                        k="Status"
                        v={<StatusBadge status={e.accountStatus === "invited" ? "invited" : e.status} />}
                      />
                      <Row k="Session start" v={formatDateTime(e.sessionStart)} />
                      <Row k="Last heartbeat" v={formatRelative(e.lastHeartbeat)} />
                      <Row k="Last screenshot" v={formatRelative(e.lastScreenshotAt)} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <div className="mb-2 font-semibold">Access & device</div>
                    <div className="space-y-2">
                      <Row k="Portal access" v={e.portalAccessEnabled ? "Enabled" : "Invitation/password"} />
                      <Row k="Portal last login" v={formatDateTime(e.portalLastLoginAt)} />
                      <Row k="Device" v={device?.name || e.currentDeviceName || "-"} />
                      <Row
                        k="Device status"
                        v={
                          device ? (
                            <StatusBadge status={device.status} />
                          ) : e.currentDeviceName ? (
                            "Reported by agent"
                          ) : (
                            "-"
                          )
                        }
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="workday">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle>Workday activity</CardTitle>
              <DatePicker
                value={timelineDay}
                onChange={(value) => value && setTimelineDay(value)}
                clearable={false}
                className="w-44"
              />
            </CardHeader>
            <CardContent>
              <WorkdayTimeline timeline={timeline.data} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border text-sm">
                {(sessions.data ?? []).map((session) => (
                  <div key={session.id} className="grid grid-cols-4 gap-2 px-4 py-3">
                    <div>{formatDateTime(session.startedAt)}</div>
                    <div className="text-muted-foreground">
                      {session.endedAt ? formatDateTime(session.endedAt) : "In progress"}
                    </div>
                    <div>Active {formatMinutes(session.activeMinutes)}</div>
                    <div className="text-right">{session.screenshotCount} screenshots</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="screenshots">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {empShots.slice(0, 12).map((screenshot) => (
              <ProtectedImage
                key={screenshot.id}
                src={screenshot.thumbnailUrl}
                alt=""
                className="aspect-video w-full rounded-md object-cover ring-1 ring-border"
              />
            ))}
            {empShots.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-full">No screenshots.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="timesheets">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border text-sm">
                {empTs.map((timesheet) => (
                  <div key={timesheet.id} className="grid grid-cols-4 gap-2 px-4 py-3">
                    <div>{timesheet.date}</div>
                    <div>{formatMinutes(timesheet.totalMinutes)}</div>
                    <div className="text-muted-foreground">
                      {formatMinutes(timesheet.idleMinutes)} idle
                    </div>
                    <div className="text-right">
                      <StatusBadge status={timesheet.status} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="devices">
          <Card>
            <CardContent className="p-4 text-sm">
              {device ? (
                <div>
                  {device.name} - {device.os} - {device.agentVersion}
                </div>
              ) : (
                <p className="text-muted-foreground">No device.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border text-sm">
                {(activity.data ?? []).map((event) => (
                  <div key={event.id} className="flex justify-between px-4 py-3">
                    <span className="capitalize">{event.type.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground">{formatRelative(event.at)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}

function EmployeeMetricCard({
  title,
  icon: Icon,
  minutes,
  activeMinutes,
  idleMinutes,
  points,
  screenshots,
}: {
  title: string;
  icon: LucideIcon;
  minutes: number;
  activeMinutes: number;
  idleMinutes: number;
  points: number;
  screenshots: number;
}) {
  const totalForBar = Math.max(activeMinutes + idleMinutes, 1);
  const activePercent = Math.round((activeMinutes / totalForBar) * 100);
  const idlePercent = Math.max(0, 100 - activePercent);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <CardTitle className="text-3xl">{formatMinutes(minutes)}</CardTitle>
          </div>
          <Icon className="h-7 w-7 text-primary" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <Star className="h-4 w-4" />
            {points.toFixed(2)} points
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Camera className="h-4 w-4" />
            {screenshots}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-success" style={{ width: `${activePercent}%` }} />
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          <MetricLegend label="Worked (counted)" value={formatMinutes(activeMinutes)} color="bg-success" />
          <MetricLegend label="Idle (not counted)" value={formatMinutes(idleMinutes)} color="bg-slate-400" />
          <MetricLegend label="Remaining idle share" value={`${idlePercent}%`} color="bg-warning" />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricLegend({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${color}`} />
        {label}
      </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function toDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dateKeyToDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`);
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function summarizeTimesheets(
  timesheets: Array<{
    totalMinutes: number;
    activeMinutes: number;
    idleMinutes: number;
    points: number;
    screenshotCount: number;
  }>,
) {
  return timesheets.reduce(
    (summary, timesheet) => ({
      totalMinutes: summary.totalMinutes + timesheet.totalMinutes,
      activeMinutes: summary.activeMinutes + timesheet.activeMinutes,
      idleMinutes: summary.idleMinutes + timesheet.idleMinutes,
      points: summary.points + timesheet.points,
      screenshots: summary.screenshots + timesheet.screenshotCount,
    }),
    { totalMinutes: 0, activeMinutes: 0, idleMinutes: 0, points: 0, screenshots: 0 },
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
