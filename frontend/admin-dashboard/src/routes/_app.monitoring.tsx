import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import {
  AppWindow,
  CalendarCheck2,
  Camera,
  Check,
  ExternalLink,
  Search,
  Users,
} from "lucide-react";

import { getDailyAttendance, type DailyAttendance } from "@/api/attendance";
import { retryTransientRequest } from "@/api/client";
import { employeeDisplayStatus, listMonitoringEmployees } from "@/api/employees";
import { listMonitoringTeams } from "@/api/teams";
import { WorkdayTimeline } from "@/components/workday-timeline";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatAttendanceStart, formatClock } from "@/lib/format";
import { permissions } from "@/lib/permissions";
import {
  monitoringDetailEnabled,
  monitoringDetailPolicy,
  monitoringDetailQueryKey,
  monitoringRosterQueryKey,
  monitoringScopeKey,
} from "@/lib/monitoring-query-policy";
import { cn } from "@/lib/utils";
import type { Employee } from "@/types";

type MonitoringTab = "attendance" | "screenshots" | "applications";
type MonitoringEmployeeStatus =
  | "all"
  | "active"
  | "idle"
  | "locked"
  | "sleeping"
  | "on_break"
  | "break_work"
  | "off_shift"
  | "offline"
  | "invited"
  | "app_pending"
  | "inactive";

const LazyScreenshotsTab = lazy(() => import("@/components/monitoring-screenshots-tab"));
const LazyApplicationHistoryPanel = lazy(() =>
  import("@/components/application-history-panel").then((module) => ({
    default: module.ApplicationHistoryPanel,
  })),
);

export const Route = createFileRoute("/_app/monitoring")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    employeeId?: string;
    day?: string;
    tab?: MonitoringTab;
    q?: string;
    team?: string;
    status?: MonitoringEmployeeStatus;
  } => ({
    employeeId:
      typeof search.employeeId === "string" && search.employeeId ? search.employeeId : undefined,
    day: isIsoDay(search.day) ? search.day : undefined,
    tab: isMonitoringTab(search.tab) ? search.tab : undefined,
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    team: typeof search.team === "string" && search.team ? search.team : undefined,
    status: isMonitoringEmployeeStatus(search.status) ? search.status : undefined,
  }),
  component: EmployeeMonitoringPage,
});

function EmployeeMonitoringPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { scopedTeamIds, can, user } = useAuth();
  const scope = scopedTeamIds();
  const queryScopeKey = useMemo(() => monitoringScopeKey(user?.id, scope), [scope, user?.id]);
  const canViewScreenshots = can(permissions.screenshotsView);
  const employees = useQuery({
    queryKey: monitoringRosterQueryKey("employees", queryScopeKey),
    queryFn: ({ signal }) => listMonitoringEmployees(scope, signal),
    enabled: Boolean(user),
    staleTime: 20_000,
    gcTime: 10 * 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    retry: retryTransientRequest,
  });
  const teams = useQuery({
    queryKey: monitoringRosterQueryKey("teams", queryScopeKey),
    queryFn: ({ signal }) => listMonitoringTeams(scope, signal),
    enabled: Boolean(user),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: retryTransientRequest,
  });
  const requestedEmployeeExists =
    Boolean(search.employeeId) &&
    employees.data?.some((employee) => employee.id === search.employeeId);
  const employeeId = employees.data
    ? requestedEmployeeExists
      ? search.employeeId!
      : ""
    : (search.employeeId ?? "");
  const day = search.day ?? todayIsoDate();
  const tab =
    search.tab === "screenshots" && !canViewScreenshots
      ? "attendance"
      : (search.tab ?? "attendance");
  const query = search.q ?? "";
  const deferredQuery = useDeferredValue(query);
  const team = search.team ?? "all";
  const status = search.status ?? "all";
  const selectedEmployee = employees.data?.find((employee) => employee.id === employeeId);
  const teamNames = useMemo(
    () => new Map((teams.data ?? []).map((item) => [item.id, item.name])),
    [teams.data],
  );
  const teamEmployees = useMemo(
    () =>
      (employees.data ?? []).filter(
        (employee) => team === "all" || employee.teamIds.includes(team),
      ),
    [employees.data, team],
  );
  const filteredEmployees = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return teamEmployees.filter((employee) => {
      if (
        needle &&
        !`${employee.name} ${employee.email} ${employee.code} ${employee.jobTitle}`
          .toLowerCase()
          .includes(needle)
      ) {
        return false;
      }
      if (status !== "all" && employeeDisplayStatus(employee) !== status) return false;
      return true;
    });
  }, [deferredQuery, status, teamEmployees]);

  useEffect(() => {
    if (
      employees.data &&
      (search.employeeId !== employeeId || search.day !== day || search.tab !== tab)
    ) {
      void navigate({
        search: {
          employeeId: employeeId || undefined,
          day,
          tab,
          q: query || undefined,
          team: team === "all" ? undefined : team,
          status: status === "all" ? undefined : status,
        },
        replace: true,
      });
    }
  }, [
    day,
    employeeId,
    employees.data,
    navigate,
    query,
    search.day,
    search.employeeId,
    search.tab,
    status,
    tab,
    team,
  ]);

  const updateSearch = useCallback(
    (
      next: Partial<{
        employeeId: string;
        day: string;
        tab: MonitoringTab;
        q: string;
        team: string;
        status: MonitoringEmployeeStatus;
      }>,
    ) => {
      const nextQuery = next.q ?? query;
      const nextTeam = next.team ?? team;
      const nextStatus = next.status ?? status;
      void navigate({
        search: {
          employeeId: (next.employeeId ?? employeeId) || undefined,
          day: next.day ?? day,
          tab: next.tab ?? tab,
          q: nextQuery || undefined,
          team: nextTeam === "all" ? undefined : nextTeam,
          status: nextStatus === "all" ? undefined : nextStatus,
        },
        replace: true,
      });
    },
    [day, employeeId, navigate, query, status, tab, team],
  );
  const updateTeam = useCallback(
    (nextTeam: string) => {
      const employeeBelongsToTeam =
        nextTeam === "all" || Boolean(selectedEmployee?.teamIds.includes(nextTeam));
      updateSearch({
        team: nextTeam,
        employeeId: employeeBelongsToTeam ? employeeId : "",
      });
    },
    [employeeId, selectedEmployee?.teamIds, updateSearch],
  );
  const selectEmployee = useCallback(
    (nextEmployeeId: string) => updateSearch({ employeeId: nextEmployeeId }),
    [updateSearch],
  );

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

      <Card className="mb-4 overflow-hidden">
        <CardContent className="p-4">
          <div className="grid gap-4 md:grid-cols-2 md:items-end xl:grid-cols-[240px_minmax(280px,1fr)_220px]">
            <div className="space-y-1.5">
              <Label htmlFor="monitoring-team">Team</Label>
              <Select value={team} onValueChange={updateTeam}>
                <SelectTrigger id="monitoring-team">
                  <SelectValue placeholder={teams.isLoading ? "Loading teams..." : "All teams"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {(teams.data ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {teams.isError && (
                <div className="flex items-center justify-between gap-2 text-xs text-rose-600">
                  <span>Teams couldn't be refreshed.</span>
                  <button
                    type="button"
                    className="font-bold underline"
                    onClick={() => teams.refetch()}
                  >
                    Retry
                  </button>
                </div>
              )}
              {teams.isLoading && <div className="h-3 w-24 animate-pulse rounded bg-muted" />}
              {!teams.isLoading && !teams.isError && teams.data?.length === 0 && (
                <p className="text-xs text-muted-foreground">No teams are available.</p>
              )}
              {teams.isFetching && teams.data && (
                <p className="text-xs font-semibold text-muted-foreground">Refreshing...</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="monitoring-employee">Employee</Label>
              <Select
                value={employeeId || undefined}
                onValueChange={(value) => updateSearch({ employeeId: value })}
              >
                <SelectTrigger id="monitoring-employee">
                  <SelectValue
                    placeholder={
                      employees.isLoading ? "Loading employees..." : "Choose an employee"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {teamEmployees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                      {employee.jobTitle ? ` · ${employee.jobTitle}` : ""}
                    </SelectItem>
                  ))}
                  {!employees.isLoading && teamEmployees.length === 0 && (
                    <SelectItem value="no-employees" disabled>
                      No employees in this team
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-1">
              <Label htmlFor="monitoring-day">Workday</Label>
              <Input
                id="monitoring-day"
                type="date"
                value={day}
                onChange={(event) => updateSearch({ day: event.target.value })}
              />
            </div>
          </div>

          <div className="mt-4 border-t pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold">Employees</p>
                  {employees.isFetching && employees.data && (
                    <span className="text-xs font-semibold text-muted-foreground">
                      Refreshing...
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Pick a person to open their attendance, screenshots, and app activity.
                </p>
              </div>
              {!employees.isLoading && (
                <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {filteredEmployees.length}{" "}
                  {filteredEmployees.length === 1 ? "employee" : "employees"}
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(240px,1fr)_220px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search employees"
                  placeholder="Search by name, email, code, or job title..."
                  value={query}
                  onChange={(event) => updateSearch({ q: event.target.value })}
                  className="pl-9"
                />
              </div>
              <Select
                value={status}
                onValueChange={(value) =>
                  updateSearch({ status: value as MonitoringEmployeeStatus })
                }
              >
                <SelectTrigger aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="idle">Idle</SelectItem>
                  <SelectItem value="locked">Locked</SelectItem>
                  <SelectItem value="sleeping">Sleeping</SelectItem>
                  <SelectItem value="on_break">On break</SelectItem>
                  <SelectItem value="break_work">Working during break</SelectItem>
                  <SelectItem value="off_shift">Off shift</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="invited">Invited</SelectItem>
                  <SelectItem value="app_pending">App pending</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="mt-3">
              {employees.isError && employees.data && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
                  <span>
                    The last status refresh failed. The previous statuses are still shown.
                  </span>
                  <Button variant="outline" size="sm" onClick={() => employees.refetch()}>
                    Retry
                  </Button>
                </div>
              )}
              {employees.isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="h-[88px] animate-pulse rounded-xl bg-muted" />
                  ))}
                </div>
              ) : employees.isError && !employees.data ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
                  <p className="text-sm text-muted-foreground">
                    Employees couldn't be loaded. Check the connection and try again.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => employees.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : employees.data?.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-dashed px-4 py-6 text-center">
                  <Users className="mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="text-sm font-bold">No employees available</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add an employee before opening daily monitoring.
                  </p>
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-dashed px-4 py-6 text-center">
                  <Users className="mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="text-sm font-bold">No employees match these filters</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try another search, team, or status.
                  </p>
                  {(query || team !== "all" || status !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => updateSearch({ q: "", team: "all", status: "all" })}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <MonitoringEmployeeStrip
                  employees={filteredEmployees}
                  teamNames={teamNames}
                  selectedEmployeeId={employeeId}
                  onSelect={selectEmployee}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {employeeId && (
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
            <DailyAttendanceTab
              employeeId={employeeId}
              day={day}
              queryScopeKey={queryScopeKey}
              enabled={tab === "attendance"}
            />
          </TabsContent>
          {canViewScreenshots && (
            <TabsContent value="screenshots" className="mt-0">
              <Suspense fallback={<TabSectionSkeleton cards={8} />}>
                <LazyScreenshotsTab
                  employeeId={employeeId}
                  employeeName={selectedEmployee?.name ?? "Employee"}
                  day={day}
                  scope={scope}
                  queryScopeKey={queryScopeKey}
                  enabled={tab === "screenshots"}
                />
              </Suspense>
            </TabsContent>
          )}
          <TabsContent value="applications" className="mt-0">
            <Suspense fallback={<TabSectionSkeleton cards={3} />}>
              <LazyApplicationHistoryPanel
                employeeId={employeeId}
                day={day}
                onDayChange={(value) => updateSearch({ day: value })}
                showDayPicker={false}
                queryScopeKey={queryScopeKey}
                enabled={tab === "applications"}
              />
            </Suspense>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

const MONITORING_CARD_WIDTH = 176;
const MONITORING_CARD_GAP = 8;
const MONITORING_CARD_STRIDE = MONITORING_CARD_WIDTH + MONITORING_CARD_GAP;
const MONITORING_VIRTUALIZE_AFTER = 60;
const MONITORING_OVERSCAN = 4;

function MonitoringEmployeeStrip({
  employees,
  teamNames,
  selectedEmployeeId,
  onSelect,
}: {
  employees: Employee[];
  teamNames: Map<string, string>;
  selectedEmployeeId: string;
  onSelect: (employeeId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 12 });
  const virtualized = employees.length > MONITORING_VIRTUALIZE_AFTER;

  const updateVisibleRange = useCallback(
    (element: HTMLDivElement) => {
      const start = Math.max(
        0,
        Math.floor(element.scrollLeft / MONITORING_CARD_STRIDE) - MONITORING_OVERSCAN,
      );
      const end = Math.min(
        employees.length,
        Math.ceil((element.scrollLeft + element.clientWidth) / MONITORING_CARD_STRIDE) +
          MONITORING_OVERSCAN,
      );
      setVisibleRange((current) =>
        current.start === start && current.end === end ? current : { start, end },
      );
    },
    [employees.length],
  );

  useEffect(() => {
    if (!virtualized) return;
    const element = containerRef.current;
    if (!element) return;
    updateVisibleRange(element);
    const observer = new ResizeObserver(() => updateVisibleRange(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, [updateVisibleRange, virtualized]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );

  useEffect(() => {
    if (!virtualized || !selectedEmployeeId) return;
    const selectedIndex = employees.findIndex((employee) => employee.id === selectedEmployeeId);
    const element = containerRef.current;
    if (
      selectedIndex >= 0 &&
      element &&
      (selectedIndex < visibleRange.start || selectedIndex >= visibleRange.end)
    ) {
      element.scrollTo({
        left: Math.max(0, selectedIndex * MONITORING_CARD_STRIDE - MONITORING_CARD_STRIDE),
        behavior: "smooth",
      });
    }
  }, [employees, selectedEmployeeId, virtualized, visibleRange.end, visibleRange.start]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = requestAnimationFrame(() => {
        updateVisibleRange(element);
        scrollFrame.current = null;
      });
    },
    [updateVisibleRange],
  );

  if (!virtualized) {
    return (
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 pt-1">
        {employees.map((employee) => (
          <MonitoringEmployeeCard
            key={employee.id}
            employee={employee}
            teamNames={teamNames}
            selected={employee.id === selectedEmployeeId}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  const visibleEmployees = employees.slice(visibleRange.start, visibleRange.end);
  const stripWidth = employees.length * MONITORING_CARD_STRIDE - MONITORING_CARD_GAP;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="-mx-1 overflow-x-auto px-1 pb-2 pt-1"
      aria-label={`Employee status list, ${employees.length} employees`}
    >
      <div className="relative h-[188px]" style={{ width: stripWidth }}>
        {visibleEmployees.map((employee, offset) => {
          const index = visibleRange.start + offset;
          return (
            <div
              key={employee.id}
              className="absolute top-0"
              style={{ left: index * MONITORING_CARD_STRIDE }}
            >
              <MonitoringEmployeeCard
                employee={employee}
                teamNames={teamNames}
                selected={employee.id === selectedEmployeeId}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MonitoringEmployeeCard = memo(
  function MonitoringEmployeeCard({
    employee,
    teamNames,
    selected,
    onSelect,
  }: {
    employee: Employee;
    teamNames: Map<string, string>;
    selected: boolean;
    onSelect: (employeeId: string) => void;
  }) {
    const displayStatus = employeeDisplayStatus(employee);
    const employeeTeams = employee.teamIds
      .map((id) => teamNames.get(id))
      .filter(Boolean)
      .join(", ");
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(employee.id)}
        className={cn(
          "group relative flex w-[176px] shrink-0 flex-col items-center rounded-2xl px-3 py-3 text-center transition duration-200",
          "hover:-translate-y-0.5 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-primary/[0.07] shadow-sm ring-2 ring-primary/25",
        )}
      >
        {selected && (
          <span className="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Check className="h-3 w-3" />
          </span>
        )}
        <span className="relative">
          <Avatar className="h-14 w-14 border-2 border-background shadow-sm">
            <AvatarFallback className="bg-gradient-to-br from-primary/20 to-violet-500/15 text-base font-extrabold text-primary">
              {initials(employee.name)}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              "absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-background",
              statusDotClass(displayStatus),
            )}
            aria-hidden="true"
          />
        </span>
        <span className="mt-2.5 block w-full truncate text-sm font-extrabold">{employee.name}</span>
        <span className="mt-0.5 block w-full truncate text-xs text-muted-foreground">
          {employee.jobTitle || "No job title"}
        </span>
        <span className="mt-2 flex max-w-full items-center gap-1.5">
          <StatusBadge status={displayStatus} />
        </span>
        <span className="mt-1.5 flex w-full items-center justify-center gap-1 text-[11px] text-muted-foreground">
          <Users className="h-3 w-3 shrink-0" />
          <span className="truncate">{employeeTeams || "No team"}</span>
        </span>
      </button>
    );
  },
  (previous, next) => {
    const previousEmployee = previous.employee;
    const nextEmployee = next.employee;
    return (
      previous.selected === next.selected &&
      previous.onSelect === next.onSelect &&
      previous.teamNames === next.teamNames &&
      previousEmployee.id === nextEmployee.id &&
      previousEmployee.name === nextEmployee.name &&
      previousEmployee.jobTitle === nextEmployee.jobTitle &&
      previousEmployee.status === nextEmployee.status &&
      previousEmployee.accountStatus === nextEmployee.accountStatus &&
      previousEmployee.teamIds.length === nextEmployee.teamIds.length &&
      previousEmployee.teamIds.every((teamId, index) => teamId === nextEmployee.teamIds[index])
    );
  },
);

function TabSectionSkeleton({ cards }: { cards: number }) {
  return (
    <div className="space-y-4">
      <div className="h-20 animate-pulse rounded-2xl bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: cards }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

function DailyAttendanceTab({
  employeeId,
  day,
  queryScopeKey,
  enabled,
}: {
  employeeId: string;
  day: string;
  queryScopeKey: string;
  enabled: boolean;
}) {
  const policy = monitoringDetailPolicy(day);
  const attendance = useQuery({
    queryKey: monitoringDetailQueryKey("attendance", queryScopeKey, employeeId, day),
    queryFn: ({ signal }) => getDailyAttendance(employeeId, day, signal),
    enabled: monitoringDetailEnabled(enabled, employeeId, day),
    staleTime: policy.staleTime,
    gcTime: 30 * 60_000,
    refetchInterval: enabled ? policy.refetchInterval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    retry: retryTransientRequest,
  });

  if (attendance.isPending && !attendance.data) {
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

  if (attendance.isError && !attendance.data) {
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
              {attendance.isFetching && (
                <span className="text-xs font-semibold text-muted-foreground">Refreshing...</span>
              )}
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

      {attendance.isError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
          <span>The last refresh failed. The previous attendance is still shown.</span>
          <Button variant="outline" size="sm" onClick={() => attendance.refetch()}>
            Retry
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AttendanceMetric
          label="Scheduled shift"
          value={`${formatClock(row.scheduledStartAt, row.timezone)} – ${formatClock(row.scheduledEndAt, row.timezone)}`}
        />
        <AttendanceMetric
          label="First activity"
          value={formatAttendanceStart(
            row.actualFirstActivityAt,
            row.timezone,
            row.continuedFromPreviousDay,
            row.continuedSessionStartedAt,
          )}
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

function statusDotClass(status: string) {
  if (status === "active") return "bg-emerald-500";
  if (status === "idle") return "bg-amber-400";
  if (status === "locked" || status === "inactive") return "bg-slate-400";
  if (status === "sleeping") return "bg-indigo-400";
  if (status === "on_break") return "bg-violet-500";
  if (status === "break_work") return "bg-fuchsia-500";
  if (status === "off_shift") return "bg-sky-500";
  if (status === "invited") return "bg-sky-500";
  if (status === "app_pending") return "bg-violet-500";
  return "bg-rose-500";
}

function isMonitoringTab(value: unknown): value is MonitoringTab {
  return value === "attendance" || value === "screenshots" || value === "applications";
}

function isMonitoringEmployeeStatus(value: unknown): value is MonitoringEmployeeStatus {
  return (
    value === "all" ||
    value === "active" ||
    value === "idle" ||
    value === "locked" ||
    value === "sleeping" ||
    value === "on_break" ||
    value === "break_work" ||
    value === "off_shift" ||
    value === "offline" ||
    value === "invited" ||
    value === "app_pending" ||
    value === "inactive"
  );
}

function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayIsoDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function duration(value: number) {
  const seconds = Math.max(0, Math.round(value || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
