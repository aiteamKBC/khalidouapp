import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bell,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileClock,
  FileSpreadsheet,
  History,
  PencilLine,
  Plus,
  Save,
  Settings2,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { ProtectedImage } from "@/components/ProtectedImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkdayTimeline } from "@/components/workday-timeline";
import {
  getEmployee,
  getEmployeeChangeHistory,
  getWorkProfile,
  updateWorkProfile,
  type WorkProfile,
} from "@/api/employees";
import {
  deleteAttendanceCorrection,
  getDailyAttendance,
  getEmployeeAttendanceRange,
  updateAttendanceCorrection,
  type DailyAttendance,
  type EmployeeAttendanceRange,
} from "@/api/attendance";
import {
  getPayrollEntry,
  getPayrollSheet,
  updatePayrollEntry,
  type PayrollEntry,
} from "@/api/payroll";
import { listLeaveRequests } from "@/api/leaveRequests";
import { listTimeAdjustmentRequests } from "@/api/timeAdjustments";
import { getWorkdayTimeline, listSessions, listActivity } from "@/api/sessions";
import { downloadScreenshot, listScreenshotPage } from "@/api/screenshots";
import { listTimesheets } from "@/api/timesheets";
import { listDevices } from "@/api/devices";
import { listTeams } from "@/api/teams";
import { listTasks } from "@/api/projects";
import { formatMinutes, formatRelative, formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";

export const Route = createFileRoute("/_app/employees/$employeeId")({
  component: EmployeeDetailPage,
});

function EmployeeDetailPage() {
  const { employeeId } = Route.useParams();
  const { can, scopedTeamIds } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("profile");
  const [previewScreenshotId, setPreviewScreenshotId] = useState<string | null>(null);
  const [downloadingScreenshotId, setDownloadingScreenshotId] = useState<string | null>(null);
  const [timelineDay, setTimelineDay] = useState(() => {
    return toDateKey(new Date());
  });
  const [attendanceMonth, setAttendanceMonth] = useState(() => toDateKey(new Date()).slice(0, 7));
  const [payrollMonth, setPayrollMonth] = useState(() => toDateKey(new Date()).slice(0, 7));
  const [selectedAttendanceDay, setSelectedAttendanceDay] = useState<string | null>(null);
  const [screenshotDay, setScreenshotDay] = useState<string | null>(null);
  const [showAmounts, setShowAmounts] = useState(false);
  const canManageSchedule = can(permissions.breaksManage);
  const canManageAttendance = can(permissions.timesheetsManage);
  const canViewPayroll = can(permissions.payrollView);
  const canManagePayroll = can(permissions.payrollManage);
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
    queryKey: ["emp-shots", employeeId, screenshotDay],
    queryFn: () =>
      listScreenshotPage({
        page: 1,
        pageSize: 24,
        employeeId,
        day: screenshotDay ?? undefined,
      }).then((page) => page.items),
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
  const profile = useQuery({
    queryKey: ["employee-work-profile", employeeId],
    queryFn: () => getWorkProfile(employeeId),
    enabled: activeTab === "schedule" || activeTab === "profile",
  });
  const attendanceBounds = monthBounds(attendanceMonth);
  const attendance = useQuery({
    queryKey: ["employee-attendance-range", employeeId, attendanceMonth],
    queryFn: () =>
      getEmployeeAttendanceRange(employeeId, attendanceBounds.start, attendanceBounds.end),
    enabled: activeTab === "attendance",
  });
  const attendanceDetail = useQuery({
    queryKey: ["employee-attendance-day", employeeId, selectedAttendanceDay],
    queryFn: () => getDailyAttendance(employeeId, selectedAttendanceDay!),
    enabled: Boolean(selectedAttendanceDay),
  });
  const payroll = useQuery({
    queryKey: ["employee-payroll-sheet", employeeId, payrollMonth],
    queryFn: () => getPayrollSheet({ month: payrollMonth, employee_id: employeeId }),
    enabled: activeTab === "payroll" && canViewPayroll,
  });
  const payrollEntryId = payroll.data?.entries[0]?.id;
  const payrollDetail = useQuery({
    queryKey: ["employee-payroll-entry", payrollEntryId],
    queryFn: () => getPayrollEntry(payrollEntryId!),
    enabled: activeTab === "payroll" && Boolean(payrollEntryId),
  });
  const leaveRequests = useQuery({
    queryKey: ["employee-leave-requests", employeeId],
    queryFn: () => listLeaveRequests(),
    enabled: activeTab === "requests",
  });
  const timeRequests = useQuery({
    queryKey: ["employee-time-requests", employeeId],
    queryFn: () =>
      listTimeAdjustmentRequests({
        scopedTeamIds: scopedTeamIds(),
        employeeId,
      }),
    enabled: activeTab === "requests",
  });
  const history = useQuery({
    queryKey: ["employee-change-history", employeeId],
    queryFn: () => getEmployeeChangeHistory(employeeId),
    enabled: activeTab === "history",
  });

  useEffect(() => {
    if (!showAmounts) return;
    const hide = () => setShowAmounts(false);
    const timer = window.setTimeout(hide, 30_000);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", hide);
    };
  }, [showAmounts]);

  if (!emp.data) return <div className="text-sm text-muted-foreground">Loading...</div>;

  const e = emp.data;
  const device = (devs.data ?? []).find((item) => item.id === e.currentDeviceId);
  const empTeams = (teams.data ?? []).filter((team) => e.teamIds.includes(team.id));
  const empShots = (shots.data ?? []).filter((screenshot) => screenshot.employeeId === e.id);
  const previewScreenshot =
    empShots.find((screenshot) => screenshot.id === previewScreenshotId) ?? null;
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
  const timelineWorkedMinutes = Math.floor((timeline.data?.workedSeconds ?? 0) / 60);
  const timelineIdleMinutes = Math.floor((timeline.data?.idleSeconds ?? 0) / 60);
  const todaySummary = {
    totalMinutes: Math.max(
      todayTimesheet?.totalMinutes ?? e.workedTodayMinutes,
      timelineWorkedMinutes,
    ),
    activeMinutes: Math.max(
      todayTimesheet?.activeMinutes ?? e.activeMinutes,
      timelineWorkedMinutes,
    ),
    idleMinutes: Math.max(todayTimesheet?.idleMinutes ?? e.idleMinutes, timelineIdleMinutes),
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
          <TabsTrigger value="schedule">Schedule & breaks</TabsTrigger>
          <TabsTrigger value="attendance">Attendance ledger</TabsTrigger>
          <TabsTrigger value="requests">Requests & leave</TabsTrigger>
          {canViewPayroll && <TabsTrigger value="payroll">Monthly payroll</TabsTrigger>}
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
          <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="history">Change history</TabsTrigger>
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
                minutes={
                  monthSummary.totalMinutes || weekSummary.totalMinutes || todaySummary.totalMinutes
                }
                activeMinutes={
                  monthSummary.activeMinutes ||
                  weekSummary.activeMinutes ||
                  todaySummary.activeMinutes
                }
                idleMinutes={
                  monthSummary.idleMinutes || weekSummary.idleMinutes || todaySummary.idleMinutes
                }
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
                        v={
                          <StatusBadge
                            status={e.accountStatus === "invited" ? "invited" : e.status}
                          />
                        }
                      />
                      <Row k="Session start" v={formatDateTime(e.sessionStart)} />
                      <Row k="Last heartbeat" v={formatRelative(e.lastHeartbeat)} />
                      <Row k="Last screenshot" v={formatRelative(e.lastScreenshotAt)} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <div className="mb-2 font-semibold">Access & device</div>
                    <div className="space-y-2">
                      <Row
                        k="Password access"
                        v={e.portalAccessEnabled ? "Enabled" : "Invitation pending"}
                      />
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

        <TabsContent value="schedule">
          <ScheduleEditor
            employeeId={employeeId}
            profile={profile.data}
            canManage={canManageSchedule}
            onSaved={() => {
              void queryClient.invalidateQueries({
                queryKey: ["employee-work-profile", employeeId],
              });
              void queryClient.invalidateQueries({
                queryKey: ["employee-attendance-range", employeeId],
              });
            }}
          />
        </TabsContent>

        <TabsContent value="attendance">
          <div className="space-y-4">
            <Card>
              <CardContent className="flex flex-wrap items-end justify-between gap-3 p-4">
                <div className="space-y-1">
                  <Label htmlFor="employee-attendance-month">Attendance month</Label>
                  <Input
                    id="employee-attendance-month"
                    type="month"
                    className="w-48"
                    value={attendanceMonth}
                    onChange={(event) => setAttendanceMonth(event.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={!attendance.data?.rows.length}
                  onClick={() => attendance.data && downloadAttendanceCsv(attendance.data)}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export monthly attendance
                </Button>
              </CardContent>
            </Card>
            {attendance.data && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <CompactMetric label="Worked days" value={attendance.data.summary.workedDays} />
                <CompactMetric label="Leave days" value={attendance.data.summary.leaveDays} />
                <CompactMetric
                  label="Payable"
                  value={formatSeconds(attendance.data.summary.payableSeconds)}
                />
                <CompactMetric
                  label="Idle"
                  value={formatSeconds(attendance.data.summary.idleSeconds)}
                />
                <CompactMetric
                  label="Approved overtime"
                  value={formatSeconds(attendance.data.summary.approvedOvertimeSeconds)}
                />
                <CompactMetric label="Screenshots" value={attendance.data.summary.screenshots} />
              </div>
            )}
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Started / ended</TableHead>
                    <TableHead>Normal</TableHead>
                    <TableHead>Idle</TableHead>
                    <TableHead>Manual</TableHead>
                    <TableHead>Late</TableHead>
                    <TableHead>Overtime</TableHead>
                    <TableHead>Payable</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendance.isLoading &&
                    Array.from({ length: 7 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={11}>
                          <div className="h-9 animate-pulse rounded bg-muted" />
                        </TableCell>
                      </TableRow>
                    ))}
                  {(attendance.data?.rows ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-semibold">{row.date}</TableCell>
                      <TableCell>
                        {formatClock(row.scheduledStartAt, row.timezone)} –{" "}
                        {formatClock(row.scheduledEndAt, row.timezone)}
                      </TableCell>
                      <TableCell>
                        {formatClock(row.actualFirstActivityAt, row.timezone)} –{" "}
                        {formatClock(row.actualLastActivityAt, row.timezone)}
                      </TableCell>
                      <TableCell>{formatSeconds(row.normalWorkedSeconds)}</TableCell>
                      <TableCell>{formatSeconds(row.idleSeconds)}</TableCell>
                      <TableCell>
                        {formatSeconds(row.approvedManualSeconds)}
                        {row.pendingManualSeconds > 0 && (
                          <span className="block text-xs text-amber-700">
                            {formatSeconds(row.pendingManualSeconds)} pending
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{formatSeconds(row.deductibleLateSeconds)}</TableCell>
                      <TableCell>
                        {formatSeconds(row.recordedOvertimeSeconds)}
                        <span className="block text-xs text-muted-foreground">
                          {formatSeconds(row.approvedOvertimeSeconds)} approved
                        </span>
                      </TableCell>
                      <TableCell className="font-semibold">
                        {formatSeconds(row.totalPayableSeconds)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedAttendanceDay(row.date)}
                          >
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            Day
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={row.screenshotCount === 0}
                            onClick={() => {
                              setScreenshotDay(row.date);
                              setActiveTab("screenshots");
                            }}
                          >
                            <Camera className="mr-1 h-3.5 w-3.5" />
                            {row.screenshotCount}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="requests">
          <div className="grid gap-4 xl:grid-cols-2">
            <RequestList
              title="Leave requests"
              items={(leaveRequests.data ?? [])
                .filter((item) => item.employeeId === employeeId)
                .map((item) => ({
                  id: item.id,
                  title: `${item.leaveType} leave`,
                  period: `${item.startDate} → ${item.endDate}`,
                  detail: `${item.requestedDays} working day(s)${item.reason ? ` · ${item.reason}` : ""}`,
                  status: item.status,
                  reviewedBy: item.reviewedByName,
                }))}
            />
            <RequestList
              title="Time requests"
              items={(timeRequests.data ?? []).map((item) => ({
                id: item.id,
                title: (item.requestType ?? "manual_time").replace(/_/g, " "),
                period: item.requestedDate,
                detail: `${item.requestedMinutes}m · ${item.reason}`,
                status: item.status,
                reviewedBy: item.reviewedByName,
              }))}
            />
          </div>
        </TabsContent>

        {canViewPayroll && (
          <TabsContent value="payroll">
            <div className="space-y-4">
              <Card>
                <CardContent className="flex flex-wrap items-end justify-between gap-3 p-4">
                  <div className="space-y-1">
                    <Label htmlFor="employee-payroll-month">Payroll cycle ending month</Label>
                    <Input
                      id="employee-payroll-month"
                      type="month"
                      className="w-52"
                      value={payrollMonth}
                      onChange={(event) => setPayrollMonth(event.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowAmounts((current) => !current)}>
                      {showAmounts ? (
                        <EyeOff className="mr-2 h-4 w-4" />
                      ) : (
                        <Eye className="mr-2 h-4 w-4" />
                      )}
                      {showAmounts ? "Hide salary" : "Show salary"}
                    </Button>
                    <Button asChild>
                      <Link to="/payroll">
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Open payroll workspace
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
              {payrollDetail.data ? (
                <EmployeePayrollSummary
                  entry={payrollDetail.data}
                  showAmounts={showAmounts}
                  canManage={canManagePayroll}
                  onSaved={() =>
                    Promise.all([
                      queryClient.invalidateQueries({
                        queryKey: ["employee-payroll-entry", payrollEntryId],
                      }),
                      queryClient.invalidateQueries({
                        queryKey: ["employee-payroll-sheet", employeeId],
                      }),
                      queryClient.invalidateQueries({
                        queryKey: ["employee-change-history", employeeId],
                      }),
                    ]).then(() => undefined)
                  }
                />
              ) : (
                <Card>
                  <CardContent className="p-8 text-center text-sm text-muted-foreground">
                    {payroll.isLoading
                      ? "Calculating this payroll cycle…"
                      : "No payroll entry is available for this cycle."}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        )}

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
          <Card className="mb-4">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">Screenshot evidence</p>
                <p className="text-sm text-muted-foreground">
                  {screenshotDay
                    ? `Showing captures for ${screenshotDay}`
                    : "Showing latest captures"}
                </p>
              </div>
              {screenshotDay && (
                <Button variant="outline" onClick={() => setScreenshotDay(null)}>
                  Show all recent
                </Button>
              )}
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {empShots.slice(0, 12).map((screenshot) => (
              <div
                key={screenshot.id}
                className="overflow-hidden rounded-lg border bg-card shadow-sm"
              >
                <button
                  type="button"
                  className="block w-full"
                  onClick={() => setPreviewScreenshotId(screenshot.id)}
                  aria-label="Preview screenshot"
                >
                  <ProtectedImage
                    src={screenshot.thumbnailUrl}
                    alt={`Screenshot captured at ${formatDateTime(screenshot.capturedAt)}`}
                    className="aspect-video w-full object-cover"
                  />
                </button>
                <div className="space-y-3 p-3">
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDateTime(screenshot.capturedAt)}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPreviewScreenshotId(screenshot.id)}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      Preview
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={downloadingScreenshotId === screenshot.id}
                      onClick={async () => {
                        setDownloadingScreenshotId(screenshot.id);
                        try {
                          await downloadScreenshot(screenshot);
                        } finally {
                          setDownloadingScreenshotId(null);
                        }
                      }}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download
                    </Button>
                  </div>
                </div>
              </div>
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

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Auditable change history</CardTitle>
              <p className="text-sm text-muted-foreground">
                Who changed this employee, when it changed, and the saved before/after context.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {(history.data ?? []).map((item) => (
                <div
                  key={item.id}
                  className="grid gap-2 rounded-xl border p-3 md:grid-cols-[180px_1fr_auto]"
                >
                  <div>
                    <p className="font-semibold capitalize">{item.action.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.entityType.replace(/_/g, " ")}
                    </p>
                  </div>
                  <div className="min-w-0 text-sm">
                    <p>
                      Changed by <span className="font-semibold">{item.actorName}</span>
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      {summarizeAuditDetails(item.details)}
                    </p>
                  </div>
                  <time className="text-xs text-muted-foreground">{formatDateTime(item.at)}</time>
                </div>
              ))}
              {!history.isLoading && (history.data ?? []).length === 0 && (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No saved changes for this employee yet.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <Dialog
        open={Boolean(selectedAttendanceDay)}
        onOpenChange={(open) => !open && setSelectedAttendanceDay(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Daily attendance · {selectedAttendanceDay ?? ""}</DialogTitle>
            <DialogDescription>
              Schedule, actual start and end, payable time, requests, and captured evidence for this
              day.
            </DialogDescription>
          </DialogHeader>
          {attendanceDetail.data ? (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <CompactMetric
                  label="Scheduled"
                  value={`${formatClock(
                    attendanceDetail.data.scheduledStartAt,
                    attendanceDetail.data.timezone,
                  )} – ${formatClock(
                    attendanceDetail.data.scheduledEndAt,
                    attendanceDetail.data.timezone,
                  )}`}
                />
                <CompactMetric
                  label="Started"
                  value={formatClock(
                    attendanceDetail.data.actualFirstActivityAt,
                    attendanceDetail.data.timezone,
                  )}
                />
                <CompactMetric
                  label="Ended"
                  value={formatClock(
                    attendanceDetail.data.actualLastActivityAt,
                    attendanceDetail.data.timezone,
                  )}
                />
                <CompactMetric
                  label="Payable"
                  value={formatSeconds(attendanceDetail.data.totalPayableSeconds)}
                />
                <CompactMetric
                  label="Approved overtime"
                  value={formatSeconds(attendanceDetail.data.approvedOvertimeSeconds)}
                />
              </div>
              <WorkdayTimeline timeline={attendanceDetail.data.timeline} />
              {canManageAttendance && selectedAttendanceDay && (
                <DailyCorrectionEditor
                  employeeId={employeeId}
                  day={selectedAttendanceDay}
                  attendance={attendanceDetail.data}
                  onSaved={async () => {
                    await Promise.all([
                      queryClient.invalidateQueries({
                        queryKey: ["employee-attendance-day", employeeId],
                      }),
                      queryClient.invalidateQueries({
                        queryKey: ["employee-attendance-range", employeeId],
                      }),
                      queryClient.invalidateQueries({
                        queryKey: ["employee-change-history", employeeId],
                      }),
                      queryClient.invalidateQueries({
                        queryKey: ["employee-payroll-sheet", employeeId],
                      }),
                    ]);
                  }}
                />
              )}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setScreenshotDay(selectedAttendanceDay);
                    setSelectedAttendanceDay(null);
                    setActiveTab("screenshots");
                  }}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  View this day's screenshots
                </Button>
              </div>
            </div>
          ) : (
            <div className="h-52 animate-pulse rounded bg-muted" />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(previewScreenshot)}
        onOpenChange={(open) => !open && setPreviewScreenshotId(null)}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Screenshot preview</DialogTitle>
            <DialogDescription>
              {previewScreenshot ? formatDateTime(previewScreenshot.capturedAt) : ""}
            </DialogDescription>
          </DialogHeader>
          {previewScreenshot && (
            <div className="space-y-4">
              <ProtectedImage
                src={previewScreenshot.fullUrl}
                alt={`Screenshot captured at ${formatDateTime(previewScreenshot.capturedAt)}`}
                className="max-h-[70vh] w-full rounded-lg object-contain"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  loading={downloadingScreenshotId === previewScreenshot.id}
                  onClick={async () => {
                    setDownloadingScreenshotId(previewScreenshot.id);
                    try {
                      await downloadScreenshot(previewScreenshot);
                    } finally {
                      setDownloadingScreenshotId(null);
                    }
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
          <MetricLegend
            label="Worked (counted)"
            value={formatMinutes(activeMinutes)}
            color="bg-success"
          />
          <MetricLegend
            label="Idle (not counted)"
            value={formatMinutes(idleMinutes)}
            color="bg-slate-400"
          />
          <MetricLegend label="Remaining idle share" value={`${idlePercent}%`} color="bg-warning" />
        </div>
      </CardContent>
    </Card>
  );
}

type EditableBreak = {
  name: string;
  start_time: string;
  end_time: string;
  paid: boolean;
};

function DailyCorrectionEditor({
  employeeId,
  day,
  attendance,
  onSaved,
}: {
  employeeId: string;
  day: string;
  attendance: DailyAttendance;
  onSaved: () => Promise<void>;
}) {
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [payableMinutesDelta, setPayableMinutesDelta] = useState("0");
  const [reason, setReason] = useState("");

  useEffect(() => {
    setStartTime(toTimeInput(attendance.actualFirstActivityAt, attendance.timezone));
    setEndTime(toTimeInput(attendance.actualLastActivityAt, attendance.timezone));
    setPayableMinutesDelta(String(Math.round(attendance.attendanceAdjustmentSeconds / 60)));
    setReason(attendance.attendanceCorrection?.reason ?? "");
  }, [attendance]);

  const save = useMutation({
    mutationFn: () =>
      updateAttendanceCorrection(employeeId, day, {
        startTime: startTime || null,
        endTime: endTime || null,
        payableMinutesDelta: Number(payableMinutesDelta) || 0,
        reason,
      }),
    onSuccess: async () => {
      toast.success("Attendance correction saved with an audit record.");
      await onSaved();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save the correction."),
  });
  const remove = useMutation({
    mutationFn: () => deleteAttendanceCorrection(employeeId, day),
    onSuccess: async () => {
      toast.success("Manual correction removed. Tracking evidence is active again.");
      await onSaved();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not remove the correction."),
  });

  return (
    <Card className="border-amber-300/70 bg-amber-50/40 dark:bg-amber-950/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PencilLine className="h-4 w-4" />
          HR attendance correction
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Tracking evidence is preserved. Any corrected times or payable-minute adjustment is stored
          separately with the reason and editor.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <FieldInput
            label="Corrected start"
            value={startTime}
            onChange={setStartTime}
            type="time"
            disabled={save.isPending || remove.isPending}
          />
          <FieldInput
            label="Corrected end"
            value={endTime}
            onChange={setEndTime}
            type="time"
            disabled={save.isPending || remove.isPending}
          />
          <div className="space-y-1.5">
            <Label>Payable minutes adjustment</Label>
            <Input
              type="number"
              min={-1440}
              max={1440}
              value={payableMinutesDelta}
              disabled={save.isPending || remove.isPending}
              onChange={(event) => setPayableMinutesDelta(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Positive adds approved time; negative removes it.
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Required reason</Label>
          <Input
            value={reason}
            maxLength={2000}
            placeholder="Explain the evidence and why this correction is required."
            disabled={save.isPending || remove.isPending}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {attendance.attendanceCorrection && (
            <Button
              variant="destructive"
              loading={remove.isPending}
              disabled={save.isPending}
              onClick={() => remove.mutate()}
            >
              Remove correction
            </Button>
          )}
          <Button
            loading={save.isPending}
            disabled={remove.isPending || reason.trim().length < 3}
            onClick={() => save.mutate()}
          >
            <Save className="mr-2 h-4 w-4" />
            Save correction
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduleEditor({
  employeeId,
  profile,
  canManage,
  onSaved,
}: {
  employeeId: string;
  profile?: WorkProfile;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [shiftStart, setShiftStart] = useState("");
  const [shiftEnd, setShiftEnd] = useState("");
  const [workingDays, setWorkingDays] = useState<number[]>([]);
  const [lateGrace, setLateGrace] = useState(15);
  const [earlyLeave, setEarlyLeave] = useState(120);
  const [breaks, setBreaks] = useState<EditableBreak[]>([]);

  useEffect(() => {
    if (!profile) return;
    setShiftStart(profile.shiftStart ?? "");
    setShiftEnd(profile.shiftEnd ?? "");
    setWorkingDays(profile.workingDays ?? []);
    setLateGrace(profile.lateGraceMinutes ?? 15);
    setEarlyLeave(profile.weeklyEarlyLeaveMinutes ?? 120);
    setBreaks(
      (profile.breakRules ?? []).map((item) => ({
        name: item.name,
        start_time: item.start_time ?? "",
        end_time: item.end_time ?? "",
        paid: item.paid,
      })),
    );
  }, [profile]);

  const save = useMutation({
    mutationFn: () =>
      updateWorkProfile(employeeId, {
        shiftStart,
        shiftEnd,
        workingDays,
        weeklyOffDays: [0, 1, 2, 3, 4, 5, 6].filter((day) => !workingDays.includes(day)),
        requiredDailyMinutes: minutesBetween(shiftStart, shiftEnd),
        lateGraceMinutes: lateGrace,
        weeklyEarlyLeaveMinutes: earlyLeave,
        breakRules: breaks.map((item) => ({
          ...item,
          minutes: minutesBetween(item.start_time, item.end_time),
        })),
      }),
    onSuccess: () => {
      toast.success("Schedule and break rules saved");
      onSaved();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save"),
  });

  if (!profile) {
    return <div className="h-72 animate-pulse rounded-xl bg-muted" />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            Work schedule
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            These hours define regular time, lateness, early leave, and when overtime starts.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FieldInput
            label="Shift starts"
            type="time"
            value={shiftStart}
            disabled={!canManage}
            onChange={setShiftStart}
          />
          <FieldInput
            label="Shift ends"
            type="time"
            value={shiftEnd}
            disabled={!canManage}
            onChange={setShiftEnd}
          />
          <FieldInput
            label="Late grace (minutes)"
            type="number"
            value={lateGrace}
            disabled={!canManage}
            onChange={(value) => setLateGrace(Number(value))}
          />
          <FieldInput
            label="Weekly early-leave allowance"
            type="number"
            value={earlyLeave}
            disabled={!canManage}
            onChange={(value) => setEarlyLeave(Number(value))}
          />
          <div className="md:col-span-2 xl:col-span-4">
            <Label>Working days</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, day) => (
                <label
                  key={label}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={workingDays.includes(day)}
                    disabled={!canManage}
                    onCheckedChange={(checked) =>
                      setWorkingDays((current) =>
                        checked
                          ? [...new Set([...current, day])].sort()
                          : current.filter((item) => item !== day),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Paid and unpaid breaks</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Breaks must remain inside the scheduled shift and are used by attendance and payroll.
            </p>
          </div>
          {canManage && (
            <Button
              variant="outline"
              onClick={() =>
                setBreaks((current) => [
                  ...current,
                  { name: "Break", start_time: "", end_time: "", paid: true },
                ])
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Add break
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {breaks.map((item, index) => (
            <div
              key={`${index}-${item.name}`}
              className="grid gap-3 rounded-xl border p-3 md:grid-cols-[1fr_160px_160px_auto_auto]"
            >
              <Input
                value={item.name}
                disabled={!canManage}
                placeholder="Break name"
                onChange={(event) =>
                  setBreaks((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, name: event.target.value } : row,
                    ),
                  )
                }
              />
              <Input
                type="time"
                value={item.start_time}
                disabled={!canManage}
                onChange={(event) =>
                  setBreaks((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, start_time: event.target.value } : row,
                    ),
                  )
                }
              />
              <Input
                type="time"
                value={item.end_time}
                disabled={!canManage}
                onChange={(event) =>
                  setBreaks((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, end_time: event.target.value } : row,
                    ),
                  )
                }
              />
              <label className="flex items-center gap-2 whitespace-nowrap text-sm">
                <Checkbox
                  checked={item.paid}
                  disabled={!canManage}
                  onCheckedChange={(checked) =>
                    setBreaks((current) =>
                      current.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, paid: checked === true } : row,
                      ),
                    )
                  }
                />
                {item.paid ? "Paid" : "Unpaid"}
              </label>
              {canManage && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    setBreaks((current) => current.filter((_, rowIndex) => rowIndex !== index))
                  }
                  aria-label="Remove break"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {breaks.length === 0 && (
            <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
              No scheduled breaks.
            </p>
          )}
        </CardContent>
      </Card>
      {canManage && (
        <div className="flex justify-end">
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            <Save className="mr-2 h-4 w-4" />
            Save schedule
          </Button>
        </div>
      )}
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  type,
  disabled,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type: "time" | "number";
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function RequestList({
  title,
  items,
}: {
  title: string;
  items: Array<{
    id: string;
    title: string;
    period: string;
    detail: string;
    status: string;
    reviewedBy?: string;
  }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold capitalize">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.period}</p>
              </div>
              <StatusBadge status={item.status as never} />
            </div>
            <p className="mt-2 text-sm">{item.detail}</p>
            {item.reviewedBy && (
              <p className="mt-2 text-xs text-muted-foreground">Reviewed by {item.reviewedBy}</p>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No requests in this section.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function EmployeePayrollSummary({
  entry,
  showAmounts,
  canManage,
  onSaved,
}: {
  entry: PayrollEntry;
  showAmounts: boolean;
  canManage: boolean;
  onSaved: () => Promise<void>;
}) {
  const [deductLateness, setDeductLateness] = useState(entry.deduct_lateness);
  const [latenessAmount, setLatenessAmount] = useState(String(entry.lateness_deduction_amount));
  const [latenessNote, setLatenessNote] = useState(entry.lateness_note ?? "");
  const [deductIdle, setDeductIdle] = useState(entry.deduct_idle);
  const [idleAmount, setIdleAmount] = useState(String(entry.idle_deduction_amount));
  const [idleNote, setIdleNote] = useState(entry.idle_note ?? "");
  const [overtimeDecision, setOvertimeDecision] = useState(entry.overtime_decision);
  const [overtimeMultiplier, setOvertimeMultiplier] = useState(String(entry.overtime_multiplier));
  const [overtimeNote, setOvertimeNote] = useState(entry.overtime_note ?? "");
  const [bonusAmount, setBonusAmount] = useState(String(entry.bonus_amount));
  const [deductionAmount, setDeductionAmount] = useState(String(entry.additional_deduction_amount));
  const [adjustmentNote, setAdjustmentNote] = useState(entry.adjustment_note ?? "");

  useEffect(() => {
    setDeductLateness(entry.deduct_lateness);
    setLatenessAmount(String(entry.lateness_deduction_amount));
    setLatenessNote(entry.lateness_note ?? "");
    setDeductIdle(entry.deduct_idle);
    setIdleAmount(String(entry.idle_deduction_amount));
    setIdleNote(entry.idle_note ?? "");
    setOvertimeDecision(entry.overtime_decision);
    setOvertimeMultiplier(String(entry.overtime_multiplier));
    setOvertimeNote(entry.overtime_note ?? "");
    setBonusAmount(String(entry.bonus_amount));
    setDeductionAmount(String(entry.additional_deduction_amount));
    setAdjustmentNote(entry.adjustment_note ?? "");
  }, [entry]);

  const save = useMutation({
    mutationFn: () =>
      updatePayrollEntry(entry.id, {
        deduct_lateness: deductLateness,
        lateness_deduction_amount: Number(latenessAmount) || 0,
        lateness_note: latenessNote,
        deduct_idle: deductIdle,
        idle_deduction_amount: Number(idleAmount) || 0,
        idle_note: idleNote,
        overtime_decision: overtimeDecision,
        overtime_multiplier: Number(overtimeMultiplier) || 1,
        overtime_note: overtimeNote,
        bonus_amount: Number(bonusAmount) || 0,
        additional_deduction_amount: Number(deductionAmount) || 0,
        adjustment_note: adjustmentNote,
      }),
    onSuccess: async () => {
      toast.success("Payroll decisions recalculated and saved.");
      await onSaved();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save payroll decisions."),
  });
  const editable = canManage && !["locked", "paid"].includes(entry.status);
  const money = (value: number) =>
    showAmounts
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: entry.currency,
          maximumFractionDigits: 2,
        }).format(value)
      : `•••••• ${entry.currency}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <CompactMetric label="Base salary" value={money(entry.base_salary)} />
        <CompactMetric label="Overtime pay" value={money(entry.overtime_amount)} />
        <CompactMetric label="Bonuses" value={money(entry.total_bonuses)} />
        <CompactMetric label="Deductions" value={money(entry.total_deductions)} />
        <CompactMetric label="Final salary" value={money(entry.final_salary)} emphasis />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Attendance-to-payroll calculation</CardTitle>
          <p className="text-sm text-muted-foreground">
            Recorded evidence stays separate from management decisions so pending or rejected time
            never changes pay silently.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CompactMetric label="Expected" value={formatSeconds(entry.expected_seconds)} />
          <CompactMetric label="Regular payable" value={formatSeconds(entry.normal_seconds)} />
          <CompactMetric
            label="Manual approved"
            value={formatSeconds(entry.approved_manual_seconds)}
          />
          <CompactMetric
            label="Manual pending"
            value={formatSeconds(entry.pending_manual_seconds)}
          />
          <CompactMetric label="Paid breaks" value={formatSeconds(entry.paid_break_seconds)} />
          <CompactMetric label="Idle" value={formatSeconds(entry.idle_seconds)} />
          <CompactMetric label="Late" value={`${entry.late_minutes}m`} />
          <CompactMetric
            label="Overtime"
            value={`${formatSeconds(entry.recorded_overtime_seconds)} recorded · ${formatSeconds(
              entry.approved_overtime_seconds,
            )} approved`}
          />
        </CardContent>
      </Card>
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>HR payroll decisions</CardTitle>
            <p className="text-sm text-muted-foreground">
              Evidence is shown above. These explicit decisions determine deductions, overtime
              payment, and the final salary. Locked and paid runs are immutable.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-3">
              <PayrollDecisionBox
                title={`Lateness · ${entry.late_minutes}m`}
                checked={deductLateness}
                onChecked={setDeductLateness}
                amount={latenessAmount}
                onAmount={setLatenessAmount}
                note={latenessNote}
                onNote={setLatenessNote}
                disabled={!editable}
              />
              <PayrollDecisionBox
                title={`Idle · ${formatSeconds(entry.idle_seconds)}`}
                checked={deductIdle}
                onChecked={setDeductIdle}
                amount={idleAmount}
                onAmount={setIdleAmount}
                note={idleNote}
                onNote={setIdleNote}
                disabled={!editable}
              />
              <div className="space-y-3 rounded-xl border p-4">
                <p className="font-semibold">
                  Overtime · {formatSeconds(entry.recorded_overtime_seconds)}
                </p>
                <div className="space-y-1.5">
                  <Label>Decision</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={overtimeDecision}
                    disabled={!editable}
                    onChange={(event) =>
                      setOvertimeDecision(event.target.value as "pending" | "paid" | "rejected")
                    }
                  >
                    <option value="pending">Pending — record only</option>
                    <option value="paid">Approve and pay</option>
                    <option value="rejected">Reject payment</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Rate multiplier</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.25}
                    value={overtimeMultiplier}
                    disabled={!editable}
                    onChange={(event) => setOvertimeMultiplier(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Decision note</Label>
                  <Input
                    value={overtimeNote}
                    disabled={!editable}
                    placeholder="Required when paying or rejecting"
                    onChange={(event) => setOvertimeNote(event.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Bonus</Label>
                <Input
                  type="number"
                  min={0}
                  value={bonusAmount}
                  disabled={!editable}
                  onChange={(event) => setBonusAmount(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Additional deduction</Label>
                <Input
                  type="number"
                  min={0}
                  value={deductionAmount}
                  disabled={!editable}
                  onChange={(event) => setDeductionAmount(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Adjustment reason</Label>
                <Input
                  value={adjustmentNote}
                  disabled={!editable}
                  placeholder="Required when adding a deduction"
                  onChange={(event) => setAdjustmentNote(event.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button loading={save.isPending} disabled={!editable} onClick={() => save.mutate()}>
                <Save className="mr-2 h-4 w-4" />
                Save and recalculate
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PayrollDecisionBox({
  title,
  checked,
  onChecked,
  amount,
  onAmount,
  note,
  onNote,
  disabled,
}: {
  title: string;
  checked: boolean;
  onChecked: (value: boolean) => void;
  amount: string;
  onAmount: (value: string) => void;
  note: string;
  onNote: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <label className="flex items-center justify-between gap-3 font-semibold">
        <span>{title}</span>
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onChecked(value === true)}
        />
      </label>
      <div className="space-y-1.5">
        <Label>Deduction amount</Label>
        <Input
          type="number"
          min={0}
          value={amount}
          disabled={disabled || !checked}
          onChange={(event) => onAmount(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Reason</Label>
        <Input
          value={note}
          disabled={disabled || !checked}
          placeholder="Required when amount is greater than zero"
          onChange={(event) => onNote(event.target.value)}
        />
      </div>
    </div>
  );
}

function CompactMetric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${emphasis ? "border-primary bg-primary/5" : "bg-card"}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const end = `${year}-${String(monthNumber).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.round(value || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatClock(value?: string | null, timezone?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone || undefined,
  }).format(new Date(value));
}

function toTimeInput(value?: string | null, timezone?: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone || undefined,
  }).formatToParts(new Date(value));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function minutesBetween(start: string, end: string) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let difference = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (difference <= 0) difference += 24 * 60;
  return difference;
}

function downloadAttendanceCsv(data: EmployeeAttendanceRange) {
  const cells = (values: Array<string | number>) =>
    values.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",");
  const header = cells([
    "Date",
    "Status",
    "Scheduled start",
    "Scheduled end",
    "Actual start",
    "Actual end",
    "Normal seconds",
    "Idle seconds",
    "Approved manual seconds",
    "Late seconds",
    "Recorded overtime seconds",
    "Approved overtime seconds",
    "Total payable seconds",
    "Screenshots",
  ]);
  const rows = data.rows.map((row) =>
    cells([
      row.date,
      row.status,
      row.scheduledStartAt ?? "",
      row.scheduledEndAt ?? "",
      row.actualFirstActivityAt ?? "",
      row.actualLastActivityAt ?? "",
      row.normalWorkedSeconds,
      row.idleSeconds,
      row.approvedManualSeconds,
      row.deductibleLateSeconds,
      row.recordedOvertimeSeconds,
      row.approvedOvertimeSeconds,
      row.totalPayableSeconds,
      row.screenshotCount,
    ]),
  );
  const blob = new Blob([`\uFEFF${[header, ...rows].join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${data.employeeName}-${data.startDate}-${data.endDate}-attendance.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function summarizeAuditDetails(details: Record<string, unknown>) {
  const compact = JSON.stringify(details);
  if (compact === "{}") return "No additional context.";
  return compact.length > 260 ? `${compact.slice(0, 257)}…` : compact;
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
