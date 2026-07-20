import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Plus,
  Search,
  UserPlus,
  UserCircle,
  ShieldCheck,
  KeyRound,
  ArrowLeft,
  Activity,
  UsersRound,
  Mail,
  RefreshCw,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { getEmployee, listEmployees } from "@/api/employees";
import { listUsers, updateUser } from "@/api/users";
import { listTeams } from "@/api/teams";
import {
  archivePerson,
  deletePerson,
  invitePerson,
  resendPersonInvitation,
  restorePerson,
  type PersonInvitationSummary,
} from "@/api/people";
import {
  getAdminAccess,
  getPermissionCatalog,
  updateAdminAccess,
  type PermissionDefinition,
} from "@/api/access";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { toast } from "sonner";
import type { DataScope, Employee, PermissionMode, Role, Team, User } from "@/types";
import { LiveActivityPage } from "./_app.live-activity";

export const Route = createFileRoute("/_app/people")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab:
      search.tab === "directory"
        ? "directory"
        : search.tab === "archived"
          ? "archived"
        : search.tab === "live" || search.tab === "employees"
          ? "live"
          : "directory",
  }),
  component: PeopleHubPage,
});

// A person is either a tracked Employee (no dashboard login — uses a desktop
// email invitation + password) or an admin User (dashboard login with a password
// + role). This hub is the single place to create and manage both.
type PersonKind = "employee" | "team_owner" | "general_admin" | "hr";
type TypeFilter = "all" | "employees" | "admins";
type RoleFilter = "all" | "employee" | Role;
type StatusFilter = "all" | "active" | "invited" | "archived";
type AccessPreset = Role | "custom";

type PersonRow = {
  id: string;
  kind: "employee" | "admin";
  name: string;
  email: string;
  roleLabel: string;
  detail: string;
  status: "active" | "invited" | "expired" | "archived";
  teamIds: string[];
  dashboardEmployeeId?: string;
  isCurrentUser: boolean;
  employee?: Employee;
  user?: User;
};

function employeeDirectoryStatus(employee: Employee): PersonRow["status"] {
  if (employee.accountStatus === "invited") {
    return employee.invitation?.status === "expired" ? "expired" : "invited";
  }
  return employee.active ? "active" : "archived";
}

function PeopleHubPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const tab =
    search.tab === "live" && !can(permissions.liveActivityView) ? "directory" : search.tab;

  return (
    <div className="studio-page">
      <PageHeader
        title="People"
        description="Manage people, employee tracking, and live workforce activity from one place."
      />
      <div className="studio-card mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border bg-card p-1">
        <Button
          variant="ghost"
          className={`rounded-lg border-0 px-4 ${tab === "directory" ? "bg-[#fce3ec] text-[#e5185d] dark:bg-[#38142b] dark:text-[#f0538b]" : "text-muted-foreground"}`}
          onClick={() => navigate({ to: "/people", search: { tab: "directory" }, replace: true })}
        >
          <UsersRound className="mr-2 h-4 w-4" /> Directory & access
        </Button>
        <Button
          variant="ghost"
          className={`rounded-lg border-0 px-4 ${tab === "archived" ? "bg-[#fce3ec] text-[#e5185d] dark:bg-[#38142b] dark:text-[#f0538b]" : "text-muted-foreground"}`}
          onClick={() => navigate({ to: "/people", search: { tab: "archived" }, replace: true })}
        >
          <Archive className="mr-2 h-4 w-4" /> Archived
        </Button>
        {can(permissions.liveActivityView) && (
          <Button
            variant="ghost"
            className={`rounded-lg border-0 px-4 ${tab === "live" ? "bg-[#fce3ec] text-[#e5185d] dark:bg-[#38142b] dark:text-[#f0538b]" : "text-muted-foreground"}`}
            onClick={() => navigate({ to: "/people", search: { tab: "live" }, replace: true })}
          >
            <Activity className="mr-2 h-4 w-4" /> Live activity
          </Button>
        )}
      </div>
      {tab === "directory" ? (
        <PeopleDirectory embedded />
      ) : tab === "archived" ? (
        <PeopleDirectory embedded archiveOnly />
      ) : (
        <LiveActivityPage embedded />
      )}
    </div>
  );
}

