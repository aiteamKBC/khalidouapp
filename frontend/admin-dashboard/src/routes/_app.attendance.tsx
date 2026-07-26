import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  Clock3,
  ListChecks,
  Loader2,
  MonitorCheck,
  TimerReset,
  Users,
} from "lucide-react";

import { getDailyAttendance, listDailyAttendance } from "@/api/attendance";
import { listTeams } from "@/api/teams";
import { EmployeeAttendanceHistoryDialog } from "@/components/attendance/employee-attendance-history-dialog";
import { WorkdayTimeline } from "@/components/workday-timeline";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/attendance")({ component: AttendancePage });

const today = () => new Date().toLocaleDateString("en-CA");
const thirtyDaysAgo = () => {
  const value = new Date();
  value.setDate(value.getDate() - 29);
  return value.toLocaleDateString("en-CA");
};
const duration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};
const clock = (value: string | null | undefined, timezone: string) =>
  value
    ? new Intl.DateTimeFormat([], {
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      }).format(new Date(value))
    : "—";

function AttendancePage() {
  const { scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const [activeTab, setActiveTab] = useState<"daily" | "employee-history">("daily");
  const [day, setDay] = useState(today());
  const [teamId, setTeamId] = useState("all");
  const [status, setStatus] = useState("all");
  const [issue, setIssue] = useState<
    "all" | "late" | "missing_check_in" | "overtime" | "idle" | "leave"
  >("all");
  const [q, setQ] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [historyStartDate, setHistoryStartDate] = useState(thirtyDaysAgo());
  const [historyEndDate, setHistoryEndDate] = useState(today());
  const [historyTeamId, setHistoryTeamId] = useState("all");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyEmployee, setHistoryEmployee] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });
  const attendance = useQuery({
    queryKey: ["daily-attendance", day, teamId, status, issue, q],
    queryFn: () => listDailyAttendance({ day, teamId, status, issue, q }),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
  const detail = useQuery({
    queryKey: ["daily-attendance-detail", selectedEmployeeId, day],
    queryFn: () => getDailyAttendance(selectedEmployeeId!, day),
    enabled: Boolean(selectedEmployeeId),
    refetchInterval: selectedEmployeeId ? 15_000 : false,
  });
  const historyRoster = useQuery({
    queryKey: ["attendance-employee-history-roster", historyEndDate, historyTeamId, historyQuery],
    queryFn: () =>
      listDailyAttendance({
        day: historyEndDate,
        teamId: historyTeamId,
        status: "all",
        issue: "all",
        q: historyQuery,
      }),
    enabled: activeTab === "employee-history" && Boolean(historyEndDate),
    refetchInterval: activeTab === "employee-history" ? 30_000 : false,
    placeholderData: (previous) => previous,
  });
  const rows = attendance.data ?? [];
  const historyRows = historyRoster.data ?? [];
  const historyRangeDays =
    historyStartDate && historyEndDate
      ? Math.floor(
          (Date.parse(`${historyEndDate}T00:00:00Z`) -
            Date.parse(`${historyStartDate}T00:00:00Z`)) /
            86_400_000,
        ) + 1
      : 0;
  const invalidHistoryRange = historyRangeDays < 1 || historyRangeDays > 62;
  const summary = rows.reduce(
    (total, row) => ({
      present: total.present + (row.status === "present" ? 1 : 0),
      issues: total.issues + (row.issues.length ? 1 : 0),
      worked: total.worked + row.normalWorkedSeconds,
      overtime: total.overtime + row.recordedOvertimeSeconds,
    }),
    { present: 0, issues: 0, worked: 0, overtime: 0 },
  );

  return (
    <div className="studio-page">
      <PageHeader
        title="Attendance"
        description="Review a single workday or open each employee's full attendance history."
      />
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "daily" | "employee-history")}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="daily">
            <ListChecks className="mr-2 h-4 w-4" />
            Daily overview
          </TabsTrigger>
          <TabsTrigger value="employee-history">
            <Users className="mr-2 h-4 w-4" />
            Employee history
          </TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-0">
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              icon={CalendarCheck2}
              label="Present"
              value={`${summary.present} / ${rows.length}`}
            />
            <Metric icon={AlertTriangle} label="Need review" value={summary.issues} tone="amber" />
            <Metric
              icon={Clock3}
              label="Normal worked"
              value={duration(summary.worked)}
              tone="green"
            />
            <Metric
              icon={TimerReset}
              label="Recorded overtime"
              value={duration(summary.overtime)}
              tone="violet"
            />
          </div>
          <Card className="mb-4 p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
              <Input
                placeholder="Search employee…"
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger>
                  <SelectValue />
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
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="present">Present</SelectItem>
                  <SelectItem value="late">Late</SelectItem>
                  <SelectItem value="left_early">Left early</SelectItem>
                  <SelectItem value="not_started">Not started</SelectItem>
                  <SelectItem value="absent">Absent</SelectItem>
                  <SelectItem value="approved_leave">Approved leave</SelectItem>
                </SelectContent>
              </Select>
              <Select value={issue} onValueChange={(value) => setIssue(value as typeof issue)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All signals</SelectItem>
                  <SelectItem value="late">Late employees</SelectItem>
                  <SelectItem value="missing_check_in">Missing check-in</SelectItem>
                  <SelectItem value="overtime">Recorded overtime</SelectItem>
                  <SelectItem value="idle">Unexplained idle</SelectItem>
                  <SelectItem value="leave">On leave</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => {
                  setTeamId("all");
                  setStatus("all");
                  setIssue("all");
                  setQ("");
                  setDay(today());
                }}
              >
                Reset filters
              </Button>
            </div>
          </Card>
          <Card className="overflow-hidden [&>div]:max-h-[70vh] [&>div]:overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_th]:bg-card">
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>First / last / sign-out</TableHead>
                  <TableHead>Normal</TableHead>
                  <TableHead>Paid break</TableHead>
                  <TableHead>Idle</TableHead>
                  <TableHead>Late</TableHead>
                  <TableHead>Early leave</TableHead>
                  <TableHead>Extra</TableHead>
                  <TableHead>Manual</TableHead>
                  <TableHead>Payable</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.isLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={13}>
                          <div className="h-10 animate-pulse rounded bg-muted" />
                        </TableCell>
                      </TableRow>
                    ))
                  : rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <p className="font-bold">{row.employeeName}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.teamNames.join(", ") || row.jobTitle || "No team"}
                          </p>
                        </TableCell>
                        <TableCell className="text-xs">
                          {clock(row.scheduledStartAt, row.timezone)} –{" "}
                          {clock(row.scheduledEndAt, row.timezone)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {clock(row.actualFirstActivityAt, row.timezone)} –{" "}
                          {clock(row.actualLastActivityAt, row.timezone)}
                          <span
                            className={`block text-[10px] ${
                              row.isRunning
                                ? "font-semibold text-emerald-700"
                                : "text-muted-foreground"
                            }`}
                          >
                            Sign-out{" "}
                            {row.isRunning
                              ? "In progress"
                              : clock(row.actualSignOutAt, row.timezone)}
                          </span>
                        </TableCell>
                        <TableCell>{duration(row.normalWorkedSeconds)}</TableCell>
                        <TableCell>{duration(row.paidBreakSeconds)}</TableCell>
                        <TableCell>{duration(row.idleSeconds)}</TableCell>
                        <TableCell>
                          {duration(row.deductibleLateSeconds)}
                          <span className="block text-[10px] text-muted-foreground">
                            {duration(row.rawLateSeconds)} from shift start
                          </span>
                        </TableCell>
                        <TableCell>{duration(row.earlyLeaveSeconds)}</TableCell>
                        <TableCell>
                          {duration(row.recordedOvertimeSeconds)}
                          <span className="block text-[10px] text-muted-foreground">
                            {duration(row.approvedOvertimeSeconds)} approved
                          </span>
                        </TableCell>
                        <TableCell>
                          {duration(row.approvedManualSeconds)}
                          {row.pendingManualSeconds > 0 && (
                            <span className="block text-[10px] text-amber-700">
                              {duration(row.pendingManualSeconds)} pending
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-bold">
                          {duration(row.totalPayableSeconds)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedEmployeeId(row.employeeId)}
                            >
                              Details
                            </Button>
                            <Button type="button" size="sm" variant="outline" asChild>
                              <Link
                                to="/monitoring"
                                search={{
                                  employeeId: row.employeeId,
                                  day,
                                  tab: "attendance",
                                }}
                              >
                                <MonitorCheck className="mr-1 h-4 w-4" />
                                Monitor
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                {!attendance.isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="py-12 text-center text-muted-foreground">
                      No attendance rows match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="employee-history" className="mt-0 space-y-4">
          <Card className="p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <div>
                <p className="mb-1 text-xs font-bold text-muted-foreground">From</p>
                <Input
                  type="date"
                  value={historyStartDate}
                  max={historyEndDate}
                  onChange={(event) => setHistoryStartDate(event.target.value)}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-bold text-muted-foreground">Through</p>
                <Input
                  type="date"
                  value={historyEndDate}
                  min={historyStartDate}
                  max={today()}
                  onChange={(event) => setHistoryEndDate(event.target.value)}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-bold text-muted-foreground">Employee</p>
                <Input
                  placeholder="Search employee…"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-bold text-muted-foreground">Team</p>
                <Select value={historyTeamId} onValueChange={setHistoryTeamId}>
                  <SelectTrigger>
                    <SelectValue />
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
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    setHistoryStartDate(thirtyDaysAgo());
                    setHistoryEndDate(today());
                    setHistoryTeamId("all");
                    setHistoryQuery("");
                  }}
                >
                  Reset filters
                </Button>
              </div>
              <div className="flex items-end">
                <div
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${
                    invalidHistoryRange
                      ? "border-destructive/40 bg-destructive/5 text-destructive"
                      : "bg-muted/30 text-muted-foreground"
                  }`}
                >
                  <span className="block text-xs font-bold">Selected period</span>
                  {historyRangeDays > 0 ? `${historyRangeDays} days` : "Choose valid dates"}
                  {historyRangeDays > 62 && (
                    <span className="block text-[10px]">Maximum is 62 days.</span>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden [&>div]:max-h-[70vh] [&>div]:overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_th]:bg-card">
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Team / job title</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Latest status</TableHead>
                  <TableHead>Latest sign-out</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyRoster.isLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={6}>
                          <div className="h-10 animate-pulse rounded bg-muted" />
                        </TableCell>
                      </TableRow>
                    ))
                  : historyRows.map((row) => (
                      <TableRow key={row.employeeId}>
                        <TableCell>
                          <p className="font-bold">{row.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{row.employeeEmail}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">{row.teamNames.join(", ") || "No team"}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.jobTitle || "No job title"}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          <CalendarDays className="mr-1 inline h-4 w-4" />
                          {historyStartDate} – {historyEndDate}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {row.isRunning ? "In progress" : clock(row.actualSignOutAt, row.timezone)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            disabled={invalidHistoryRange}
                            onClick={() =>
                              setHistoryEmployee({
                                id: row.employeeId,
                                name: row.employeeName,
                              })
                            }
                          >
                            View all days
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                {!historyRoster.isLoading && historyRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      No employees match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
      <Dialog
        open={Boolean(selectedEmployeeId)}
        onOpenChange={(open) => !open && setSelectedEmployeeId(null)}
      >
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-3 pr-7">
              <DialogTitle>
                {detail.data?.employeeName ?? "Attendance detail"} · {day}
              </DialogTitle>
              {selectedEmployeeId && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link
                      to="/monitoring"
                      search={{
                        employeeId: selectedEmployeeId,
                        day,
                        tab: "attendance",
                      }}
                    >
                      <MonitorCheck className="mr-1 h-4 w-4" />
                      Open employee monitoring
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>
          {detail.isLoading || (detail.isFetching && !detail.data) ? (
            <div
              className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-muted/20"
              role="status"
              aria-live="polite"
            >
              <div className="text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </span>
                <p className="mt-3 font-bold">Loading attendance details...</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Getting the employee's workday and timeline.
                </p>
              </div>
            </div>
          ) : detail.isError ? (
            <div className="grid min-h-64 place-items-center rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <div>
                <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
                <p className="mt-3 font-bold">Attendance details couldn't be loaded</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Check the connection and try again.
                </p>
                <Button className="mt-4" type="button" onClick={() => detail.refetch()}>
                  Retry
                </Button>
              </div>
            </div>
          ) : detail.data ? (
            <>
              {detail.isFetching && (
                <div
                  className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-xs font-semibold text-primary"
                  role="status"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Refreshing attendance...
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Small
                  label="Started"
                  value={clock(detail.data.actualFirstActivityAt, detail.data.timezone)}
                />
                <Small
                  label="Last activity"
                  value={clock(detail.data.actualLastActivityAt, detail.data.timezone)}
                />
                <Small
                  label="Signed out"
                  value={
                    detail.data.isRunning
                      ? "In progress"
                      : clock(detail.data.actualSignOutAt, detail.data.timezone)
                  }
                />
                <Small label="Paid breaks" value={duration(detail.data.paidBreakSeconds)} />
                <Small label="Unpaid breaks" value={duration(detail.data.unpaidBreakSeconds)} />
                <Small
                  label="Manual approved"
                  value={duration(detail.data.approvedManualSeconds)}
                />
                <Small label="Before shift" value={duration(detail.data.preShiftExtraSeconds)} />
                <Small label="After shift" value={duration(detail.data.postShiftExtraSeconds)} />
                <Small label="Payable" value={duration(detail.data.totalPayableSeconds)} />
              </div>
              <WorkdayTimeline timeline={detail.data.timeline} />
            </>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No attendance details are available.
            </div>
          )}
        </DialogContent>
      </Dialog>
      <EmployeeAttendanceHistoryDialog
        employeeId={historyEmployee?.id ?? null}
        employeeName={historyEmployee?.name}
        startDate={historyStartDate}
        endDate={historyEndDate}
        open={Boolean(historyEmployee)}
        onOpenChange={(open) => !open && setHistoryEmployee(null)}
      />
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "blue",
}: {
  icon: typeof Clock3;
  label: string;
  value: string | number;
  tone?: "blue" | "green" | "amber" | "violet";
}) {
  const colors = {
    blue: "bg-blue-500/10 text-blue-600",
    green: "bg-emerald-500/10 text-emerald-600",
    amber: "bg-amber-500/10 text-amber-700",
    violet: "bg-violet-500/10 text-violet-600",
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`grid h-10 w-10 place-items-center rounded-lg ${colors[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-2xl font-extrabold">{value}</p>
        <p className="text-xs font-bold text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}
function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono font-bold">{value}</p>
    </div>
  );
}
