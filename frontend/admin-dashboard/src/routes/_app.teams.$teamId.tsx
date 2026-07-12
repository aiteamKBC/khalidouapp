import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  BriefcaseBusiness,
  AlertTriangle,
  CheckSquare,
  Camera,
  ChevronRight,
  Clock,
  Coffee,
  ImageIcon,
  Monitor,
  PowerOff,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ProtectedImage } from "@/components/ProtectedImage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { addTeamMember, getTeam, removeTeamMember, teamStats } from "@/api/teams";
import { listEmployees } from "@/api/employees";
import { listScreenshots } from "@/api/screenshots";
import { listTimesheets } from "@/api/timesheets";
import { listDevices } from "@/api/devices";
import { listProjects, listTaskMetrics, listTasks } from "@/api/projects";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMinutes, formatRelative } from "@/lib/format";
import type { Employee, Project, Screenshot, Task } from "@/types";
import { StatCard } from "@/components/ui/stat-card";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/teams/$teamId")({
  component: TeamDetailPage,
});

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function TeamDetailPage() {
  const { teamId } = Route.useParams();
  const { hasRole } = useAuth();
  const canManage = hasRole("general_admin");
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedShot, setSelectedShot] = useState<Screenshot | null>(null);
  const team = useQuery({ queryKey: ["team", teamId], queryFn: () => getTeam(teamId) });
  const stats = useQuery({
    queryKey: ["team-stats", teamId],
    queryFn: () => teamStats(teamId),
    enabled: activeTab === "overview",
  });
  const emps = useQuery({
    queryKey: ["team-emps", teamId],
    queryFn: () => listEmployees([teamId]),
    enabled:
      activeTab === "members" ||
      activeTab === "live" ||
      activeTab === "screenshots" ||
      activeTab === "work",
  });
  const allEmps = useQuery({
    queryKey: ["employees-all"],
    queryFn: () => listEmployees(),
    enabled:
      (canManage && activeTab === "members") ||
      activeTab === "devices" ||
      activeTab === "timesheets",
  });
  const shots = useQuery({
    queryKey: ["team-shots", teamId],
    queryFn: () => listScreenshots([teamId]),
    enabled: activeTab === "screenshots",
  });
  const ts = useQuery({
    queryKey: ["team-ts", teamId],
    queryFn: () => listTimesheets([teamId], "monthly"),
    enabled: activeTab === "timesheets",
  });
  const devs = useQuery({
    queryKey: ["team-devs", teamId],
    queryFn: () => listDevices([teamId]),
    enabled: activeTab === "devices",
  });
  const workTasks = useQuery({
    queryKey: ["tasks", "team", teamId],
    queryFn: () => listTasks({ teamId }),
    enabled: activeTab === "work",
  });
  const workProjects = useQuery({
    queryKey: ["projects", "team", teamId],
    queryFn: () => listProjects([teamId]),
    enabled: activeTab === "work",
  });
  const workMetrics = useQuery({
    queryKey: ["task-metrics", teamId],
    queryFn: () => listTaskMetrics(teamId),
    enabled: activeTab === "work",
  });
  const [memberId, setMemberId] = useState("");

  const invalidateTeam = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["team", teamId] }),
      queryClient.invalidateQueries({ queryKey: ["teams"] }),
      queryClient.invalidateQueries({ queryKey: ["team-emps", teamId] }),
      queryClient.invalidateQueries({ queryKey: ["employees-all"] }),
    ]);
  };

  const addMemberMutation = useMutation({
    mutationFn: () => addTeamMember(teamId, memberId),
    onSuccess: async () => {
      toast.success("Member added");
      setMemberId("");
      await invalidateTeam();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to add member"),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (employeeId: string) => removeTeamMember(teamId, employeeId),
    onSuccess: async () => {
      toast.success("Member removed");
      await invalidateTeam();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to remove member"),
  });

  const memberCandidates = useMemo(() => {
    const currentIds = new Set((emps.data ?? []).map((employee) => employee.id));
    return (allEmps.data ?? []).filter((employee) => !currentIds.has(employee.id));
  }, [allEmps.data, emps.data]);

  if (team.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (team.isError || !team.data) {
    return (
      <EmptyState
        icon={Users}
        title="Team couldn't be loaded"
        description="The team may no longer exist, or the server is temporarily unavailable."
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/teams">Back to teams</Link>
            </Button>
            <Button onClick={() => team.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/teams">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to teams
        </Link>
      </Button>
      <PageHeader
        title={team.data.name}
        description={team.data.description || "Monitor this team's people, activity, and devices."}
        actions={<StatusBadge status={team.data.status} />}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="mb-5 overflow-x-auto border-b border-border">
          <TabsList className="h-auto min-w-max justify-start rounded-none bg-transparent p-0">
            <TabsTrigger
              value="overview"
              className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Activity className="h-4 w-4" /> Overview
            </TabsTrigger>
            <TabsTrigger
              value="members"
              className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Users className="h-4 w-4" /> Members
            </TabsTrigger>
            <TabsTrigger
              value="work"
              className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <BriefcaseBusiness className="h-4 w-4" /> Work
            </TabsTrigger>
            <TabsTrigger
              value="live"
              className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Activity className="h-4 w-4" /> Live Activity
            </TabsTrigger>
            <TabsTrigger
              value="screenshots"
              className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Camera className="h-4 w-4" /> Screenshots
            </TabsTrigger>
            <TabsTrigger
              value="timesheets"
              className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <CalendarDays className="h-4 w-4" /> Timesheets
            </TabsTrigger>
            <TabsTrigger
              value="devices"
              className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Monitor className="h-4 w-4" /> Devices
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <SectionIntro
            title="Team overview"
            description="A live summary of attendance and tracked work today."
          />
          {stats.isLoading ? (
            <MetricSkeleton />
          ) : stats.isError ? (
            <LoadError
              message="Team statistics couldn't be loaded."
              onRetry={() => stats.refetch()}
            />
          ) : stats.data ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricLink label="View members" onClick={() => setActiveTab("members")}>
                <StatCard label="Employees" value={stats.data.total} icon={Users} />
              </MetricLink>
              <MetricLink label="View live activity" onClick={() => setActiveTab("live")}>
                <StatCard label="Online" value={stats.data.online} icon={Activity} tone="success" />
              </MetricLink>
              <MetricLink label="View idle employees" onClick={() => setActiveTab("live")}>
                <StatCard label="Idle" value={stats.data.idle} icon={Coffee} tone="warning" />
              </MetricLink>
              <MetricLink label="View offline employees" onClick={() => setActiveTab("live")}>
                <StatCard
                  label="Offline"
                  value={stats.data.offline}
                  icon={PowerOff}
                  tone="destructive"
                />
              </MetricLink>
              <StatCard
                label="Hours today"
                value={formatMinutes(Math.round(stats.data.hoursToday * 60))}
                icon={Clock}
                tone="info"
              />
              <StatCard
                label="Active"
                value={formatMinutes(stats.data.activeMin)}
                icon={Activity}
                tone="success"
              />
              <StatCard
                label="Idle time"
                value={formatMinutes(stats.data.idleMin)}
                icon={Coffee}
                tone="warning"
              />
              <MetricLink label="View screenshots" onClick={() => setActiveTab("screenshots")}>
                <StatCard label="Screenshots" value={stats.data.screenshots} icon={Camera} />
              </MetricLink>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="work">
          <SectionIntro
            title="Team work"
            description="What each member owns, completed, and is working on now."
          />
          {workTasks.isLoading || emps.isLoading ? (
            <MetricSkeleton />
          ) : workTasks.isError ? (
            <LoadError
              message="Team work couldn't be loaded."
              onRetry={() => workTasks.refetch()}
            />
          ) : (
            <TeamWorkDashboard
              tasks={workTasks.data ?? []}
              employees={emps.data ?? []}
              projects={workProjects.data ?? []}
              metrics={workMetrics.data ?? []}
            />
          )}
        </TabsContent>

        <TabsContent value="members">
          <SectionIntro
            title="Team members"
            description="Add people to this team and open their profiles for more detail."
          />
          {canManage && (
            <Card className="p-4 mb-4">
              <div className="flex flex-wrap gap-2">
                <Select value={memberId} onValueChange={setMemberId}>
                  <SelectTrigger className="w-72">
                    <SelectValue placeholder="Choose employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {memberCandidates.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!memberId || addMemberMutation.isPending}
                  onClick={() => addMemberMutation.mutate()}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  {addMemberMutation.isPending ? "Adding..." : "Add member"}
                </Button>
                <Button asChild variant="outline">
                  <Link to="/employees">Manage employees</Link>
                </Button>
              </div>
              {allEmps.isLoading && (
                <p className="mt-3 text-sm text-muted-foreground">Loading employees...</p>
              )}
              {allEmps.isError && (
                <p className="mt-3 text-sm text-destructive">
                  Employees could not be loaded. Refresh the page and try again.
                </p>
              )}
              {!allEmps.isLoading && !allEmps.isError && memberCandidates.length === 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                  No existing employees are available. Create an employee from Employees first, or
                  every employee is already a member.
                </p>
              )}
            </Card>
          )}
          {emps.isLoading ? (
            <ListSkeleton />
          ) : emps.isError ? (
            <LoadError message="Team members couldn't be loaded." onRetry={() => emps.refetch()} />
          ) : (emps.data ?? []).length === 0 ? (
            <EmptyState
              icon={Users}
              title="No members in this team"
              description="Add an existing employee above to start seeing their activity and work data here."
            />
          ) : (
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {(emps.data ?? []).map((employee) => (
                  <div
                    key={employee.id}
                    className="group flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <Link
                      to="/employees/$employeeId"
                      params={{ employeeId: employee.id }}
                      className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="font-medium text-sm">{employee.name}</div>
                      <div className="text-xs text-muted-foreground">{employee.email}</div>
                    </Link>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={employee.status} />
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={removeMemberMutation.isPending}
                          onClick={() => removeMemberMutation.mutate(employee.id)}
                        >
                          Remove
                        </Button>
                      )}
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        aria-label={`Open ${employee.name}`}
                      >
                        <Link to="/employees/$employeeId" params={{ employeeId: employee.id }}>
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="live">
          <SectionIntro
            title="Live activity"
            description="Current status and the latest connection received from each team member."
          />
          {emps.isLoading ? (
            <ListSkeleton />
          ) : emps.isError ? (
            <LoadError message="Live activity couldn't be loaded." onRetry={() => emps.refetch()} />
          ) : (emps.data ?? []).length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No live activity"
              description="Activity will appear after a team member connects the desktop app."
            />
          ) : (
            <Card>
              <CardContent className="p-4 space-y-2">
                {(emps.data ?? []).map((employee) => (
                  <Link
                    key={employee.id}
                    to="/employees/$employeeId"
                    params={{ employeeId: employee.id }}
                    className="group flex items-center justify-between rounded-md border-b border-border px-2 py-3 text-sm transition-colors hover:bg-muted/50 last:border-0"
                  >
                    <div>
                      <div className="font-medium">{employee.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Last heartbeat {formatRelative(employee.lastHeartbeat)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={employee.status} />
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="screenshots">
          <SectionIntro
            title="Screenshots"
            description="Open any capture to inspect it at full size, grouped by employee."
          />
          {(() => {
            const list = shots.data ?? [];
            if (shots.isLoading) {
              return <MetricSkeleton />;
            }
            if (shots.isError) {
              return (
                <LoadError
                  message="Screenshots couldn't be loaded."
                  onRetry={() => shots.refetch()}
                />
              );
            }
            if (list.length === 0) {
              return (
                <EmptyState
                  icon={ImageIcon}
                  title="No screenshots yet"
                  description="New captures will appear here after team members start tracking time."
                />
              );
            }
            const nameById = new Map(
              (emps.data ?? []).map((employee) => [employee.id, employee.name]),
            );
            const groups = new Map<string, typeof list>();
            for (const shot of list) {
              groups.set(shot.employeeId, [...(groups.get(shot.employeeId) ?? []), shot]);
            }
            const ordered = [...groups.entries()]
              .map(([id, items]) => ({
                id,
                name: nameById.get(id) ?? "Unknown employee",
                items: [...items].sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt)),
              }))
              .sort((a, b) => a.name.localeCompare(b.name));
            return (
              <div className="space-y-6">
                {ordered.map((group) => (
                  <div key={group.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-[11px] font-semibold">
                        {initials(group.name)}
                      </span>
                      <span className="text-sm font-medium">{group.name}</span>
                      <span className="text-xs text-muted-foreground">
                        · {group.items.length} screenshots
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {group.items.map((shot) => (
                        <button
                          type="button"
                          key={shot.id}
                          className="group overflow-hidden rounded-md border border-border bg-card text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setSelectedShot(shot)}
                        >
                          <ProtectedImage
                            src={shot.thumbnailUrl}
                            alt={`Screenshot captured ${new Date(shot.capturedAt).toLocaleString()}`}
                            className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.02]"
                          />
                          <span className="block px-2 py-1.5 text-xs text-muted-foreground">
                            {new Date(shot.capturedAt).toLocaleString()}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="timesheets">
          <SectionIntro
            title="Timesheets"
            description="Tracked time for this team during the current month."
          />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                <span>This month</span>
                <Button asChild variant="outline" size="sm">
                  <Link to="/timesheets">View all timesheets</Link>
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ts.isLoading ? (
                <ListSkeleton />
              ) : ts.isError ? (
                <LoadError message="Timesheets couldn't be loaded." onRetry={() => ts.refetch()} />
              ) : (ts.data ?? []).length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="No tracked time this month"
                  description="Completed and in-progress timesheets will appear here."
                />
              ) : (
                <div className="divide-y divide-border text-sm">
                  {(() => {
                    const nameById = new Map(
                      (allEmps.data ?? []).map((employee) => [employee.id, employee.name]),
                    );
                    return (ts.data ?? []).map((timesheet) => (
                      <Link
                        key={timesheet.id}
                        to="/employees/$employeeId"
                        params={{ employeeId: timesheet.employeeId }}
                        className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">
                            {nameById.get(timesheet.employeeId) ?? "Unknown employee"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(timesheet.date)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono">{formatMinutes(timesheet.totalMinutes)}</div>
                          <div className="text-xs text-muted-foreground">
                            active {formatMinutes(timesheet.activeMinutes)}
                          </div>
                        </div>
                        <StatusBadge status={timesheet.status} />
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    ));
                  })()}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="devices">
          <SectionIntro
            title="Devices"
            description="Computers registered to team members. Open a device to inspect its identity and connection history."
          />
          {devs.isLoading ? (
            <ListSkeleton />
          ) : devs.isError ? (
            <LoadError message="Devices couldn't be loaded." onRetry={() => devs.refetch()} />
          ) : (devs.data ?? []).length === 0 ? (
            <EmptyState
              icon={Monitor}
              title="No devices in this team"
              description="A device will appear after a team member enrolls the desktop app."
            />
          ) : (
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {(() => {
                  const nameById = new Map(
                    (allEmps.data ?? []).map((employee) => [employee.id, employee.name]),
                  );
                  return (devs.data ?? []).map((device) => (
                    <Link
                      key={device.id}
                      to="/devices/$deviceId"
                      params={{ deviceId: device.id }}
                      className="group flex items-start justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">
                          {nameById.get(device.employeeId) ?? "Unknown employee"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {device.name} · {device.os} · v{device.agentVersion}
                          {device.windowsUsername ? ` · ${device.windowsUsername}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {device.lastIpAddress ? `IP ${device.lastIpAddress} · ` : ""}
                          last seen {formatRelative(device.lastSeen)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={device.status} />
                        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </Link>
                  ));
                })()}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={Boolean(selectedShot)} onOpenChange={(open) => !open && setSelectedShot(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Screenshot details</DialogTitle>
          </DialogHeader>
          {selectedShot && (
            <div className="space-y-3">
              <ProtectedImage
                src={selectedShot.fullUrl}
                alt="Full-size employee screenshot"
                className="max-h-[70vh] w-full rounded-md bg-muted object-contain"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>{new Date(selectedShot.capturedAt).toLocaleString()}</span>
                <span>{selectedShot.isIdle ? "Captured while idle" : "Captured while active"}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={RefreshCw}
      title={message}
      description="Check your connection and try again."
      action={
        <Button onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      }
    />
  );
}

function ListSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MetricSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-28 w-full" />
      ))}
    </div>
  );
}

function MetricLink({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded-lg text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TeamWorkDashboard({
  tasks,
  employees,
  projects,
  metrics,
}: {
  tasks: Task[];
  employees: Employee[];
  projects: Project[];
  metrics: Array<{ taskId: string; activeMinutes: number; idleMinutes: number }>;
}) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const overdue = tasks.filter(
    (task) =>
      task.stage !== "completed" && task.deadline && new Date(`${task.deadline}T23:59:59`) < now,
  );
  const completedWeek = tasks.filter(
    (task) => task.completedAt && new Date(task.completedAt) >= weekStart,
  );
  const upcoming = tasks
    .filter((task) => {
      if (task.stage === "completed" || !task.deadline) return false;
      const remaining = new Date(`${task.deadline}T23:59:59`).getTime() - now.getTime();
      return remaining >= 0 && remaining <= 7 * 86400000;
    })
    .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  const workingNow = employees.filter((employee) => employee.currentTaskId).length;
  const checklist = tasks.flatMap((task) => task.checklist);
  const progress = checklist.length
    ? Math.round((checklist.filter((item) => item.completed).length / checklist.length) * 100)
    : 0;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Link to="/projects">
          <StatCard label="Working now" value={workingNow} icon={Activity} tone="info" />
        </Link>
        <Link to="/projects">
          <StatCard
            label="In progress"
            value={tasks.filter((task) => task.stage === "in_progress").length}
            icon={Activity}
            tone="info"
          />
        </Link>
        <Link to="/projects">
          <StatCard
            label="Completed this week"
            value={completedWeek.length}
            icon={CheckSquare}
            tone="success"
          />
        </Link>
        <Link to="/projects">
          <StatCard
            label="Overdue"
            value={overdue.length}
            icon={AlertTriangle}
            tone="destructive"
          />
        </Link>
        <Link to="/projects">
          <StatCard label="Due next 7 days" value={upcoming.length} icon={BriefcaseBusiness} />
        </Link>
        <Link to="/projects">
          <StatCard label="Checklist progress" value={`${progress}%`} icon={BriefcaseBusiness} />
        </Link>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tasks by stage</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              "new_requests",
              "backlog",
              "assigned",
              "in_progress",
              "ready_for_review",
              "completed",
              "blocked",
              "rejected",
              "cancelled",
            ].map((stage) => (
              <Link
                key={stage}
                to="/projects"
                className="rounded-lg border p-3 text-center transition hover:border-primary/40 hover:bg-muted/40"
              >
                <p className="text-xl font-semibold">
                  {tasks.filter((task) => task.stage === stage).length}
                </p>
                <p className="text-[11px] text-muted-foreground">{stage.replaceAll("_", " ")}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Upcoming deadlines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.slice(0, 5).map((task) => (
              <Link
                key={task.id}
                to="/projects"
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/40"
              >
                <span className="truncate">{task.name}</span>
                <span className="text-xs text-muted-foreground">{task.deadline}</span>
              </Link>
            ))}
            {upcoming.length === 0 && (
              <p className="text-sm text-muted-foreground">No deadlines in the next seven days.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Members and current work</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {employees.map((employee) => {
            const own = tasks.filter(
              (task) =>
                task.assigneeEmployeeId === employee.id ||
                task.collaboratorEmployeeIds.includes(employee.id),
            );
            const current = tasks.find((task) => task.id === employee.currentTaskId);
            const active = metrics
              .filter((metric) => own.some((task) => task.id === metric.taskId))
              .reduce((sum, metric) => sum + metric.activeMinutes, 0);
            return (
              <Link
                key={employee.id}
                to="/employees/$employeeId"
                params={{ employeeId: employee.id }}
                className="grid gap-3 px-4 py-3 transition hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <div>
                  <p className="text-sm font-medium">{employee.name}</p>
                  <StatusBadge status={employee.status} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Current</p>
                  <p className="truncate text-sm">{current?.name ?? "No current task"}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{own.length} tasks</p>
                  <p>{formatMinutes(active)} tracked</p>
                </div>
              </Link>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const projectTasks = tasks.filter((task) => task.projectId === project.id);
            const tracked = metrics
              .filter((metric) => projectTasks.some((task) => task.id === metric.taskId))
              .reduce((sum, metric) => sum + metric.activeMinutes + metric.idleMinutes, 0);
            return (
              <Link
                key={project.id}
                to="/projects"
                className="rounded-lg border p-3 transition hover:border-primary/40 hover:bg-muted/40"
              >
                <p className="font-medium">{project.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {projectTasks.filter((task) => task.stage === "completed").length}/
                  {projectTasks.length} completed
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatMinutes(tracked)} tracked
                </p>
              </Link>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent task activity</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {[...tasks]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 8)
            .map((task) => (
              <Link
                key={task.id}
                to="/projects"
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40"
              >
                <span className="truncate">{task.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {task.stage.replaceAll("_", " ")} ·{" "}
                  {new Date(task.updatedAt).toLocaleDateString()}
                </span>
              </Link>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
