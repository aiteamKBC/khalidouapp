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
  Pencil,
  Folder,
  ImageIcon,
  ListChecks,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
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
import { StatusBadge } from "@/components/ui/status-badge";
import {
  addTeamMember,
  addTeamOwner,
  getTeam,
  listTeamOwners,
  removeTeamMember,
  removeTeamOwner,
  teamStats,
  updateTeamMemberRole,
} from "@/api/teams";
import { listEmployees } from "@/api/employees";
import { listScreenshots } from "@/api/screenshots";
import { listTimesheets } from "@/api/timesheets";
import { listDevices } from "@/api/devices";
import { listProjects, listTaskMetrics, listTasks } from "@/api/projects";
import { updatePersonRole } from "@/api/people";
import { listUsers } from "@/api/users";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { formatDate, formatMinutes, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Employee, Project, Screenshot, Task, TeamMemberRole, Timesheet, User } from "@/types";
import { StatCard } from "@/components/ui/stat-card";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/teams/$teamId")({
  component: TeamDetailPage,
});

const TEAM_MEMBER_ROLE_OPTIONS: Array<{
  value: TeamMemberRole;
  label: string;
  description: string;
}> = [
  {
    value: "team_manager",
    label: "Team manager",
    description: "Owns accountability and approvals.",
  },
  { value: "team_lead", label: "Team lead", description: "Leads daily work inside the team." },
  { value: "senior", label: "Senior", description: "Experienced contributor." },
  { value: "member", label: "Member", description: "Regular team member." },
  { value: "trainee", label: "Trainee", description: "Learning or onboarding." },
];

const TEAM_ACCESS_ROLES: TeamMemberRole[] = ["team_manager", "team_lead"];