function PeopleDirectory({
  embedded = false,
  archiveOnly = false,
}: {
  embedded?: boolean;
  archiveOnly?: boolean;
}) {
  const { can, user: currentUser, refreshUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const users = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    enabled: can(permissions.accessManage),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: () => listEmployees(),
    staleTime: 20_000,
    placeholderData: (previous) => previous,
  });
  const teams = useQuery({
    queryKey: ["teams"],
    queryFn: () => listTeams(),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<PersonRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PersonRow | null>(null);

  // Admin edit ("manage access") state.
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<Role>("team_owner");
  const [editPreset, setEditPreset] = useState<AccessPreset>("team_owner");
  const [editPermissionMode, setEditPermissionMode] = useState<PermissionMode>("role");
  const [editDataScope, setEditDataScope] = useState<DataScope>("assigned_teams");
  const [editTeamIds, setEditTeamIds] = useState<string[]>([]);
  const [editTrackAsEmployee, setEditTrackAsEmployee] = useState(false);
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const canChangeRoles = currentUser?.role === "general_admin";

  const catalog = useQuery({
    queryKey: ["permission-catalog"],
    queryFn: getPermissionCatalog,
    enabled: Boolean(editUser) && can(permissions.accessManage),
    staleTime: 5 * 60_000,
  });

  const access = useQuery({
    queryKey: ["admin-access", editUser?.id],
    queryFn: () => getAdminAccess(editUser!.id),
    enabled: Boolean(editUser) && can(permissions.accessManage),
  });

  useEffect(() => {
    if (!access.data) return;
    setEditRole(access.data.role);
    setEditPreset(access.data.permissionMode === "custom" ? "custom" : access.data.role);
    setEditPermissionMode(access.data.permissionMode);
    setEditDataScope(access.data.dataScope);
    setEditTeamIds(access.data.teamLeadTeamIds);
    setEditTrackAsEmployee(access.data.trackAsEmployee);
    setEditPermissions(access.data.effectivePermissions);
  }, [access.data]);

  const teamNames = useMemo(
    () => new Map((teams.data ?? []).map((team) => [team.id, team.name])),
    [teams.data],
  );
  const activeTeams = useMemo(
    () => (teams.data ?? []).filter((team) => team.status === "active"),
    [teams.data],
  );

  const rows = useMemo<PersonRow[]>(() => {
    const employeeRows: PersonRow[] = (employees.data ?? []).map((employee) => ({
      id: employee.id,
      kind: "employee",
      name: employee.name,
      email: employee.email,
      roleLabel: "Employee",
      detail: employee.jobTitle || "—",
      status: employeeDirectoryStatus(employee),
      teamIds: employee.teamIds,
      dashboardEmployeeId: employee.id,
      isCurrentUser:
        currentUser?.employeeId === employee.id || currentUser?.trackedEmployeeId === employee.id,
      employee,
    }));
    const adminJobTitle = (user: User) =>
      user.jobTitle && user.jobTitle !== "Management" ? user.jobTitle : "";
    const adminRows: PersonRow[] = (users.data ?? []).map((user) => ({
      id: user.id,
      kind: "admin",
      name: user.name,
      email: user.email,
      roleLabel:
        user.role === "hr"
          ? "HR"
          : user.role === "general_admin"
            ? user.teamLeadTeamIds.length
              ? "General admin · Team lead"
              : "General admin"
            : "Team lead",
      detail:
        adminJobTitle(user) ||
        (user.dataScope === "company"
          ? "All teams"
          : user.teamLeadTeamIds
              .map((id) => teamNames.get(id))
              .filter(Boolean)
              .join(", ") || "—"),
      status: user.status === "active" ? "active" : "archived",
      teamIds: user.dataScope === "company" ? activeTeams.map((team) => team.id) : user.teamLeadTeamIds,
      dashboardEmployeeId: user.trackedEmployeeId,
      isCurrentUser: currentUser?.id === user.id,
      user,
    }));
    const adminEmployeeIds = new Set(
      (users.data ?? [])
        .map((user) => user.trackedEmployeeId ?? user.employeeId)
        .filter(Boolean),
    );
    const adminEmails = new Set((users.data ?? []).map((user) => user.email.toLowerCase()));
    const unlinkedEmployeeRows = employeeRows.filter(
      (row) =>
        !adminEmployeeIds.has(row.id) &&
        !adminEmails.has(row.email.toLowerCase()),
    );
    const all = [...adminRows, ...unlinkedEmployeeRows];
    return all.filter((row) => {
      if (archiveOnly && row.status !== "archived") return false;
      if (!archiveOnly && statusFilter === "all" && row.status === "archived") return false;
      if (typeFilter === "employees" && row.kind !== "employee") return false;
      if (typeFilter === "admins" && row.kind !== "admin") return false;
      if (roleFilter === "employee" && row.kind !== "employee") return false;
      if (roleFilter !== "all" && roleFilter !== "employee" && row.user?.role !== roleFilter)
        return false;
      if (teamFilter !== "all" && !row.teamIds.includes(teamFilter)) return false;
      if (!archiveOnly) {
        if (statusFilter === "active" && row.status !== "active") return false;
        if (statusFilter === "invited" && row.status !== "invited" && row.status !== "expired")
          return false;
        if (statusFilter === "archived" && row.status !== "archived") return false;
      }
      if (q && !`${row.name} ${row.email}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [
    employees.data,
    users.data,
    teamNames,
    activeTeams,
    currentUser?.id,
    currentUser?.employeeId,
    currentUser?.trackedEmployeeId,
    typeFilter,
    roleFilter,
    teamFilter,
    statusFilter,
    archiveOnly,
    q,
  ]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editUser) throw new Error("Choose a person to manage.");
      await updateUser(editUser.id, {
        name: editName,
        email: editEmail,
        password: editPassword || undefined,
      });
      const base = new Set(
        editPermissionMode === "role" ? (catalog.data?.rolePresets?.[editRole] ?? []) : [],
      );
      const selected = new Set(editPermissions);
      const overrides = Object.fromEntries(
        (catalog.data?.permissions ?? [])
          .filter((permission) =>
            editPermissionMode === "custom"
              ? selected.has(permission.key)
              : selected.has(permission.key) !== base.has(permission.key),
          )
          .map((permission) => [permission.key, selected.has(permission.key)]),
      );
      return updateAdminAccess(editUser.id, {
        role: editRole,
        permissionMode: editPermissionMode,
        dataScope: editRole === "team_owner" ? "assigned_teams" : editDataScope,
        permissionOverrides: overrides,
        teamLeadTeamIds: editTeamIds,
        trackAsEmployee: editTrackAsEmployee,
      });
    },
    onSuccess: async () => {
      toast.success("Access updated");
      setEditUser(null);
      setEditPassword("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-access"] }),
      ]);
      if (editUser?.id === currentUser?.id) await refreshUser();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to update access"),
  });

  const archiveMutation = useMutation({
    mutationFn: ({ row, archived }: { row: PersonRow; archived: boolean }) =>
      archived ? archivePerson(row.kind, row.id) : restorePerson(row.kind, row.id),
    onSuccess: async (result) => {
      toast.success(result.archived ? "Person archived" : "Person restored");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to change archive status"),
  });

  const deleteMutation = useMutation({
    mutationFn: (row: PersonRow) => deletePerson(row.kind, row.id),
    onSuccess: async () => {
      toast.success("Person deleted");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to delete person"),
  });

  const resendMutation = useMutation({
    mutationFn: resendPersonInvitation,
    onSuccess: async ({ emailQueued }) => {
      toast.success(
        emailQueued ? "Invitation sent again" : "Invitation renewed, but email was not queued",
      );
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to resend invitation"),
  });

  function openEdit(user: User) {
    setEditUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditPassword("");
    setEditRole(user.role);
    setEditPreset(user.permissionMode === "custom" ? "custom" : user.role);
    setEditPermissionMode(user.permissionMode);
    setEditDataScope(user.dataScope);
    setEditTeamIds(user.teamLeadTeamIds);
    setEditTrackAsEmployee(user.trackAsEmployee);
    setEditPermissions(user.permissions);
  }

  function choosePreset(preset: AccessPreset) {
    if (!canChangeRoles) {
      toast.error("Only General admins can change roles.");
      return;
    }
    setEditPreset(preset);
    if (preset === "custom") {
      setEditPermissionMode("custom");
      return;
    }
    setEditRole(preset);
    setEditPermissionMode("role");
    setEditDataScope(preset === "general_admin" || preset === "hr" ? "company" : "assigned_teams");
    setEditPermissions(catalog.data?.rolePresets?.[preset] ?? []);
  }

  function changeBaseRole(role: Role) {
    if (!canChangeRoles) {
      toast.error("Only General admins can change roles.");
      return;
    }
    setEditRole(role);
    if (role === "team_owner") {
      setEditDataScope("assigned_teams");
    }
    if (editPermissionMode === "custom" && editPreset !== "custom") {
      setEditPreset("custom");
    }
  }

  function changeDataScope(scope: DataScope) {
    if (editRole === "team_owner" && scope === "company") {
      toast.error("Team leads can only see assigned teams.");
      return;
    }
    setEditDataScope(scope);
  }

  const visiblePermissionKeys = useMemo(() => {
    if (!catalog.data) return [];
    if (editPermissionMode === "custom") return editPermissions;
    return catalog.data.rolePresets?.[editRole] ?? [];
  }, [catalog.data, editPermissionMode, editPermissions, editRole]);

  function changeArchiveStatus(row: PersonRow, archived: boolean) {
    if (row.isCurrentUser) {
      toast.error("You cannot archive your own account.");
      return;
    }
    if (archived) {
      setArchiveTarget(row);
      return;
    }
    archiveMutation.mutate({ row, archived });
  }

  function deleteArchivedPerson(row: PersonRow) {
    if (row.isCurrentUser) {
      toast.error("You cannot delete your own account.");
      return;
    }
    if (row.status !== "archived") {
      toast.error("Archive this person before deleting them.");
      return;
    }
    setDeleteTarget(row);
  }

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="People"
          description="One place to add anyone — employees and admins — set how they sign in, and manage their role."
          actions={
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add person
            </Button>
          }
        />
      )}
      {embedded && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <div>
            <h2 className="text-sm font-semibold">
              {archiveOnly ? "Archived people" : "People directory & access"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {archiveOnly
                ? "Restore archived people here, or delete them to free their email for reuse."
                : "Add employees, Team Managers, or General Admins and choose their teams and sign-in method."}
            </p>
          </div>
          {!archiveOnly && (
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add person
            </Button>
          )}
        </div>
      )}

      <Card className="mb-4 p-4">
        <div
          className={`grid gap-3 ${
            archiveOnly
              ? "md:grid-cols-[minmax(260px,2fr)_repeat(3,minmax(150px,1fr))]"
              : "md:grid-cols-[minmax(260px,2fr)_repeat(4,minmax(150px,1fr))]"
          }`}
        >
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
            <SelectTrigger>
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              <SelectItem value="employees">Employees</SelectItem>
              <SelectItem value="admins">Admins</SelectItem>
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as RoleFilter)}>
            <SelectTrigger>
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="employee">Employee</SelectItem>
              <SelectItem value="team_owner">Team lead</SelectItem>
              <SelectItem value="hr">HR</SelectItem>
              <SelectItem value="general_admin">General admin</SelectItem>
            </SelectContent>
          </Select>
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {activeTeams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!archiveOnly && (
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All active/invited</SelectItem>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="invited">Invited / expired</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        {(q ||
          typeFilter !== "all" ||
          roleFilter !== "all" ||
          teamFilter !== "all" ||
          (!archiveOnly && statusFilter !== "all")) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className="text-xs font-medium text-muted-foreground">
              Showing {rows.length} {archiveOnly ? "archived" : ""} people with current filters.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                setTypeFilter("all");
                setRoleFilter("all");
                setTeamFilter("all");
                setStatusFilter("all");
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Type / role</TableHead>
              <TableHead>Teams / job title</TableHead>
              <TableHead>Sign-in</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.kind}-${row.id}`}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.email}</TableCell>
                <TableCell className="text-sm">{row.roleLabel}</TableCell>
                <TableCell className="text-sm">{row.detail}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.kind === "employee"
                    ? row.status === "invited" || row.status === "expired"
                      ? "Email invitation"
                      : "Password"
                    : "Password"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="space-x-1 text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    {row.dashboardEmployeeId && (row.kind === "admin" || row.status === "active") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full border-[#e5185d]/25 bg-[#fce3ec]/55 text-[#e5185d] hover:bg-[#fce3ec]"
                        onClick={() =>
                          navigate({
                            to: "/employees/$employeeId",
                            params: { employeeId: row.dashboardEmployeeId! },
                          })
                        }
                      >
                        <Activity className="mr-1.5 h-3.5 w-3.5" />
                        Employee profile
                      </Button>
                    )}
                    {row.isCurrentUser && !row.dashboardEmployeeId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate({ to: "/profile" })}
                      >
                        <UserCircle className="mr-1.5 h-3.5 w-3.5" />
                        My profile
                      </Button>
                    )}
                    {row.kind === "employee" ? (
                    <>
                      {(row.status === "invited" || row.status === "expired") &&
                        row.employee?.invitation && (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={resendMutation.isPending}
                            disabled={resendMutation.isPending}
                            onClick={() => resendMutation.mutate(row.employee!.invitation!.id)}
                          >
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                            Resend invitation
                          </Button>
                        )}
                      {can(permissions.peopleArchive) &&
                        !row.isCurrentUser &&
                        row.status !== "archived" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          loading={archiveMutation.isPending}
                          disabled={archiveMutation.isPending}
                          onClick={() => changeArchiveStatus(row, true)}
                        >
                          <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
                        </Button>
                      )}
                      {can(permissions.peopleArchive) &&
                        !row.isCurrentUser &&
                        row.status === "archived" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={archiveMutation.isPending}
                            disabled={archiveMutation.isPending}
                            onClick={() => changeArchiveStatus(row, false)}
                          >
                            <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" /> Restore
                          </Button>
                          {archiveOnly && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              loading={deleteMutation.isPending}
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteArchivedPerson(row)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                            </Button>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {!row.isCurrentUser && canChangeRoles && (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(row.user!)}>
                          Permissions
                        </Button>
                      )}
                      {can(permissions.peopleArchive) &&
                        !row.isCurrentUser &&
                        row.status !== "archived" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          loading={archiveMutation.isPending}
                          disabled={archiveMutation.isPending}
                          onClick={() => changeArchiveStatus(row, true)}
                        >
                          <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
                        </Button>
                      )}
                      {can(permissions.peopleArchive) &&
                        !row.isCurrentUser &&
                        row.status === "archived" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={archiveMutation.isPending}
                            disabled={archiveMutation.isPending}
                            onClick={() => changeArchiveStatus(row, false)}
                          >
                            <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" /> Restore
                          </Button>
                          {archiveOnly && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              loading={deleteMutation.isPending}
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteArchivedPerson(row)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                            </Button>
                          )}
                        </>
                      )}
                    </>
                  )}
                    {row.isCurrentUser && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
                        You
                      </span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No people match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <AddPersonWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        teams={teams.data ?? []}
        employees={employees.data ?? []}
        users={users.data ?? []}
        onCreated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["users"] }),
            queryClient.invalidateQueries({ queryKey: ["employees"] }),
            queryClient.invalidateQueries({ queryKey: ["teams"] }),
          ]);
        }}
      />

      {/* Manage admin access */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Role & permissions</DialogTitle>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              updateMutation.mutate();
            }}
          >
            <div className="max-h-[calc(88vh-132px)] space-y-3 overflow-y-auto px-5 py-4">
              <div className="rounded-xl border bg-muted/25 p-3">
                <p className="text-sm font-extrabold">How roles work</p>
                <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <RoleExplainer
                    title="Team lead"
                    body="Assigned teams only. No company-wide admin or payroll visibility."
                  />
                  <RoleExplainer
                    title="HR"
                    body="People, invitations, schedules, payroll and HR operations."
                  />
                  <RoleExplainer
                    title="General admin"
                    body="Company-wide access. Can also be team lead when needed."
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(event) => setEditEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-password">New password</Label>
                <Input
                  id="edit-password"
                  type="password"
                  value={editPassword}
                  onChange={(event) => setEditPassword(event.target.value)}
                  minLength={editPassword ? 8 : undefined}
                  placeholder="Leave blank to keep current"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role preset</Label>
                <Select
                  value={editPreset}
                  onValueChange={(value) => choosePreset(value as AccessPreset)}
                  disabled={!canChangeRoles}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team_owner">Team lead</SelectItem>
                    <SelectItem value="hr">HR</SelectItem>
                    <SelectItem value="general_admin">General admin</SelectItem>
                    <SelectItem value="custom">Custom permissions</SelectItem>
                  </SelectContent>
                </Select>
                {!canChangeRoles && (
                  <p className="text-xs text-muted-foreground">
                    Only General admins can change roles and permission presets.
                  </p>
                )}
              </div>
              </div>

              <div className="rounded-xl border p-3">
              <Label>Access scope</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => changeDataScope("assigned_teams")}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm transition hover:bg-muted/60",
                    editDataScope === "assigned_teams" && "border-[#e5185d] bg-[#fce3ec]/50",
                  )}
                >
                  <span className="font-bold">Assigned teams</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Best for Team leads. They only see selected teams.
                  </span>
                </button>
                <button
                  type="button"
                  disabled={editRole === "team_owner"}
                  onClick={() => changeDataScope("company")}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-45",
                    editDataScope === "company" && "border-[#e5185d] bg-[#fce3ec]/50",
                  )}
                >
                  <span className="font-bold">Whole company</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Best for General admin and HR.
                  </span>
                </button>
              </div>
              </div>

              {editPermissionMode === "custom" && (
                <div className="space-y-1.5 rounded-xl border p-3">
                <Label>Base role for this custom account</Label>
                <Select
                  value={editRole}
                  onValueChange={(value) => changeBaseRole(value as Role)}
                  disabled={!canChangeRoles}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team_owner">Team lead</SelectItem>
                    <SelectItem value="hr">HR</SelectItem>
                    <SelectItem value="general_admin">General admin</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Team lead is limited to selected teams. General admin can be company-wide and can
                  also be assigned teams.
                </p>
              </div>
              )}

              {(editRole === "team_owner" || editRole === "general_admin") && (
                <TeamAccessSelector
                  teams={teams.data ?? []}
                  teamIds={editTeamIds}
                  onToggle={(id, checked) =>
                    setEditTeamIds((current) =>
                      checked ? [...new Set([...current, id])] : current.filter((x) => x !== id),
                    )
                  }
                />
              )}

              {(editRole === "team_owner" || editRole === "general_admin") && (
                <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <div>
                  <Label>Also track as employee</Label>
                  <p className="text-xs text-muted-foreground">
                    Use this when the admin/team lead also works on tasks and needs their own
                    employee dashboard.
                  </p>
                </div>
                <Switch checked={editTrackAsEmployee} onCheckedChange={setEditTrackAsEmployee} />
              </div>
              )}

              {editPermissionMode === "custom" && catalog.data && (
                <PermissionChecklist
                  permissions={catalog.data.permissions}
                  selected={editPermissions}
                  disabled={!canChangeRoles}
                  onToggle={(key, checked) =>
                    setEditPermissions((current) =>
                      checked ? [...new Set([...current, key])] : current.filter((x) => x !== key),
                    )
                  }
                />
              )}

              {catalog.data && (
                <PermissionPreview
                  role={editRole}
                  mode={editPermissionMode}
                  permissions={catalog.data.permissions}
                  selectedKeys={visiblePermissionKeys}
                />
              )}
            </div>

            <div className="flex justify-end gap-2 border-t bg-card px-5 py-4">
              <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save access"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will lose access and new tracking will stop, but their history will be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (archiveTarget) archiveMutation.mutate({ row: archiveTarget, archived: true });
                setArchiveTarget(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name} permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              Their email will become available again, but historical work records will be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddPersonWizard({
  open,
  onOpenChange,
  teams,
  employees,
  users,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: Team[];
  employees: Employee[];
  users: User[];
  onCreated: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<"type" | "form" | "work" | "review" | "invited">("type");
  const [kind, setKind] = useState<PersonKind>("employee");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [annualLeaveDays, setAnnualLeaveDays] = useState(21);
  const [shiftStart, setShiftStart] = useState("09:00");
  const [shiftEnd, setShiftEnd] = useState("17:00");
  const [offDays, setOffDays] = useState<number[]>([5, 6]);
  const [salaryType, setSalaryType] = useState<"monthly" | "hourly">("monthly");
  const [salaryAmount, setSalaryAmount] = useState("0");
  const [hourlyRate, setHourlyRate] = useState("0");
  const [salaryCurrency, setSalaryCurrency] = useState("EGP");
  const [breaks, setBreaks] = useState([
    { name: "Lunch", start_time: "13:00", end_time: "13:30", minutes: 30, paid: true },
    { name: "Short break", start_time: "15:30", end_time: "15:45", minutes: 15, paid: true },
  ]);

  // Invitation confirmation (employee only).
  const [createdEmployee, setCreatedEmployee] = useState<Employee | null>(null);
  const [createdInvitation, setCreatedInvitation] = useState<PersonInvitationSummary>();
  const [invitationEmailQueued, setInvitationEmailQueued] = useState(false);

  function reset() {
    setStep("type");
    setKind("employee");
    setName("");
    setEmail("");
    setJobTitle("");
    setTeamIds([]);
    setStartDate(""); setAnnualLeaveDays(21); setShiftStart("09:00"); setShiftEnd("17:00");
    setOffDays([5, 6]); setSalaryType("monthly"); setSalaryAmount("0"); setHourlyRate("0"); setSalaryCurrency("EGP");
    setBreaks([{ name: "Lunch", start_time: "13:00", end_time: "13:30", minutes: 30, paid: true }, { name: "Short break", start_time: "15:30", end_time: "15:45", minutes: 15, paid: true }]);
    setCreatedEmployee(null);
    setCreatedInvitation(undefined);
    setInvitationEmailQueued(false);
  }

  function close() {
    onOpenChange(false);
    // Delay reset so the closing animation doesn't flash the first step.
    setTimeout(reset, 200);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existingPerson = normalizedEmail
    ? (() => {
        const employee = employees.find((item) => item.email.toLowerCase() === normalizedEmail);
        if (employee) {
          return {
            type: "employee" as const,
            name: employee.name,
            status: employeeDirectoryStatus(employee),
            id: employee.id,
          };
        }
        const user = users.find((item) => item.email.toLowerCase() === normalizedEmail);
        if (user) {
          return {
            type: "admin" as const,
            name: user.name,
            status: user.status,
            id: user.id,
          };
        }
        return null;
      })()
    : null;
  const existingPersonMessage = existingPerson
    ? `${existingPerson.name} already exists as ${existingPerson.type === "employee" ? "an employee" : "an admin"} (${existingPerson.status}).`
    : null;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (existingPerson) {
        throw new Error(existingPersonMessage ?? "A person with this email already exists.");
      }
      const invitation = await invitePerson({
        name,
        email,
        kind: kind === "team_owner" ? "team_manager" : kind,
        teamIds,
        jobTitle,
        timezone: "Africa/Cairo",
        startDate: kind === "employee" ? startDate : undefined,
        annualLeaveDays: kind === "employee" ? annualLeaveDays : undefined,
        workProfile: kind === "employee" ? {
          shiftStart, shiftEnd,
          workingDays: [0, 1, 2, 3, 4, 5, 6].filter((day) => !offDays.includes(day)),
          weeklyOffDays: offDays,
          requiredDailyMinutes: Math.max(60, requiredDailyMinutes),
          breakRules: breaks,
          lateGraceMinutes: 15,
          overtimeEnabled: true,
          overtimeBasis: "outside_shift",
          overtimeRateMultiplier: 1,
          salaryAmount: salaryType === "monthly" ? Number(salaryAmount) : Number(hourlyRate),
          salaryCurrency,
          salaryType,
        } : undefined,
      });
      const employee = invitation.employeeId ? await getEmployee(invitation.employeeId) : undefined;
      return { kind, employee, invitation };
    },
    onSuccess: async (result) => {
      await onCreated();
      if (result.kind === "employee" && result.employee) {
        setCreatedEmployee(result.employee);
        setCreatedInvitation(result.invitation.invitation);
        setInvitationEmailQueued(result.invitation.emailQueued);
        setStep("invited");
        toast.success(
          result.invitation.emailQueued
            ? "Employee invited"
            : "Employee created, but the invitation email was not queued",
        );
      } else {
        toast.success(
          result.invitation.emailQueued
            ? "Account created and invitation queued"
            : "Account created, but the invitation email was not queued",
        );
        close();
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to create person"),
  });

  const resendCreatedInvitationMutation = useMutation({
    mutationFn: () => resendPersonInvitation(createdInvitation!.id),
    onSuccess: ({ invitation, emailQueued }) => {
      setCreatedInvitation(invitation);
      setInvitationEmailQueued(emailQueued);
      toast.success(
        emailQueued ? "Invitation sent again" : "Invitation renewed, but email was not queued",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to resend invitation"),
  });

  function submitForm(event: FormEvent) {
    event.preventDefault();
    if (existingPerson) {
      toast.error(existingPersonMessage ?? "A person with this email already exists.");
      return;
    }
    setStep(kind === "employee" ? "work" : "review");
  }

  const shiftTimeOptions = Array.from({ length: 96 }, (_, index) => {
    const hours = Math.floor(index / 4);
    const minutes = (index % 4) * 15;
    const value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    const hour12 = hours % 12 || 12;
    return { value, label: `${hour12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}` };
  });
  const timeToMinutes = (value: string) => {
    const [hours = 0, minutes = 0] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const minutesToTime = (value: number) => {
    const safeValue = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
    return `${String(Math.floor(safeValue / 60)).padStart(2, "0")}:${String(safeValue % 60).padStart(2, "0")}`;
  };
  const shiftStartMinutes = timeToMinutes(shiftStart);
  const shiftEndMinutes = timeToMinutes(shiftEnd);
  const breakTimeOptions = shiftTimeOptions.filter((option) => {
    const minutes = timeToMinutes(option.value);
    return minutes >= shiftStartMinutes && minutes <= shiftEndMinutes;
  });
  const breakStartOptions = breakTimeOptions.filter((option) => timeToMinutes(option.value) < shiftEndMinutes);
  const nextBreakEnd = (startTime: string, duration = 15) =>
    minutesToTime(Math.min(shiftEndMinutes, timeToMinutes(startTime) + Math.max(1, duration)));
  const addBreak = () =>
    setBreaks((items) => [
      ...items,
      {
        name: `Break ${items.length + 1}`,
        start_time: shiftStart,
        end_time: nextBreakEnd(shiftStart, 15),
        minutes: 15,
        paid: true,
      },
    ]);
  const updateBreakStart = (index: number, startTime: string) =>
    setBreaks((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        const duration = Math.max(1, row.minutes || timeToMinutes(row.end_time) - timeToMinutes(row.start_time) || 15);
        return { ...row, start_time: startTime, end_time: nextBreakEnd(startTime, duration), minutes: Math.min(duration, Math.max(1, shiftEndMinutes - timeToMinutes(startTime))) };
      }),
    );
  const updateBreakEnd = (index: number, endTime: string) =>
    setBreaks((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        const startMinutes = timeToMinutes(row.start_time);
        const safeEndMinutes = Math.max(startMinutes + 1, timeToMinutes(endTime));
        return {
          ...row,
          end_time: minutesToTime(Math.min(shiftEndMinutes, safeEndMinutes)),
          minutes: Math.max(1, Math.min(shiftEndMinutes, safeEndMinutes) - startMinutes),
        };
      }),
    );
  useEffect(() => {
    setBreaks((rows) => {
      let changed = false;
      const normalized = rows.map((row) => {
        const duration = Math.max(1, row.minutes || 15);
        const startMinutes = Math.max(
          shiftStartMinutes,
          Math.min(timeToMinutes(row.start_time), Math.max(shiftStartMinutes, shiftEndMinutes - 1)),
        );
        const endMinutes = Math.min(
          shiftEndMinutes,
          Math.max(startMinutes + 1, timeToMinutes(row.end_time) <= startMinutes ? startMinutes + duration : timeToMinutes(row.end_time)),
        );
        const next = {
          ...row,
          start_time: minutesToTime(startMinutes),
          end_time: minutesToTime(endMinutes),
          minutes: Math.max(1, endMinutes - startMinutes),
        };
        changed =
          changed ||
          next.start_time !== row.start_time ||
          next.end_time !== row.end_time ||
          next.minutes !== row.minutes;
        return next;
      });
      return changed ? normalized : rows;
    });
  }, [breaks, shiftEnd, shiftStart]);
  const firstYearLeaveCredit = (() => {
    if (!startDate) return null;
    const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
    const targetMonthStart = new Date(startYear, startMonth - 1 + 6, 1, 12);
    const targetMonthLastDay = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0).getDate();
    const eligibleAt = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth(), Math.min(startDay, targetMonthLastDay), 12);
    const fullYearCredit = eligibleAt.getFullYear() > startYear;
    const remainingFullMonths = fullYearCredit ? 12 : 12 - (eligibleAt.getMonth() + 1);
    return {
      eligibleAt: eligibleAt.toLocaleDateString(),
      months: remainingFullMonths,
      days: fullYearCredit ? annualLeaveDays : Number(((remainingFullMonths * annualLeaveDays) / 12).toFixed(2)),
      fullYearCredit,
    };
  })();
  const displayedLeaveDays = firstYearLeaveCredit?.days ?? annualLeaveDays;
  const leaveCreditHelp = firstYearLeaveCredit
    ? firstYearLeaveCredit.fullYearCredit
      ? `Eligible after 6 months on ${firstYearLeaveCredit.eligibleAt}. New calendar year, so full ${annualLeaveDays} days.`
      : `Eligible after 6 months on ${firstYearLeaveCredit.eligibleAt}. Rest of year: (${firstYearLeaveCredit.months} months / 12) x ${annualLeaveDays} = ${firstYearLeaveCredit.days} days.`
    : `Default: ${annualLeaveDays} days per full calendar year.`;
  const shiftMinutes = Math.max(
    0,
    Math.round(
      (new Date(`2000-01-01T${shiftEnd}`).getTime() -
        new Date(`2000-01-01T${shiftStart}`).getTime()) /
        60000,
    ),
  );
  const requiredDailyMinutes = shiftMinutes;
  const estimatedMonthlyHours = (requiredDailyMinutes / 60) * 30;
  const calculatedHourlyRate =
    estimatedMonthlyHours > 0 ? Number(salaryAmount || 0) / estimatedMonthlyHours : 0;
  const calculatedMonthlySalary = Number(hourlyRate || 0) * estimatedMonthlyHours;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === "type" && "Add a person"}
            {step === "form" && `New ${kindLabel(kind).toLowerCase()}`}
            {step === "work" && "Work, breaks and salary"}
            {step === "review" && "Review and send invitation"}
            {step === "invited" && "Invitation sent"}
          </DialogTitle>
        </DialogHeader>

        {step === "type" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pick what you are adding. This decides how they sign in.
            </p>
            <TypeOption
              active={kind === "employee"}
              onClick={() => setKind("employee")}
              icon={UserCircle}
              title="Employee"
              subtitle="Tracked worker. Receives an email invitation to choose a password, then signs in to the desktop app with that email."
            />
            <TypeOption
              active={kind === "team_owner"}
              onClick={() => setKind("team_owner")}
              icon={UserPlus}
              title="Team leader"
              subtitle="Manages assigned teams in the dashboard and has an Employee profile, so they can receive and track their own tasks."
            />
            <TypeOption
              active={kind === "general_admin"}
              onClick={() => setKind("general_admin")}
              icon={ShieldCheck}
              title="General admin"
              subtitle="Company-wide admin with access to every team and permission to review a team leader's own task."
            />
            <TypeOption
              active={kind === "hr"}
              onClick={() => setKind("hr")}
              icon={KeyRound}
              title="HR"
              subtitle="Manages employee profiles, schedules, payroll, deductions, overtime and invitations."
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => setStep("form")}>Continue</Button>
            </div>
          </div>
        )}

        {step === "form" && (
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="person-name">Name</Label>
                <Input
                  id="person-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="person-email">Work email</Label>
                <Input
                  id="person-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                {existingPersonMessage && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                    {existingPersonMessage}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="person-job-title">Job title</Label>
                <Input
                  id="person-job-title"
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                  placeholder={
                    kind === "employee"
                      ? "e.g. AI Engineer"
                      : kind === "team_owner"
                        ? "e.g. AI team lead"
                        : kind === "hr"
                          ? "e.g. HR Manager"
                          : "e.g. Operations Manager"
                  }
                />
              </div>
              {kind === "employee" && (
                <p className="self-end rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  We will email a secure, expiring link so the employee can choose their own
                  password. You will not need to create or share a password.
                </p>
              )}
              {kind !== "employee" && (
                <p className="self-end rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  A secure temporary password will be generated and included in the invitation
                  email.
                </p>
              )}
            </div>

            {(kind === "employee" || kind === "team_owner") && (
              <TeamAccessSelector
                teams={teams}
                teamIds={teamIds}
                onToggle={(id, checked) =>
                  setTeamIds((current) =>
                    checked ? [...new Set([...current, id])] : current.filter((x) => x !== id),
                  )
                }
              />
            )}
            {kind === "employee" && teamIds.length === 0 && (
              <p className="text-xs text-destructive">
                Choose at least one team. Every employee needs a team before tracking work.
              </p>
            )}

            <div className="flex justify-between gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setStep("type")}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    createMutation.isPending ||
                    Boolean(existingPerson) ||
                    ((kind === "employee" || kind === "team_owner") && teamIds.length === 0)
                  }
                >
                  {createMutation.isPending
                    ? kind === "employee"
                      ? "Sending..."
                      : "Creating..."
                    : kind === "employee"
                      ? "Next"
                      : `Create ${kindLabel(kind).toLowerCase()}`}
                </Button>
              </div>
            </div>
          </form>
        )}

        {step === "work" && kind === "employee" && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Employment start date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></div>
              <div><Label>Annual leave entitlement</Label><Input type="number" min={0} max={365} value={displayedLeaveDays} readOnly className="bg-muted" /><p className="mt-1 text-xs text-muted-foreground">{leaveCreditHelp}</p></div>
              <div><Label>Shift starts</Label><Select value={shiftStart} onValueChange={setShiftStart}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="max-h-72">{shiftTimeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Shift ends</Label><Select value={shiftEnd} onValueChange={setShiftEnd}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="max-h-72">{shiftTimeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><Label>Weekly days off</Label><div className="mt-2 flex flex-wrap gap-2">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, day) => <label key={label} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Checkbox checked={offDays.includes(day)} onCheckedChange={(checked) => setOffDays((current) => checked ? [...new Set([...current, day])] : current.filter((item) => item !== day))} />{label}</label>)}</div></div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Breaks (must be inside the shift)</Label>
                <Button type="button" size="sm" variant="outline" onClick={addBreak}>
                  <Plus className="mr-1 h-4 w-4" />Add break
                </Button>
              </div>
              {breaks.map((item, index) => (
                <div key={index} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_130px_130px_100px_auto]">
                  <Input value={item.name} onChange={(e) => setBreaks((rows) => rows.map((row, i) => i === index ? { ...row, name: e.target.value } : row))} />
                  <Select value={item.start_time} onValueChange={(value) => updateBreakStart(index, value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">{breakStartOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={item.end_time} onValueChange={(value) => updateBreakEnd(index, value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">{breakTimeOptions.filter((option) => timeToMinutes(option.value) > timeToMinutes(item.start_time)).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-sm"><Switch checked={item.paid} onCheckedChange={(paid) => setBreaks((rows) => rows.map((row, i) => i === index ? { ...row, paid } : row))} />Paid</label>
                  <Button type="button" size="icon" variant="ghost" onClick={() => setBreaks((rows) => rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><Label>Salary type</Label><Select value={salaryType} onValueChange={(value) => setSalaryType(value as typeof salaryType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="hourly">Hourly</SelectItem></SelectContent></Select></div>
              <div><Label>Monthly salary</Label><Input type="number" min={0} step="0.01" value={salaryType === "monthly" ? salaryAmount : calculatedMonthlySalary.toFixed(2)} readOnly={salaryType === "hourly"} className={salaryType === "hourly" ? "bg-muted" : undefined} onKeyDown={(event) => { if (salaryAmount === "0" && /^\d$/.test(event.key)) { event.preventDefault(); setSalaryAmount(event.key); } }} onChange={(e) => setSalaryAmount(e.target.value)} /></div>
              <div><Label>Hourly rate</Label><Input type="number" min={0} step="0.01" value={salaryType === "monthly" ? calculatedHourlyRate.toFixed(2) : hourlyRate} readOnly={salaryType === "monthly"} className={salaryType === "monthly" ? "bg-muted" : undefined} onKeyDown={(event) => { if (hourlyRate === "0" && /^\d$/.test(event.key)) { event.preventDefault(); setHourlyRate(event.key); setSalaryAmount((Number(event.key) * estimatedMonthlyHours).toFixed(2)); } }} onChange={(e) => { setHourlyRate(e.target.value); setSalaryAmount((Number(e.target.value || 0) * estimatedMonthlyHours).toFixed(2)); }} /></div>
              <div><Label>Currency</Label><Select value={salaryCurrency} onValueChange={setSalaryCurrency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["EGP", "GBP", "USD", "EUR", "SAR", "AED"].map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <p className="text-xs text-muted-foreground">Calculated using 30 paid calendar days × shift hours = {estimatedMonthlyHours.toFixed(2)} paid hours/month. Weekly days off and scheduled breaks are paid and included.</p>
            <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">Time outside {shiftStart}–{shiftEnd} is categorized as overtime, paid at the normal hourly rate, and requires approval each time. Breaks are part of the shift hours and are never counted as idle.</p>
            <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep("form")}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button><Button disabled={!startDate || shiftEnd <= shiftStart || breaks.some((item) => item.start_time < shiftStart || item.end_time > shiftEnd || item.end_time <= item.start_time)} onClick={() => setStep("review")}>Review</Button></div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4"><div className="grid gap-3 rounded-xl border bg-muted/25 p-4 sm:grid-cols-2"><div><span className="text-xs text-muted-foreground">Name</span><p className="font-bold">{name}</p></div><div><span className="text-xs text-muted-foreground">Email</span><p className="font-bold">{email}</p></div><div><span className="text-xs text-muted-foreground">Role</span><p className="font-bold">{kindLabel(kind)}</p></div><div><span className="text-xs text-muted-foreground">Teams</span><p className="font-bold">{teams.filter((team) => teamIds.includes(team.id)).map((team) => team.name).join(", ") || "Company-wide"}</p></div>{kind === "employee" && <><div><span className="text-xs text-muted-foreground">Start / annual leave</span><p className="font-bold">{startDate} · {displayedLeaveDays} days</p></div><div><span className="text-xs text-muted-foreground">Shift</span><p className="font-bold">{shiftStart}–{shiftEnd}</p></div><div><span className="text-xs text-muted-foreground">Salary</span><p className="font-bold">{salaryAmount} {salaryCurrency} · {salaryType}</p></div><div><span className="text-xs text-muted-foreground">Breaks</span><p className="font-bold">{breaks.map((item) => `${item.name} ${item.start_time}–${item.end_time}`).join(", ")}</p></div></>}</div><p className="text-sm text-muted-foreground">{existingPersonMessage ?? "No account or invitation has been created yet. Confirm to save this profile and send the invitation."}</p><div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(kind === "employee" ? "work" : "form")}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button><Button disabled={createMutation.isPending || Boolean(existingPerson)} onClick={() => createMutation.mutate()}>{createMutation.isPending ? "Creating..." : "Confirm & send invitation"}</Button></div></div>
        )}

        {step === "invited" && createdEmployee && (
          <div className="space-y-4">
            <div className="rounded-md border border-info/30 bg-info/10 p-4 text-sm">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-info" />
                <span className="font-medium">{createdEmployee.name}</span>
                <StatusBadge status="invited" />
              </div>
              <p className="mt-2 text-muted-foreground">
                {invitationEmailQueued
                  ? `We sent ${createdEmployee.email} a secure link to choose a password.`
                  : `The account is ready, but the email to ${createdEmployee.email} was not queued. Try sending it again.`}
              </p>
              {createdInvitation && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Link expires {new Date(createdInvitation.expiresAt).toLocaleString()}.
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={resendCreatedInvitationMutation.isPending}
                    onClick={() => resendCreatedInvitationMutation.mutate()}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    {resendCreatedInvitationMutation.isPending ? "Sending..." : "Resend invitation"}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  navigate({
                    to: "/employees/$employeeId",
                    params: { employeeId: createdEmployee.id },
                  })
                }
              >
                Open full profile
              </Button>
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TypeOption({
  active,
  onClick,
  icon: Icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof UserCircle;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:bg-accent/50",
      )}
    >
      <Icon
        className={cn("mt-0.5 h-5 w-5 shrink-0", active ? "text-primary" : "text-muted-foreground")}
      />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </button>
  );
}

function RoleExplainer({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="font-bold text-foreground">{title}</p>
      <p className="mt-1 leading-relaxed">{body}</p>
    </div>
  );
}

function PermissionChecklist({
  permissions,
  selected,
  disabled = false,
  onToggle,
}: {
  permissions: PermissionDefinition[];
  selected: string[];
  disabled?: boolean;
  onToggle: (key: string, checked: boolean) => void;
}) {
  const grouped = permissions.reduce<Record<string, PermissionDefinition[]>>((acc, permission) => {
    acc[permission.group] = [...(acc[permission.group] ?? []), permission];
    return acc;
  }, {});

  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Label>Custom permissions</Label>
          <p className="text-xs text-muted-foreground">
            Turn on only the actions this person should be able to use.
          </p>
        </div>
        <span className="text-[11px] font-bold text-muted-foreground">
          {selected.length} selected
        </span>
      </div>
      <div className="grid max-h-[240px] gap-2 overflow-y-auto pr-1 md:grid-cols-2">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="rounded-lg border bg-muted/20 p-2.5">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
              {group}
            </p>
            <div className="space-y-2">
              {items.map((permission) => (
                <label key={permission.key} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(permission.key)}
                    disabled={disabled}
                    onCheckedChange={(checked) => onToggle(permission.key, checked === true)}
                  />
                  <span>
                    <span className="block font-semibold">{permission.label}</span>
                    <span className="line-clamp-2 block text-xs text-muted-foreground">
                      {permission.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PermissionPreview({
  role,
  mode,
  permissions,
  selectedKeys,
}: {
  role: Role;
  mode: PermissionMode;
  permissions: PermissionDefinition[];
  selectedKeys: string[];
}) {
  const selected = new Set(selectedKeys);
  const grouped = permissions.reduce<Record<string, PermissionDefinition[]>>((acc, permission) => {
    if (!selected.has(permission.key)) return acc;
    acc[permission.group] = [...(acc[permission.group] ?? []), permission];
    return acc;
  }, {});
  const groupEntries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  const hasPayroll = selectedKeys.some((key) => key.startsWith("payroll."));

  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Label>Visible permissions</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Current selection for{" "}
            <span className="font-bold text-foreground">
              {roleLabel(role)}
              {mode === "custom" ? " · custom" : ""}
            </span>
            . This is what this person can access after saving.
          </p>
        </div>
        {role === "team_owner" && !hasPayroll && (
          <span className="rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">
            Payroll hidden
          </span>
        )}
      </div>

      {groupEntries.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No permissions selected.</p>
      ) : (
        <div className="mt-3 grid max-h-[190px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
          {groupEntries.map(([group, items]) => (
            <div key={group} className="rounded-lg border bg-card p-3">
              <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
                {group}
              </p>
              <p className="mt-1 text-lg font-extrabold">{items.length}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {items.slice(0, 3).map((permission) => (
                  <span
                    key={permission.key}
                    className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                  >
                    {permission.label}
                  </span>
                ))}
                {items.length > 3 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    +{items.length - 3}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamAccessSelector({
  teams,
  teamIds,
  onToggle,
}: {
  teams: { id: string; name: string }[];
  teamIds: string[];
  onToggle: (teamId: string, checked: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div>
        <Label>Teams</Label>
        <p className="text-xs text-muted-foreground">
          Choose where this person belongs or has management access.
        </p>
      </div>
      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">Create a team before adding this person.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {teams.map((team) => (
            <label key={team.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={teamIds.includes(team.id)}
                onCheckedChange={(checked) => onToggle(team.id, checked === true)}
              />
              {team.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function kindLabel(kind: PersonKind): string {
  if (kind === "employee") return "Employee";
  if (kind === "team_owner") return "Team leader";
  if (kind === "hr") return "HR";
  return "General admin";
}

function roleLabel(role: Role): string {
  if (role === "team_owner") return "Team lead";
  if (role === "hr") return "HR";
  return "General admin";
}
