import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  AppWindow,
  CalendarCheck2,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  ImageOff,
  Images,
  MonitorCheck,
} from "lucide-react";
import { toast } from "sonner";

import { getDailyAttendance, type DailyAttendance } from "@/api/attendance";
import { listEmployees } from "@/api/employees";
import { downloadScreenshot, listScreenshotPage } from "@/api/screenshots";
import { ApplicationHistoryPanel } from "@/components/application-history-panel";
import { ProtectedImage } from "@/components/ProtectedImage";
import { WorkdayTimeline } from "@/components/workday-timeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { formatClock, formatDateTime } from "@/lib/format";
import { permissions } from "@/lib/permissions";
import type { Screenshot } from "@/types";

type MonitoringTab = "attendance" | "screenshots" | "applications";

export const Route = createFileRoute("/_app/monitoring")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    employeeId?: string;
    day?: string;
    tab?: MonitoringTab;
  } => ({
    employeeId:
      typeof search.employeeId === "string" && search.employeeId ? search.employeeId : undefined,
    day: isIsoDay(search.day) ? search.day : undefined,
    tab: isMonitoringTab(search.tab) ? search.tab : undefined,
  }),
  component: EmployeeMonitoringPage,
});

function EmployeeMonitoringPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { scopedTeamIds, can } = useAuth();
  const scope = scopedTeamIds();
  const canViewScreenshots = can(permissions.screenshotsView);
  const employees = useQuery({
    queryKey: ["employees", scope],
    queryFn: () => listEmployees(scope),
    staleTime: 30_000,
  });
  const requestedEmployeeExists =
    Boolean(search.employeeId) &&
    employees.data?.some((employee) => employee.id === search.employeeId);
  const employeeId = employees.data
    ? requestedEmployeeExists
      ? search.employeeId!
      : (employees.data[0]?.id ?? "")
    : (search.employeeId ?? "");
  const day = search.day ?? todayIsoDate();
  const tab =
    search.tab === "screenshots" && !canViewScreenshots
      ? "attendance"
      : (search.tab ?? "attendance");
  const selectedEmployee = employees.data?.find((employee) => employee.id === employeeId);

  useEffect(() => {
    if (
      employees.data?.length &&
      (search.employeeId !== employeeId || search.day !== day || search.tab !== tab)
    ) {
      void navigate({
        search: { employeeId, day, tab },
        replace: true,
      });
    }
  }, [day, employeeId, employees.data, navigate, search.day, search.employeeId, search.tab, tab]);

  const updateSearch = (next: Partial<{ employeeId: string; day: string; tab: MonitoringTab }>) => {
    void navigate({
      search: {
        employeeId: next.employeeId ?? employeeId,
        day: next.day ?? day,
        tab: next.tab ?? tab,
      },
      replace: true,
    });
  };

  return (
    <div className="studio-page">
      <PageHeader
        title="Employee monitoring"
        description="Daily attendance, screenshots, and application activity in one employee view."
        actions={
          selectedEmployee && (
            <Button variant="outline" asChild>
              <Link to="/employees/$employeeId" params={{ employeeId: selectedEmployee.id }}>
                Employee profile
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          )
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-4 p-4 md:grid-cols-[minmax(240px,1fr)_220px] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="monitoring-employee">Employee</Label>
            <Select
              value={employeeId}
              onValueChange={(value) => updateSearch({ employeeId: value })}
            >
              <SelectTrigger id="monitoring-employee">
                <SelectValue
                  placeholder={employees.isLoading ? "Loading employees..." : "Choose an employee"}
                />
              </SelectTrigger>
              <SelectContent>
                {(employees.data ?? []).map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                    {employee.jobTitle ? ` · ${employee.jobTitle}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="monitoring-day">Workday</Label>
            <Input
              id="monitoring-day"
              type="date"
              value={day}
              onChange={(event) => updateSearch({ day: event.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {!employeeId ? (
        <EmptyState
          icon={MonitorCheck}
          title={employees.isLoading ? "Loading employees..." : "No employee available"}
          description={
            employees.isLoading
              ? "The employee directory is loading."
              : "Add an employee before opening daily monitoring."
          }
        />
      ) : (
        <Tabs value={tab} onValueChange={(value) => updateSearch({ tab: value as MonitoringTab })}>
          <TabsList className="mb-4 h-auto w-full justify-start overflow-x-auto p-1.5 sm:w-auto">
            <TabsTrigger value="attendance" className="gap-2 py-2">
              <CalendarCheck2 className="h-4 w-4" />
              Daily attendance
            </TabsTrigger>
            {canViewScreenshots && (
              <TabsTrigger value="screenshots" className="gap-2 py-2">
                <Camera className="h-4 w-4" />
                Screenshots
              </TabsTrigger>
            )}
            <TabsTrigger value="applications" className="gap-2 py-2">
              <AppWindow className="h-4 w-4" />
              Apps & websites
            </TabsTrigger>
          </TabsList>

          <TabsContent value="attendance" className="mt-0">
            <DailyAttendanceTab employeeId={employeeId} day={day} enabled={tab === "attendance"} />
          </TabsContent>
          {canViewScreenshots && (
            <TabsContent value="screenshots" className="mt-0">
              <ScreenshotsTab
                employeeId={employeeId}
                employeeName={selectedEmployee?.name ?? "Employee"}
                day={day}
                scope={scope}
                enabled={tab === "screenshots"}
              />
            </TabsContent>
          )}
          <TabsContent value="applications" className="mt-0">
            <ApplicationHistoryPanel
              employeeId={employeeId}
              day={day}
              onDayChange={(value) => updateSearch({ day: value })}
              showDayPicker={false}
              enabled={tab === "applications"}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function DailyAttendanceTab({
  employeeId,
  day,
  enabled,
}: {
  employeeId: string;
  day: string;
  enabled: boolean;
}) {
  const attendance = useQuery({
    queryKey: ["daily-attendance", employeeId, day],
    queryFn: () => getDailyAttendance(employeeId, day),
    enabled: enabled && Boolean(employeeId && day),
    staleTime: 30_000,
    refetchInterval: enabled ? 30_000 : false,
  });

  if (attendance.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (attendance.isError) {
    return (
      <EmptyState
        icon={CalendarCheck2}
        title="Attendance couldn't be loaded"
        description="Check the connection and try this employee and workday again."
        action={<Button onClick={() => attendance.refetch()}>Retry</Button>}
      />
    );
  }

  if (!attendance.data) {
    return (
      <EmptyState
        icon={CalendarCheck2}
        title="No attendance for this day"
        description="There is no daily attendance record for the selected employee."
      />
    );
  }

  const row = attendance.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold">{row.employeeName}</p>
              <StatusBadge status={row.status} />
              {row.isRunning && (
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  Tracking now
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {row.jobTitle || "No job title"} · {row.teamNames.join(", ") || "No team"} ·{" "}
              {row.timezone}
            </p>
          </div>
          <p className="text-sm font-semibold text-muted-foreground">{row.date}</p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AttendanceMetric
          label="Scheduled shift"
          value={`${formatClock(row.scheduledStartAt, row.timezone)} – ${formatClock(row.scheduledEndAt, row.timezone)}`}
        />
        <AttendanceMetric
          label="First activity"
          value={formatClock(row.actualFirstActivityAt, row.timezone)}
        />
        <AttendanceMetric
          label="Last activity"
          value={formatClock(row.actualLastActivityAt, row.timezone)}
        />
        <AttendanceMetric
          label="Sign-out"
          value={row.isRunning ? "Open until now" : formatClock(row.actualSignOutAt, row.timezone)}
        />
        <AttendanceMetric label="Normal worked" value={duration(row.normalWorkedSeconds)} />
        <AttendanceMetric label="Idle" value={duration(row.idleSeconds)} tone="warning" />
        <AttendanceMetric
          label="Payable"
          value={duration(row.totalPayableSeconds)}
          tone="success"
        />
        <AttendanceMetric label="Approved overtime" value={duration(row.approvedOvertimeSeconds)} />
        <AttendanceMetric label="Screenshots" value={String(row.screenshotCount)} />
      </div>

      {(row.issues.length > 0 ||
        row.pendingManualSeconds > 0 ||
        row.unapprovedOvertimeSeconds > 0) && <AttendanceNotices attendance={row} />}

      <Card>
        <CardHeader>
          <CardTitle>Workday timeline</CardTitle>
          <p className="text-sm text-muted-foreground">
            Worked, idle, locked, and sleeping periods recorded during this workday.
          </p>
        </CardHeader>
        <CardContent>
          <WorkdayTimeline timeline={row.timeline} />
        </CardContent>
      </Card>
    </div>
  );
}

function AttendanceNotices({ attendance }: { attendance: DailyAttendance }) {
  return (
    <Card className="border-amber-300/60 bg-amber-50/55 dark:bg-amber-950/15">
      <CardContent className="flex flex-wrap gap-2 p-4">
        {attendance.issues.map((issue) => (
          <span
            key={`${issue.code}-${issue.seconds ?? 0}`}
            className="rounded-full bg-amber-200/60 px-2.5 py-1 text-xs font-bold text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
          >
            {issue.code.replaceAll("_", " ")}
            {issue.seconds ? ` · ${duration(issue.seconds)}` : ""}
          </span>
        ))}
        {attendance.pendingManualSeconds > 0 && (
          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
            Pending manual time · {duration(attendance.pendingManualSeconds)}
          </span>
        )}
        {attendance.unapprovedOvertimeSeconds > 0 && (
          <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800 dark:bg-orange-950/50 dark:text-orange-200">
            Unapproved overtime · {duration(attendance.unapprovedOvertimeSeconds)}
          </span>
        )}
      </CardContent>
    </Card>
  );
}

function AttendanceMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning" | "success";
}) {
  const valueClass =
    tone === "warning"
      ? "text-amber-700 dark:text-amber-300"
      : tone === "success"
        ? "text-emerald-700 dark:text-emerald-300"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-2 text-xl font-extrabold ${valueClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function ScreenshotsTab({
  employeeId,
  employeeName,
  day,
  scope,
  enabled,
}: {
  employeeId: string;
  employeeName: string;
  day: string;
  scope?: string[];
  enabled: boolean;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Screenshot | null>(null);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const screenshots = useQuery({
    queryKey: ["monitoring-screenshots", scope, employeeId, day, page],
    queryFn: () =>
      listScreenshotPage({
        scopedTeamIds: scope,
        page,
        pageSize: 24,
        employeeId,
        day,
      }),
    enabled: enabled && Boolean(employeeId && day),
    staleTime: 30_000,
    refetchInterval: enabled ? 30_000 : false,
  });

  useEffect(() => {
    setPage(1);
    setSelected(null);
    setFailedIds(new Set());
  }, [day, employeeId]);

  const items = screenshots.data?.items ?? [];
  const selectedIndex = selected ? items.findIndex((item) => item.id === selected.id) : -1;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-bold">{employeeName}'s screenshots</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {screenshots.data?.total ?? 0} captures recorded on {day}.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/screenshots" search={{ employeeId, day }}>
              <Images className="mr-2 h-4 w-4" />
              Open screenshot library
            </Link>
          </Button>
        </CardContent>
      </Card>

      {screenshots.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="aspect-video animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : screenshots.isError ? (
        <EmptyState
          icon={ImageOff}
          title="Screenshots couldn't be loaded"
          description="Check the connection and try this employee and workday again."
          action={<Button onClick={() => screenshots.refetch()}>Retry</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Camera}
          title="No screenshots for this day"
          description="No captured screens were found for the selected employee and workday."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {items.map((shot) => (
            <button
              key={shot.id}
              type="button"
              onClick={() => setSelected(shot)}
              className="group overflow-hidden rounded-2xl border bg-card p-2 text-left transition duration-200 hover:-translate-y-1 hover:border-primary/25 hover:shadow-lg"
            >
              <span className="block aspect-video overflow-hidden rounded-xl bg-muted ring-1 ring-border">
                {failedIds.has(shot.id) ? (
                  <span className="grid h-full place-items-center text-muted-foreground">
                    <ImageOff className="h-6 w-6" />
                  </span>
                ) : (
                  <ProtectedImage
                    src={shot.thumbnailUrl}
                    alt={`Screenshot captured ${formatDateTime(shot.capturedAt)}`}
                    onLoadError={() => setFailedIds((previous) => new Set(previous).add(shot.id))}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                )}
              </span>
              <span className="flex items-center justify-between gap-2 px-1 pb-1 pt-3 text-xs">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {shot.displayName || "Captured screen"}
                  </span>
                  <span className="block truncate text-muted-foreground">
                    {formatDateTime(shot.capturedAt)}
                  </span>
                </span>
                <span className="shrink-0 capitalize text-muted-foreground">
                  {shot.workCategory.replaceAll("_", " ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {screenshots.data && screenshots.data.pages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {screenshots.data.page} of {screenshots.data.pages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || screenshots.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= screenshots.data.pages || screenshots.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-5xl">
          <DialogTitle className="sr-only">Screenshot preview</DialogTitle>
          {selected && (
            <div>
              <ProtectedImage
                src={selected.fullUrl}
                alt={`Screenshot captured ${formatDateTime(selected.capturedAt)}`}
                eager
                className="max-h-[72vh] w-full rounded-xl object-contain ring-1 ring-border"
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{employeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(selected.capturedAt)}
                    {selected.displayName ? ` · ${selected.displayName}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedIndex <= 0}
                    onClick={() => setSelected(items[selectedIndex - 1])}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedIndex < 0 || selectedIndex >= items.length - 1}
                    onClick={() => setSelected(items[selectedIndex + 1])}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadScreenshot(selected).catch((error) =>
                        toast.error(error instanceof Error ? error.message : "Download failed"),
                      )
                    }
                  >
                    <Download className="mr-1 h-4 w-4" />
                    Download
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function isMonitoringTab(value: unknown): value is MonitoringTab {
  return value === "attendance" || value === "screenshots" || value === "applications";
}

function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayIsoDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function duration(value: number) {
  const seconds = Math.max(0, Math.round(value || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