function teamRoleHasAccess(role?: TeamMemberRole) {
  return role ? TEAM_ACCESS_ROLES.includes(role) : false;
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

function TeamDetailPage() {
  const { teamId } = Route.useParams();
  const { can } = useAuth();
  const canManage = can(permissions.teamsManage);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedShot, setSelectedShot] = useState<Screenshot | null>(null);
  const [selectedShotFolderId, setSelectedShotFolderId] = useState<string | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingTeamRole, setEditingTeamRole] = useState<TeamMemberRole>("member");
  const [ownerId, setOwnerId] = useState("");
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
      activeTab === "overview" ||
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
  const ownerUsers = useQuery({
    queryKey: ["team-owners", teamId],
    queryFn: () => listTeamOwners(teamId),
    enabled: activeTab === "overview" || activeTab === "members",
  });
  const adminUsers = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    enabled: canManage && (activeTab === "overview" || activeTab === "members"),
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
  const [memberRole, setMemberRole] = useState<TeamMemberRole>("member");

  const invalidateTeam = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["team", teamId] }),
      queryClient.invalidateQueries({ queryKey: ["teams"] }),
      queryClient.invalidateQueries({ queryKey: ["team-emps", teamId] }),
      queryClient.invalidateQueries({ queryKey: ["employees-all"] }),
      queryClient.invalidateQueries({ queryKey: ["team-owners", teamId] }),
      queryClient.invalidateQueries({ queryKey: ["employees"] }),
      queryClient.invalidateQueries({ queryKey: ["users"] }),
    ]);
  };

  const addMemberMutation = useMutation({
    mutationFn: () => addTeamMember(teamId, memberId, memberRole),
    onSuccess: async () => {
      toast.success("Member added");
      setMemberId("");
      setMemberRole("member");
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

  const addOwnerMutation = useMutation({
    mutationFn: () => addTeamOwner(teamId, ownerId),
    onSuccess: async () => {
      toast.success("Team manager assigned");
      setOwnerId("");
      await invalidateTeam();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to assign team manager"),
  });

  const removeOwnerMutation = useMutation({
    mutationFn: (adminUserId: string) => removeTeamOwner(teamId, adminUserId),
    onSuccess: async () => {
      toast.success("Team manager removed");
      await invalidateTeam();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to remove team manager"),
  });

  const updateRoleMutation = useMutation({
    mutationFn: async () => {
      if (!editingEmployee) throw new Error("No employee selected");
      const result = await updateTeamMemberRole(teamId, editingEmployee.id, editingTeamRole);
      const linkedAdmin = (adminUsers.data ?? []).find(
        (user) => user.employeeId === editingEmployee.id,
      );
      const shouldHaveTeamAccess = teamRoleHasAccess(editingTeamRole);
      const hadTeamAccess = teamRoleHasAccess(editingEmployee.teamRole);

      if (shouldHaveTeamAccess) {
        if (!linkedAdmin || linkedAdmin.role === "team_owner") {
          const teamIds = Array.from(new Set([...(linkedAdmin?.assignedTeamIds ?? []), teamId]));
          await updatePersonRole("employee", editingEmployee.id, {
            role: "team_owner",
            teamIds,
          });
        }
      } else if (hadTeamAccess && linkedAdmin?.role === "team_owner") {
        const remainingTeamIds = linkedAdmin.assignedTeamIds.filter((id) => id !== teamId);
        await updatePersonRole("employee", editingEmployee.id, {
          role: remainingTeamIds.length > 0 ? "team_owner" : "employee",
          teamIds: remainingTeamIds,
        });
      }

      return result;
    },
    onSuccess: async () => {
      toast.success("Team role and access updated");
      setEditingEmployee(null);
      setEditingTeamRole("member");
      await invalidateTeam();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to update team role"),
  });

  const memberCandidates = useMemo(() => {
    const currentIds = new Set((emps.data ?? []).map((employee) => employee.id));
    return (allEmps.data ?? []).filter((employee) => !currentIds.has(employee.id));
  }, [allEmps.data, emps.data]);
  const ownerCandidates = useMemo(() => {
    const currentOwnerIds = new Set((ownerUsers.data ?? []).map((owner) => owner.id));
    return (adminUsers.data ?? [])
      .filter((user) => user.status === "active")
      .filter(
        (user) => user.role === "team_owner" || user.role === "general_admin" || user.role === "hr",
      )
      .filter((user) => !currentOwnerIds.has(user.id));
  }, [adminUsers.data, ownerUsers.data]);
  const editingLinkedAdmin = useMemo(
    () =>
      editingEmployee
        ? (adminUsers.data ?? []).find((user) => user.employeeId === editingEmployee.id)
        : undefined,
    [adminUsers.data, editingEmployee],
  );
  const editingHasCompanyWideAccess =
    editingLinkedAdmin?.role === "general_admin" || editingLinkedAdmin?.role === "hr";

  function openRoleEditor(employee: Employee) {
    setEditingEmployee(employee);
    setEditingTeamRole(employee.teamRole || "member");
  }

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
            description="Live headcount plus today's tracked time for this team."
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
                <StatCard label="Team members" value={stats.data.total} icon={Users} />
              </MetricLink>
              <MetricLink label="View live activity" onClick={() => setActiveTab("live")}>
                <StatCard
                  label="Live now"
                  value={stats.data.online}
                  icon={Activity}
                  tone="success"
                />
              </MetricLink>
              <MetricLink label="View idle employees" onClick={() => setActiveTab("live")}>
                <StatCard
                  label="Idle people now"
                  value={stats.data.idle}
                  icon={Coffee}
                  tone="warning"
                />
              </MetricLink>
              <MetricLink label="View offline employees" onClick={() => setActiveTab("live")}>
                <StatCard
                  label="Offline people"
                  value={stats.data.offline}
                  icon={PowerOff}
                  tone="destructive"
                />
              </MetricLink>
              <StatCard
                label="Worked today"
                value={formatMinutes(Math.round(stats.data.hoursToday * 60))}
                icon={Clock}
                tone="info"
              />
              <StatCard
                label="Active work time"
                value={formatMinutes(stats.data.activeMin)}
                icon={Activity}
                tone="success"
              />
              <StatCard
                label="Idle time today"
                value={formatMinutes(stats.data.idleMin)}
                icon={Coffee}
                tone="warning"
              />
              <MetricLink label="View screenshots" onClick={() => setActiveTab("screenshots")}>
                <StatCard label="Screenshots today" value={stats.data.screenshots} icon={Camera} />
              </MetricLink>
            </div>
          ) : null}
          <div className="mt-5">
            <TeamStructure
              employees={emps.data ?? []}
              owners={ownerUsers.data ?? []}
              ownerCandidates={ownerCandidates}
              ownerId={ownerId}
              setOwnerId={setOwnerId}
              canManage={canManage}
              isOwnerSaving={addOwnerMutation.isPending || removeOwnerMutation.isPending}
              onAddOwner={() => addOwnerMutation.mutate()}
              onRemoveOwner={(adminUserId) => removeOwnerMutation.mutate(adminUserId)}
              onEditRole={openRoleEditor}
              onRemove={undefined}
            />
          </div>
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
                <Select
                  value={memberRole}
                  onValueChange={(value) => setMemberRole(value as TeamMemberRole)}
                >
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_MEMBER_ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  loading={addMemberMutation.isPending}
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
            <TeamStructure
              employees={emps.data ?? []}
              owners={ownerUsers.data ?? []}
              ownerCandidates={ownerCandidates}
              ownerId={ownerId}
              setOwnerId={setOwnerId}
              canManage={canManage}
              isOwnerSaving={addOwnerMutation.isPending || removeOwnerMutation.isPending}
              isRemoving={removeMemberMutation.isPending}
              onAddOwner={() => addOwnerMutation.mutate()}
              onRemoveOwner={(adminUserId) => removeOwnerMutation.mutate(adminUserId)}
              onEditRole={openRoleEditor}
              onRemove={(employeeId) => removeMemberMutation.mutate(employeeId)}
            />
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
            const selectedGroup = selectedShotFolderId
              ? ordered.find((group) => group.id === selectedShotFolderId)
              : null;
            return (
              <div className="space-y-6">
                {!selectedGroup ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {ordered.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setSelectedShotFolderId(group.id)}
                        className="group rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
                      >
                        <div className="relative h-32 overflow-hidden rounded-2xl bg-muted">
                          <div className="absolute left-4 top-4 z-10 grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                            <Folder className="h-6 w-6" />
                          </div>
                          <div className="absolute bottom-3 right-3 flex -space-x-10">
                            {group.items.slice(0, 3).map((shot, index) => (
                              <ProtectedImage
                                key={shot.id}
                                src={shot.thumbnailUrl}
                                alt=""
                                className="h-16 w-24 rounded-lg border-2 border-card object-cover shadow-md"
                                style={{ transform: `rotate(${(index - 1) * 3}deg)` }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="mt-4 flex items-center gap-3">
                          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-xs font-extrabold text-primary">
                            {initials(group.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-extrabold">{group.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {group.items.length} screenshots
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedShotFolderId(null)}
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to folders
                      </Button>
                      <div className="text-sm text-muted-foreground">
                        {selectedGroup.name} · {selectedGroup.items.length} screenshots
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {selectedGroup.items.map((shot) => (
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
                )}
                <div className="hidden">
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
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="timesheets">
          <SectionIntro
            title="Timesheets"
            description="Filter, group, and review tracked time for this team during the current month."
          />
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
            <TeamTimesheetsPanel
              timesheets={ts.data ?? []}
              employees={allEmps.data?.length ? allEmps.data : (emps.data ?? [])}
            />
          )}
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
      <Dialog
        open={Boolean(editingEmployee)}
        onOpenChange={(open) => !open && setEditingEmployee(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit team role</DialogTitle>
          </DialogHeader>
          {editingEmployee && (
            <div className="space-y-4">
              <div className="rounded-2xl border bg-muted/30 p-3">
                <p className="text-sm font-extrabold">{editingEmployee.name}</p>
                <p className="text-xs text-muted-foreground">
                  {editingEmployee.jobTitle || "No job title"} · {editingEmployee.email}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Role in this team</Label>
                <Select
                  value={editingTeamRole}
                  onValueChange={(value) => setEditingTeamRole(value as TeamMemberRole)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose role" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_MEMBER_ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This role is specific to this team. The job title stays separate on the employee
                  profile.
                </p>
                <div
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs leading-relaxed",
                    teamRoleHasAccess(editingTeamRole)
                      ? "border-[#e5185d]/25 bg-[#fce3ec]/45 text-foreground"
                      : "bg-muted/30 text-muted-foreground",
                  )}
                >
                  {editingHasCompanyWideAccess && editingLinkedAdmin ? (
                    <>
                      <span className="font-bold">Permission impact:</span> this person stays{" "}
                      {roleLabel(editingLinkedAdmin.role)} with company-wide access. This only
                      changes their label inside this team.
                    </>
                  ) : teamRoleHasAccess(editingTeamRole) ? (
                    <>
                      <span className="font-bold">Permission impact:</span> this person will get
                      Team Lead access for this team. They can view assigned-team members,
                      timesheets, activity, screenshots, tasks, and team requests.
                    </>
                  ) : (
                    <>
                      <span className="font-bold text-foreground">Permission impact:</span> this is
                      a team label only. If they were only a Team Lead here, their assigned-team
                      access will be removed.
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingEmployee(null)}
              disabled={updateRoleMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={updateRoleMutation.isPending}
              disabled={updateRoleMutation.isPending || !editingEmployee}
              onClick={() => updateRoleMutation.mutate()}
            >
              {updateRoleMutation.isPending ? "Saving..." : "Save role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function TeamStructure({
  employees,
  owners,
  ownerCandidates,
  ownerId,
  setOwnerId,
  canManage,
  isOwnerSaving = false,
  isRemoving = false,
  onAddOwner,
  onRemoveOwner,
  onEditRole,
  onRemove,
}: {
  employees: Employee[];
  owners: User[];
  ownerCandidates: User[];
  ownerId: string;
  setOwnerId: (value: string) => void;
  canManage: boolean;
  isOwnerSaving?: boolean;
  isRemoving?: boolean;
  onAddOwner?: () => void;
  onRemoveOwner?: (adminUserId: string) => void;
  onEditRole?: (employee: Employee) => void;
  onRemove?: (employeeId: string) => void;
}) {
  const ownerEmployeeIds = new Set(owners.map((owner) => owner.employeeId).filter(Boolean));
  const roleManagers = employees.filter(
    (employee) => !ownerEmployeeIds.has(employee.id) && employee.teamRole === "team_manager",
  );
  const leads = employees.filter(
    (employee) => !ownerEmployeeIds.has(employee.id) && employee.teamRole === "team_lead",
  );
  const managementIds = new Set([...roleManagers, ...leads].map((employee) => employee.id));
  const members = employees.filter(
    (employee) => !ownerEmployeeIds.has(employee.id) && !managementIds.has(employee.id),
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <StructureGroup
            title="Team manager"
            description="Accountability, permissions, and approvals for this team."
          >
            {canManage && (
              <div className="mb-3 rounded-2xl border bg-muted/20 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-64 flex-1 space-y-1.5">
                    <Label>Assign manager</Label>
                    <Select value={ownerId} onValueChange={setOwnerId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose admin / HR / team manager" />
                      </SelectTrigger>
                      <SelectContent>
                        {ownerCandidates.length === 0 ? (
                          <SelectItem value="none" disabled>
                            No available managers
                          </SelectItem>
                        ) : (
                          ownerCandidates.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.name} · {roleLabel(user.role)}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    loading={isOwnerSaving}
                    disabled={!ownerId || ownerId === "none" || isOwnerSaving}
                    onClick={onAddOwner}
                  >
                    Assign
                  </Button>
                </div>
              </div>
            )}
            {owners.length === 0 && roleManagers.length === 0 ? (
              <EmptyRole text="No team manager assigned yet." />
            ) : (
              owners.map((owner) => (
                <div key={owner.id} className="rounded-2xl border bg-muted/25 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <AvatarName name={owner.name} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold">{owner.name}</p>
                        <p className="truncate text-xs font-semibold text-muted-foreground">
                          {owner.jobTitle || "No job title"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{owner.email}</p>
                      </div>
                    </div>
                    {canManage && onRemoveOwner && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={isOwnerSaving}
                        disabled={isOwnerSaving}
                        onClick={() => onRemoveOwner(owner.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <RolePill label={owner.jobTitle || "Team manager"} />
                    <RolePill label={roleLabel(owner.role)} tone="primary" />
                  </div>
                </div>
              ))
            )}
            {roleManagers.map((employee) => (
              <MemberCard
                key={employee.id}
                employee={employee}
                roleLabel={teamMemberRoleLabel(employee.teamRole)}
                canManage={canManage}
                isRemoving={isRemoving}
                onEditRole={onEditRole}
                onRemove={onRemove}
              />
            ))}
          </StructureGroup>
          <StructureGroup
            title="Team leads"
            description="People leading daily work inside this team."
          >
            {leads.length === 0 ? (
              <EmptyRole text="No team leads inferred from job titles yet." />
            ) : (
              leads.map((employee) => (
                <MemberCard
                  key={employee.id}
                  employee={employee}
                  roleLabel={teamMemberRoleLabel(employee.teamRole)}
                  canManage={canManage}
                  isRemoving={isRemoving}
                  onEditRole={onEditRole}
                  onRemove={onRemove}
                />
              ))
            )}
          </StructureGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {members.length === 0 ? (
            <EmptyRole text="No team members yet." />
          ) : (
            members.map((employee) => (
              <MemberCard
                key={employee.id}
                employee={employee}
                roleLabel={teamMemberRoleLabel(employee.teamRole)}
                canManage={canManage}
                isRemoving={isRemoving}
                onEditRole={onEditRole}
                onRemove={onRemove}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StructureGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2">
        <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function MemberCard({
  employee,
  roleLabel,
  canManage,
  isRemoving,
  onEditRole,
  onRemove,
}: {
  employee: Employee;
  roleLabel: string;
  canManage: boolean;
  isRemoving: boolean;
  onEditRole?: (employee: Employee) => void;
  onRemove?: (employeeId: string) => void;
}) {
  return (
    <div className="rounded-2xl border bg-card p-3 transition hover:border-primary/25 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <Link
          to="/employees/$employeeId"
          params={{ employeeId: employee.id }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AvatarName name={employee.name} />
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold">{employee.name}</p>
            <p className="truncate text-xs font-semibold text-muted-foreground">
              {employee.jobTitle || "No job title"}
            </p>
            <p className="truncate text-xs text-muted-foreground">{employee.email}</p>
          </div>
        </Link>
        <StatusBadge status={employee.status} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <RolePill label={roleLabel} />
        <div className="flex items-center gap-1">
          {canManage && onEditRole && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onEditRole(employee)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit role
            </Button>
          )}
          {canManage && onRemove && (
            <Button
              variant="ghost"
              size="sm"
              loading={isRemoving}
              disabled={isRemoving}
              onClick={() => onRemove(employee.id)}
            >
              Remove
            </Button>
          )}
          <Button asChild variant="ghost" size="icon" aria-label={`Open ${employee.name}`}>
            <Link to="/employees/$employeeId" params={{ employeeId: employee.id }}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function AvatarName({ name }: { name: string }) {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-extrabold text-primary">
      {initials(name)}
    </span>
  );
}

function RolePill({ label, tone = "muted" }: { label: string; tone?: "muted" | "primary" }) {
  return (
    <span
      className={
        tone === "primary"
          ? "inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary"
          : "inline-flex rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}

function roleLabel(role: User["role"]) {
  if (role === "general_admin") return "General admin";
  if (role === "hr") return "HR";
  return "Team manager";
}

function teamMemberRoleLabel(role?: TeamMemberRole) {
  return TEAM_MEMBER_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "Member";
}

function EmptyRole({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">{text}</div>
  );
}

function progressBarTone(percent: number): string {
  if (percent >= 75) return "bg-success";
  if (percent >= 40) return "bg-warning";
  return "bg-destructive";
}

function progressTextTone(percent: number): string {
  if (percent >= 75) return "text-success";
  if (percent >= 40) return "text-warning-foreground";
  return "text-destructive";
}

function TeamTimesheetsPanel({
  timesheets,
  employees,
}: {
  timesheets: Timesheet[];
  employees: Employee[];
}) {
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [groupBy, setGroupBy] = useState<"employee" | "day">("employee");
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const filtered = timesheets.filter((timesheet) => {
    if (employeeFilter !== "all" && timesheet.employeeId !== employeeFilter) return false;
    if (statusFilter !== "all" && timesheet.status !== statusFilter) return false;
    if (dateFilter && timesheet.date !== dateFilter) return false;
    return true;
  });
  const totals = filtered.reduce(
    (sum, row) => ({
      total: sum.total + row.totalMinutes,
      active: sum.active + row.activeMinutes,
      idle: sum.idle + row.idleMinutes,
      screenshots: sum.screenshots + row.screenshotCount,
      inProgress: sum.inProgress + (row.status === "in_progress" ? 1 : 0),
    }),
    { total: 0, active: 0, idle: 0, screenshots: 0, inProgress: 0 },
  );
  const activeRate = totals.total ? Math.round((totals.active / totals.total) * 100) : 0;
  const groups =
    groupBy === "employee"
      ? groupTimesheets(filtered, (row) => row.employeeId)
          .map(([id, rows]) => ({
            id,
            title: employeeById.get(id)?.name ?? "Unknown employee",
            subtitle: employeeById.get(id)?.jobTitle || employeeById.get(id)?.email || "Employee",
            rows: rows.sort((a, b) => b.date.localeCompare(a.date)),
          }))
          .sort((a, b) => a.title.localeCompare(b.title))
      : groupTimesheets(filtered, (row) => row.date)
          .map(([date, rows]) => ({
            id: date,
            title: formatDate(date),
            subtitle: `${rows.length} entries`,
            rows: rows.sort((a, b) =>
              (employeeById.get(a.employeeId)?.name ?? "").localeCompare(
                employeeById.get(b.employeeId)?.name ?? "",
              ),
            ),
          }))
          .sort((a, b) => b.id.localeCompare(a.id));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Tracked" value={formatMinutes(totals.total)} icon={Clock} tone="info" />
        <StatCard
          label="Active"
          value={formatMinutes(totals.active)}
          icon={Activity}
          tone="success"
        />
        <StatCard label="Idle" value={formatMinutes(totals.idle)} icon={Coffee} tone="warning" />
        <StatCard label="Active rate" value={`${activeRate}%`} icon={Activity} tone="success" />
        <StatCard label="Screenshots" value={totals.screenshots} icon={Camera} />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_180px_auto]">
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="missing">Missing</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={groupBy}
            onValueChange={(value) => setGroupBy(value as "employee" | "day")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="employee">Group by employee</SelectItem>
              <SelectItem value="day">Group by day</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setEmployeeFilter("all");
              setStatusFilter("all");
              setDateFilter("");
              setGroupBy("employee");
            }}
          >
            Reset
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Showing {filtered.length} of {timesheets.length} entries
          </span>
          <Button asChild variant="outline" size="sm">
            <Link to="/timesheets">Open full timesheets</Link>
          </Button>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No matching timesheets"
          description="Try clearing the filters or choosing another employee/date."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map((group) => {
            const groupTotals = group.rows.reduce(
              (sum, row) => ({
                total: sum.total + row.totalMinutes,
                active: sum.active + row.activeMinutes,
                idle: sum.idle + row.idleMinutes,
                screenshots: sum.screenshots + row.screenshotCount,
              }),
              { total: 0, active: 0, idle: 0, screenshots: 0 },
            );
            return (
              <Card key={group.id} className="overflow-hidden">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-start justify-between gap-3">
                    <span>
                      <span className="block text-base">{group.title}</span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {group.subtitle}
                      </span>
                    </span>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                      {formatMinutes(groupTotals.total)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl border p-2">
                      <p className="text-base font-extrabold">
                        {formatMinutes(groupTotals.active)}
                      </p>
                      <p className="text-muted-foreground">Active</p>
                    </div>
                    <div className="rounded-xl border p-2">
                      <p className="text-base font-extrabold">{formatMinutes(groupTotals.idle)}</p>
                      <p className="text-muted-foreground">Idle</p>
                    </div>
                    <div className="rounded-xl border p-2">
                      <p className="text-base font-extrabold">{groupTotals.screenshots}</p>
                      <p className="text-muted-foreground">Shots</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {group.rows.slice(0, 8).map((row) => {
                      const employee = employeeById.get(row.employeeId);
                      return (
                        <Link
                          key={row.id}
                          to="/employees/$employeeId"
                          params={{ employeeId: row.employeeId }}
                          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl border px-3 py-2 text-sm transition hover:border-primary/30 hover:bg-muted/35"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold">
                              {groupBy === "employee"
                                ? formatDate(row.date)
                                : (employee?.name ?? "Unknown employee")}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              active {formatMinutes(row.activeMinutes)} · idle{" "}
                              {formatMinutes(row.idleMinutes)} · {row.screenshotCount} shots
                            </p>
                          </div>
                          <div className="text-right font-mono text-sm font-bold">
                            {formatMinutes(row.totalMinutes)}
                          </div>
                          <StatusBadge status={row.status} />
                        </Link>
                      );
                    })}
                    {group.rows.length > 8 && (
                      <p className="text-center text-xs text-muted-foreground">
                        +{group.rows.length - 8} more entries. Use filters or open full timesheets.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function groupTimesheets(
  rows: Timesheet[],
  getKey: (row: Timesheet) => string,
): Array<[string, Timesheet[]]> {
  const groups = new Map<string, Timesheet[]>();
  for (const row of rows) {
    groups.set(getKey(row), [...(groups.get(getKey(row)) ?? []), row]);
  }
  return [...groups.entries()];
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
            icon={Clock}
            tone="warning"
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
          <StatCard
            label="Due next 7 days"
            value={upcoming.length}
            icon={CalendarDays}
            tone="default"
          />
        </Link>
        <Link to="/projects">
          <StatCard
            label="Checklist progress"
            value={`${progress}%`}
            icon={ListChecks}
            tone="info"
          />
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
        <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {employees.length === 0 ? (
            <EmptyRole text="No members in this team yet." />
          ) : (
            employees.map((employee) => {
              const own = tasks.filter(
                (task) =>
                  task.assigneeEmployeeId === employee.id ||
                  task.collaboratorEmployeeIds.includes(employee.id),
              );
              const current = tasks.find((task) => task.id === employee.currentTaskId);
              const currentChecklist = current?.checklist ?? [];
              const currentProgress = currentChecklist.length
                ? Math.round(
                    (currentChecklist.filter((item) => item.completed).length /
                      currentChecklist.length) *
                      100,
                  )
                : null;
              const active = metrics
                .filter((metric) => own.some((task) => task.id === metric.taskId))
                .reduce((sum, metric) => sum + metric.activeMinutes, 0);
              const completed = own.filter((task) => task.stage === "completed").length;
              const progress = own.length ? Math.round((completed / own.length) * 100) : 0;
              return (
                <Link
                  key={employee.id}
                  to="/employees/$employeeId"
                  params={{ employeeId: employee.id }}
                  className="rounded-2xl border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <AvatarName name={employee.name} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold">{employee.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {employee.jobTitle || "Member"}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={employee.status} />
                  </div>
                  <div className="mt-4 rounded-xl bg-muted/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        Current work
                      </p>
                      {currentProgress !== null && (
                        <span
                          className={`text-[11px] font-extrabold ${progressTextTone(currentProgress)}`}
                        >
                          {currentProgress}%
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold">
                      {current?.name ?? "No current task"}
                    </p>
                    {currentProgress !== null && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
                        <div
                          className={`h-full rounded-full transition-all ${progressBarTone(currentProgress)}`}
                          style={{ width: `${Math.max(currentProgress, 6)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl border p-2">
                      <p className="text-base font-extrabold">{own.length}</p>
                      <p className="text-muted-foreground">Tasks</p>
                    </div>
                    <div className="rounded-xl border p-2">
                      <p className="text-base font-extrabold">{progress}%</p>
                      <p className="text-muted-foreground">Done</p>
                    </div>
                    <div className="rounded-xl border p-2">
                      <p className="text-base font-extrabold">{formatMinutes(active)}</p>
                      <p className="text-muted-foreground">Tracked</p>
                    </div>
                  </div>
                  {own.length > 0 && (
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${progressBarTone(progress)}`}
                        style={{ width: `${Math.max(progress, 4)}%` }}
                      />
                    </div>
                  )}
                </Link>
              );
            })
          )}
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
