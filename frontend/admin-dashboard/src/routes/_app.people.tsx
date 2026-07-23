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
  MoreHorizontal,
  LayoutDashboard,
  CalendarCheck,
  Banknote,
  BarChart3,
  Settings,
  ClipboardList,
  Users,
  Clock3,
  Eye,
  EyeOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  getEmployee,
  getWorkProfile,
  listEmployees,
  updateEmployee,
  updateWorkProfile,
  type WorkProfile,
} from "@/api/employees";
import { listUsers, updateUser } from "@/api/users";
import { addTeamMember, listTeams, removeTeamMember, updateTeamMemberRole } from "@/api/teams";
import {
  archivePerson,
  deletePerson,
  invitePerson,
  resendPersonInvitation,
  restorePerson,
  updatePersonRole,
  type PersonInvitationSummary,
  type PersonRole,
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
import type {
  DataScope,
  Employee,
  PermissionMode,
  Role,
  Team,
  TeamMemberRole,
  User,
} from "@/types";
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
type EditableRole = PersonRole;
type TypeFilter = "all" | "employees" | "admins";
type RoleFilter = "all" | "employee" | Role;
type StatusFilter = "all" | "active" | "invited" | "archived";
type AccessPreset = EditableRole | "custom";

const WORK_DAYS = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
];

function shiftMinutes(start: string, end: string) {
  const [startHour = 0, startMinute = 0] = start.split(":").map(Number);
  const [endHour = 0, endMinute = 0] = end.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  let endTotal = endHour * 60 + endMinute;
  if (endTotal <= startTotal) endTotal += 24 * 60;
  return endTotal - startTotal;
}

function addClockMinutes(value: string, minutes: number) {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  const total = (hour * 60 + minute + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

type PersonRow = {
  id: string;
  kind: "employee" | "admin";
  name: string;
  email: string;
  roleLabel: string;
  detail: string;
  managerNames: string[];
  status: "active" | "invited" | "expired" | "archived";
  teamIds: string[];
  dashboardEmployeeId?: string;
  isCurrentUser: boolean;
  isSuperAdmin?: boolean;
  employee?: Employee;
  user?: User;
};

function adminRank(user?: User | null) {
  if (!user) return 0;
  if (user.isSuperAdmin) return 4;
  return roleRankValue(user.role);
}

function roleRankValue(role: Role) {
  if (role === "general_admin") return 3;
  if (role === "hr") return 2;
  return 1;
}

function canManageAdminUser(actor?: User | null, target?: User | null) {
  if (!actor || !target) return false;
  if (target.isSuperAdmin) return false;
  if (actor.isSuperAdmin) return actor.id !== target.id;
  return actor.id !== target.id && actor.permissions.includes(permissions.accessManage);
}

function canAssignRole(actor: User | null | undefined, role: EditableRole) {
  if (!actor) return false;
  if (actor.isSuperAdmin) return true;
  return actor.permissions.includes(permissions.accessManage);
}

function assignableRoles(actor?: User | null): EditableRole[] {
  if (!actor?.permissions.includes(permissions.accessManage) && !actor?.isSuperAdmin) return [];
  return ["employee", "team_owner", "hr", "general_admin"];
}

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
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
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
  const [editPersonRow, setEditPersonRow] = useState<PersonRow | null>(null);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editJobTitle, setEditJobTitle] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<EditableRole>("employee");
  const [editPreset, setEditPreset] = useState<AccessPreset>("team_owner");
  const [editPermissionMode, setEditPermissionMode] = useState<PermissionMode>("role");
  const [editDataScope, setEditDataScope] = useState<DataScope>("assigned_teams");
  const [editTeamIds, setEditTeamIds] = useState<string[]>([]);
  const [editEmployeeTeamIds, setEditEmployeeTeamIds] = useState<string[]>([]);
  const [editEmployeeTeamRole, setEditEmployeeTeamRole] = useState<TeamMemberRole>("member");
  const [editTrackAsEmployee, setEditTrackAsEmployee] = useState(false);
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [editShiftStart, setEditShiftStart] = useState("09:00");
  const [editShiftEnd, setEditShiftEnd] = useState("17:00");
  const [editTimezone, setEditTimezone] = useState("Africa/Cairo");
  const [editWorkingDays, setEditWorkingDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [editLateGraceMinutes, setEditLateGraceMinutes] = useState(15);
  const [editOvertimeEnabled, setEditOvertimeEnabled] = useState(false);
  const [editOvertimeMultiplier, setEditOvertimeMultiplier] = useState(1);
  const [editSalaryAmount, setEditSalaryAmount] = useState(0);
  const [editSalaryCurrency, setEditSalaryCurrency] = useState<
    "EGP" | "GBP" | "USD" | "EUR" | "SAR" | "AED"
  >("EGP");
  const [editSalaryType, setEditSalaryType] = useState<"monthly" | "hourly">("monthly");
  const [showEditSalary, setShowEditSalary] = useState(false);
  const [editBreakRules, setEditBreakRules] = useState<NonNullable<WorkProfile["breakRules"]>>([]);
  const [showFullPermissions, setShowFullPermissions] = useState(false);
  const canManageAccess = can(permissions.accessManage);
  const canManageTeams = can(permissions.teamsManage);
  const canManagePayroll = can(permissions.payrollManage);
  const editingSelf = Boolean(
    (editUser && currentUser?.id === editUser.id) ||
    (editPersonRow?.employee &&
      (currentUser?.employeeId === editPersonRow.employee.id ||
        currentUser?.trackedEmployeeId === editPersonRow.employee.id)),
  );
  const isProtectedOwner = Boolean(editPersonRow?.isSuperAdmin);
  const canChangeRoles =
    canManageAccess && Boolean(editPersonRow) && !editingSelf && !isProtectedOwner;
  const allowedRoleOptions = useMemo(() => assignableRoles(currentUser), [currentUser]);
  const managedEmployeeId =
    editPersonRow?.dashboardEmployeeId ?? editPersonRow?.employee?.id ?? null;

  const managedWorkProfile = useQuery({
    queryKey: ["employee-work-profile", managedEmployeeId],
    queryFn: () => getWorkProfile(managedEmployeeId!),
    enabled: Boolean(managedEmployeeId && editPersonRow),
  });

  useEffect(() => {
    const profile = managedWorkProfile.data;
    if (!profile) return;
    setEditShiftStart(profile.shiftStart ?? "09:00");
    setEditShiftEnd(profile.shiftEnd ?? "17:00");
    setEditWorkingDays(profile.workingDays ?? [0, 1, 2, 3, 4]);
    setEditLateGraceMinutes(profile.lateGraceMinutes ?? 15);
    setEditOvertimeEnabled(profile.overtimeEnabled);
    setEditOvertimeMultiplier(profile.overtimeRateMultiplier ?? 1);
    setEditSalaryAmount(profile.salaryAmount ?? 0);
    setEditSalaryCurrency(profile.salaryCurrency ?? "EGP");
    setEditSalaryType(profile.salaryType ?? "monthly");
    setEditBreakRules(profile.breakRules ?? []);
    setShowEditSalary(false);
  }, [managedWorkProfile.data]);

  const catalog = useQuery({
    queryKey: ["permission-catalog"],
    queryFn: getPermissionCatalog,
    enabled: Boolean(editUser) && canManageAccess,
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
  const directoryLoading =
    employees.isPending || teams.isPending || (canManageAccess && users.isPending);
  const directoryRefreshing =
    !directoryLoading &&
    (employees.isFetching || teams.isFetching || (canManageAccess && users.isFetching));

  const rows = useMemo<PersonRow[]>(() => {
    const employeeRows: PersonRow[] = (employees.data ?? []).map((employee) => ({
      id: employee.id,
      kind: "employee",
      name: employee.name,
      email: employee.email,
      roleLabel: "Employee",
      detail: employee.jobTitle || "—",
      managerNames: employee.managers.map((manager) => manager.name),
      status: employeeDirectoryStatus(employee),
      teamIds: employee.teamIds,
      dashboardEmployeeId: employee.id,
      isCurrentUser:
        currentUser?.employeeId === employee.id || currentUser?.trackedEmployeeId === employee.id,
      employee,
    }));
    const employeeById = new Map((employees.data ?? []).map((employee) => [employee.id, employee]));
    const employeeByEmail = new Map(
      (employees.data ?? []).map((employee) => [employee.email.toLowerCase(), employee]),
    );
    const adminJobTitle = (user: User) =>
      user.jobTitle && user.jobTitle !== "Management" ? user.jobTitle : "";
    const adminRows: PersonRow[] = (users.data ?? []).map((user) => {
      const linkedEmployee =
        employeeById.get(user.trackedEmployeeId ?? user.employeeId ?? "") ??
        employeeByEmail.get(user.email.toLowerCase());
      return {
        id: user.id,
        kind: "admin",
        name: user.name,
        email: user.email,
        roleLabel: user.isSuperAdmin
          ? "Super admin · General admin"
          : user.role === "hr"
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
        managerNames: linkedEmployee?.managers.map((manager) => manager.name) ?? [],
        status: user.status === "active" ? "active" : "archived",
        teamIds:
          user.dataScope === "company" ? activeTeams.map((team) => team.id) : user.teamLeadTeamIds,
        dashboardEmployeeId: user.trackedEmployeeId,
        isCurrentUser: currentUser?.id === user.id,
        isSuperAdmin: user.isSuperAdmin,
        user,
      };
    });
    const adminEmployeeIds = new Set(
      (users.data ?? []).map((user) => user.trackedEmployeeId ?? user.employeeId).filter(Boolean),
    );
    const adminEmails = new Set((users.data ?? []).map((user) => user.email.toLowerCase()));
    const unlinkedEmployeeRows = employeeRows.filter(
      (row) => !adminEmployeeIds.has(row.id) && !adminEmails.has(row.email.toLowerCase()),
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
      if (!editPersonRow) throw new Error("Choose a person to manage.");
      const currentRole: EditableRole =
        editPersonRow.kind === "admin" ? editPersonRow.user!.role : "employee";
      if (editPersonRow.kind === "admin" && editUser) {
        await updateUser(editUser.id, {
          name: editName,
          email: editUser.isSuperAdmin ? undefined : editEmail,
          jobTitle: editJobTitle,
          password: editPassword || undefined,
        });
        if (managedEmployeeId) {
          await updateEmployee(managedEmployeeId, { timezone: editTimezone });
        }
      } else if (editPersonRow.employee) {
        await updateEmployee(editPersonRow.employee.id, {
          name: editName,
          email: editEmail,
          jobTitle: editJobTitle,
          timezone: editTimezone,
        });
      }
      if (managedEmployeeId && managedWorkProfile.data) {
        await updateWorkProfile(managedEmployeeId, {
          shiftStart: editShiftStart,
          shiftEnd: editShiftEnd,
          workingDays: editWorkingDays,
          weeklyOffDays: WORK_DAYS.map((day) => day.value).filter(
            (day) => !editWorkingDays.includes(day),
          ),
          requiredDailyMinutes: shiftMinutes(editShiftStart, editShiftEnd),
          lateGraceMinutes: editLateGraceMinutes,
          breakRules: editBreakRules,
          ...(canManagePayroll
            ? {
                overtimeEnabled: editOvertimeEnabled,
                overtimeBasis: editOvertimeEnabled
                  ? (managedWorkProfile.data.overtimeBasis ?? "outside_shift")
                  : undefined,
                overtimeRateMultiplier: editOvertimeMultiplier,
                salaryAmount: editSalaryAmount,
                salaryCurrency: editSalaryCurrency,
                salaryType: editSalaryType,
              }
            : {}),
        });
        if (canManageTeams) {
          const originalTeamIds = new Set(
            (employees.data ?? []).find((employee) => employee.id === managedEmployeeId)?.teamIds ??
              [],
          );
          const nextTeamIds = new Set(editEmployeeTeamIds);
          await Promise.all([
            ...[...nextTeamIds]
              .filter((teamId) => !originalTeamIds.has(teamId))
              .map((teamId) => addTeamMember(teamId, managedEmployeeId, editEmployeeTeamRole)),
            ...[...originalTeamIds]
              .filter((teamId) => !nextTeamIds.has(teamId))
              .map((teamId) => removeTeamMember(teamId, managedEmployeeId)),
            ...[...nextTeamIds]
              .filter((teamId) => originalTeamIds.has(teamId))
              .map((teamId) =>
                updateTeamMemberRole(teamId, managedEmployeeId, editEmployeeTeamRole),
              ),
          ]);
        }
      }
      if (canChangeRoles || editPersonRow.kind === "employee") {
        const roleChanged = editRole !== currentRole;
        if (roleChanged || (editPersonRow.kind === "employee" && editPassword)) {
          await updatePersonRole(editPersonRow.kind, editPersonRow.id, {
            role: editRole,
            teamIds: editRole === "team_owner" ? editTeamIds : [],
            password: editPassword || undefined,
          });
        }
      }
      if (!canChangeRoles || editRole === "employee") return null;
      if (!editUser) return null;
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
        dataScope: editRole === "team_owner" ? "assigned_teams" : "company",
        permissionOverrides: overrides,
        teamLeadTeamIds: editRole === "team_owner" ? editTeamIds : [],
        trackAsEmployee: editTrackAsEmployee,
      });
    },
    onSuccess: async () => {
      toast.success("Access updated");
      setEditPersonRow(null);
      setEditUser(null);
      setEditPassword("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-access"] }),
        queryClient.invalidateQueries({ queryKey: ["employee-work-profile"] }),
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

  function openAccess(row: PersonRow) {
    const user = row.user ?? null;
    const trackedEmployee =
      row.employee ??
      (employees.data ?? []).find((employee) => employee.id === row.dashboardEmployeeId);
    setEditPersonRow(row);
    setEditUser(user);
    setEditName(row.name);
    setEditEmail(row.email);
    setEditJobTitle(user?.jobTitle ?? row.employee?.jobTitle ?? "");
    setEditTimezone(trackedEmployee?.timezone ?? "Africa/Cairo");
    setEditPassword("");
    setEditRole(user?.role ?? "employee");
    setEditPreset(user ? (user.permissionMode === "custom" ? "custom" : user.role) : "employee");
    setEditPermissionMode(user?.permissionMode ?? "role");
    setEditDataScope(user?.dataScope ?? "assigned_teams");
    setEditTeamIds(user?.teamLeadTeamIds ?? row.teamIds);
    setEditEmployeeTeamIds(trackedEmployee?.teamIds ?? []);
    setEditEmployeeTeamRole(trackedEmployee?.teamRole ?? "member");
    setEditTrackAsEmployee(user?.trackAsEmployee ?? false);
    setEditPermissions(user?.permissions ?? []);
    setShowFullPermissions(false);
  }

  function choosePreset(preset: AccessPreset) {
    if (!canChangeRoles) {
      toast.error("You can only change roles below your own access level.");
      return;
    }
    setEditPreset(preset);
    if (preset === "custom") {
      setEditPermissionMode("custom");
      setShowFullPermissions(true);
      return;
    }
    if (!canAssignRole(currentUser, preset)) {
      toast.error("You can only assign roles below your own access level.");
      return;
    }
    setEditRole(preset);
    setEditPermissionMode("role");
    setEditDataScope(preset === "general_admin" || preset === "hr" ? "company" : "assigned_teams");
    setEditPermissions(preset === "employee" ? [] : (catalog.data?.rolePresets?.[preset] ?? []));
  }

  function changeBaseRole(role: EditableRole) {
    if (!canChangeRoles) {
      toast.error("You can only change roles below your own access level.");
      return;
    }
    if (!canAssignRole(currentUser, role)) {
      toast.error("You can only assign roles below your own access level.");
      return;
    }
    setEditRole(role);
    if (role === "team_owner" || role === "employee") {
      setEditDataScope("assigned_teams");
    } else {
      setEditDataScope("company");
    }
    if (editPermissionMode === "custom" && editPreset !== "custom") {
      setEditPreset("custom");
    }
  }

  function changeDataScope(scope: DataScope) {
    if (editRole !== "team_owner" && scope === "assigned_teams") {
      toast.error("HR and General admin have company-wide visibility.");
      return;
    }
    if (editRole === "team_owner" && scope === "company") {
      toast.error("Team leads can only see assigned teams.");
      return;
    }
    setEditDataScope(scope);
  }

  const visiblePermissionKeys = useMemo(() => {
    if (!catalog.data) return [];
    if (editRole === "employee") return [];
    const keys =
      editPermissionMode === "custom"
        ? editPermissions
        : (catalog.data.rolePresets?.[editRole] ?? []);
    return editRole === "hr" || isProtectedOwner
      ? keys
      : keys.filter((key) => !key.startsWith("payroll."));
  }, [catalog.data, editPermissionMode, editPermissions, editRole, isProtectedOwner]);
  const visiblePermissionDefinitions = useMemo(
    () =>
      (catalog.data?.permissions ?? []).filter(
        (permission) =>
          editRole === "hr" || isProtectedOwner || !permission.key.startsWith("payroll."),
      ),
    [catalog.data?.permissions, editRole, isProtectedOwner],
  );

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
          {directoryRefreshing && (
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
              Refreshing…
            </span>
          )}
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
            {directoryLoading
              ? Array.from({ length: 6 }).map((_, index) => (
                  <TableRow key={`people-loading-${index}`}>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-56" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-36" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Skeleton className="h-9 w-36 rounded-full" />
                        <Skeleton className="h-9 w-9 rounded-md" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => (
                  <TableRow key={`${row.kind}-${row.id}`}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.email}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{row.roleLabel}</span>
                        {row.isSuperAdmin && (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-700">
                            Protected
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{row.detail}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {row.managerNames.length
                          ? `Managers: ${row.managerNames.join(", ")}`
                          : "No manager assigned"}
                      </div>
                    </TableCell>
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
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {row.dashboardEmployeeId &&
                          (row.kind === "admin" || row.status === "active") && (
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
                        {row.isCurrentUser && !row.dashboardEmployeeId ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate({ to: "/profile" })}
                          >
                            <UserCircle className="mr-1.5 h-3.5 w-3.5" />
                            My profile
                          </Button>
                        ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="px-2.5">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Open actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            {row.kind === "employee" ? (
                              <>
                                {canManageAccess && row.status !== "archived" && (
                                  <DropdownMenuItem onSelect={() => openAccess(row)}>
                                    <KeyRound className="h-4 w-4" />
                                    Manage employee
                                  </DropdownMenuItem>
                                )}
                                {(row.status === "invited" || row.status === "expired") &&
                                  row.employee?.invitation && (
                                    <DropdownMenuItem
                                      disabled={resendMutation.isPending}
                                      onSelect={() =>
                                        resendMutation.mutate(row.employee!.invitation!.id)
                                      }
                                    >
                                      <RefreshCw className="h-4 w-4" />
                                      Resend invitation
                                    </DropdownMenuItem>
                                  )}
                              </>
                            ) : (
                              <>
                                {canManageAccess &&
                                  row.user &&
                                  (row.isCurrentUser ||
                                    canManageAdminUser(currentUser, row.user)) && (
                                    <DropdownMenuItem onSelect={() => openAccess(row)}>
                                      <KeyRound className="h-4 w-4" />
                                      Manage employee
                                    </DropdownMenuItem>
                                  )}
                              </>
                            )}
                            {can(permissions.peopleArchive) &&
                              !row.isCurrentUser &&
                              !row.isSuperAdmin && (
                                <>
                                  <DropdownMenuSeparator />
                                  {row.status !== "archived" ? (
                                    <DropdownMenuItem
                                      disabled={archiveMutation.isPending}
                                      className="text-destructive focus:text-destructive"
                                      onSelect={() => changeArchiveStatus(row, true)}
                                    >
                                      <Archive className="h-4 w-4" />
                                      Archive
                                    </DropdownMenuItem>
                                  ) : (
                                    <>
                                      <DropdownMenuItem
                                        disabled={archiveMutation.isPending}
                                        onSelect={() => changeArchiveStatus(row, false)}
                                      >
                                        <ArchiveRestore className="h-4 w-4" />
                                        Restore
                                      </DropdownMenuItem>
                                      {archiveOnly && (
                                        <DropdownMenuItem
                                          disabled={deleteMutation.isPending}
                                          className="text-destructive focus:text-destructive"
                                          onSelect={() => deleteArchivedPerson(row)}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                          Delete
                                        </DropdownMenuItem>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
        currentUser={currentUser}
        canManagePayroll={canManagePayroll}
        onCreated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["users"] }),
            queryClient.invalidateQueries({ queryKey: ["employees"] }),
            queryClient.invalidateQueries({ queryKey: ["teams"] }),
          ]);
        }}
      />

      {/* Manage admin access */}
      <Dialog
        open={!!editPersonRow}
        onOpenChange={(open) => {
          if (!open) {
            setEditPersonRow(null);
            setEditUser(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <DialogTitle>Manage employee</DialogTitle>
            <DialogDescription>
              Update identity, password, role, permissions, schedule, breaks, and overtime from one
              place.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              updateMutation.mutate();
            }}
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 pb-6">
              {editUser?.isSuperAdmin && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  Protected owner account: this is the company&apos;s primary Super Admin. Role,
                  access scope, archive, delete, and email changes are locked.
                </p>
              )}

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
                    disabled={editUser?.isSuperAdmin}
                    required
                  />
                  {editUser?.isSuperAdmin && (
                    <p className="text-xs text-muted-foreground">
                      Email is locked for the protected owner account.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-job-title">Job title</Label>
                  <Input
                    id="edit-job-title"
                    value={editJobTitle}
                    onChange={(event) => setEditJobTitle(event.target.value)}
                    placeholder="e.g. Operations Manager"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-password">Reset password</Label>
                  <Input
                    id="edit-password"
                    type="password"
                    value={editPassword}
                    onChange={(event) => setEditPassword(event.target.value)}
                    minLength={editPassword ? 8 : undefined}
                    placeholder="Type a new password, or leave blank"
                  />
                  <p className="text-xs text-muted-foreground">
                    If filled, the new password will replace the current one. Share it securely.
                  </p>
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
                      {allowedRoleOptions.includes("employee") && (
                        <SelectItem value="employee">Employee</SelectItem>
                      )}
                      {allowedRoleOptions.includes("team_owner") && (
                        <SelectItem value="team_owner">Team lead</SelectItem>
                      )}
                      {allowedRoleOptions.includes("hr") && <SelectItem value="hr">HR</SelectItem>}
                      {allowedRoleOptions.includes("general_admin") && (
                        <SelectItem value="general_admin">General admin</SelectItem>
                      )}
                      <SelectItem value="custom">Custom permissions</SelectItem>
                    </SelectContent>
                  </Select>
                  {!canChangeRoles && (
                    <p className="text-xs text-muted-foreground">
                      {isProtectedOwner
                        ? "Protected owner role changes are locked."
                        : editingSelf
                          ? "You can reset your password here, but role changes for your own account are locked for safety."
                          : "You need Manage access permission to change roles and permission presets."}
                    </p>
                  )}
                </div>
              </div>

              {managedEmployeeId && canManagePayroll && (
                <div className="space-y-3 rounded-xl border p-3">
                  <div>
                    <Label>Team membership & team role</Label>
                    <p className="text-xs text-muted-foreground">
                      Team role describes this person inside their teams. It is separate from the
                      system access role below.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {activeTeams.map((team) => (
                        <label
                          key={team.id}
                          className="flex items-center gap-2 rounded-lg border p-2.5 text-sm font-semibold"
                        >
                          <Checkbox
                            disabled={!canManageTeams}
                            checked={editEmployeeTeamIds.includes(team.id)}
                            onCheckedChange={(checked) =>
                              setEditEmployeeTeamIds((current) =>
                                checked === true
                                  ? [...new Set([...current, team.id])]
                                  : current.filter((id) => id !== team.id),
                              )
                            }
                          />
                          {team.name}
                        </label>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Role in selected teams</Label>
                      <Select
                        disabled={!canManageTeams}
                        value={editEmployeeTeamRole}
                        onValueChange={(value) => setEditEmployeeTeamRole(value as TeamMemberRole)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="team_manager">Team manager</SelectItem>
                          <SelectItem value="team_lead">Team lead</SelectItem>
                          <SelectItem value="senior">Senior</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="trainee">Trainee</SelectItem>
                        </SelectContent>
                      </Select>
                      {!canManageTeams && (
                        <p className="text-xs text-muted-foreground">
                          Team membership is read-only without Manage teams permission.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {managedEmployeeId && (
                <div className="space-y-3 rounded-xl border p-3">
                  <div>
                    <Label>Work schedule & overtime</Label>
                    <p className="text-xs text-muted-foreground">
                      Attendance, lateness, idle time, and overtime use this employee schedule.
                    </p>
                  </div>
                  {managedWorkProfile.isLoading ? (
                    <Skeleton className="h-24 w-full" />
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Timezone</Label>
                          <Select value={editTimezone} onValueChange={setEditTimezone}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Africa/Cairo">Africa/Cairo</SelectItem>
                              <SelectItem value="Europe/London">Europe/London</SelectItem>
                              <SelectItem value="UTC">UTC</SelectItem>
                              <SelectItem value="Asia/Riyadh">Asia/Riyadh</SelectItem>
                              <SelectItem value="Asia/Dubai">Asia/Dubai</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="manage-shift-start">Shift starts</Label>
                          <Input
                            id="manage-shift-start"
                            type="time"
                            value={editShiftStart}
                            onChange={(event) => setEditShiftStart(event.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="manage-shift-end">Shift ends</Label>
                          <Input
                            id="manage-shift-end"
                            type="time"
                            value={editShiftEnd}
                            onChange={(event) => setEditShiftEnd(event.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="manage-late-grace">Late grace (min)</Label>
                          <Input
                            id="manage-late-grace"
                            type="number"
                            min={0}
                            max={180}
                            value={editLateGraceMinutes}
                            onChange={(event) =>
                              setEditLateGraceMinutes(Number(event.target.value) || 0)
                            }
                          />
                        </div>
                        {canManagePayroll && (
                          <div className="flex items-end">
                            <label className="flex min-h-10 w-full items-center justify-between rounded-md border px-3 text-sm font-semibold">
                              Overtime eligible
                              <Switch
                                checked={editOvertimeEnabled}
                                onCheckedChange={setEditOvertimeEnabled}
                              />
                            </label>
                          </div>
                        )}
                        {canManagePayroll && (
                          <div className="space-y-1.5">
                            <Label htmlFor="manage-overtime-multiplier">Overtime multiplier</Label>
                            <Input
                              id="manage-overtime-multiplier"
                              type="number"
                              min={1}
                              max={5}
                              step={0.25}
                              value={editOvertimeMultiplier}
                              disabled={!editOvertimeEnabled}
                              onChange={(event) =>
                                setEditOvertimeMultiplier(Number(event.target.value) || 1)
                              }
                            />
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase text-muted-foreground">
                          Working days
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {WORK_DAYS.map((day) => {
                            const selected = editWorkingDays.includes(day.value);
                            return (
                              <Button
                                key={day.value}
                                type="button"
                                size="sm"
                                variant={selected ? "default" : "outline"}
                                onClick={() =>
                                  setEditWorkingDays((current) =>
                                    selected
                                      ? current.filter((value) => value !== day.value)
                                      : [...current, day.value].sort(),
                                  )
                                }
                              >
                                {day.label}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold uppercase text-muted-foreground">
                            Breaks
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setEditBreakRules((current) => [
                                ...current,
                                {
                                  name: "New break",
                                  minutes: 15,
                                  paid: true,
                                  start_time: editShiftStart,
                                  end_time: addClockMinutes(editShiftStart, 15),
                                },
                              ])
                            }
                          >
                            <Plus /> Add break
                          </Button>
                        </div>
                        {editBreakRules.map((rule, index) => (
                          <div
                            key={`${rule.name}-${index}`}
                            className="grid items-end gap-2 rounded-lg bg-muted/30 p-2 sm:grid-cols-[1fr_120px_120px_110px_auto]"
                          >
                            <div className="space-y-1">
                              <Label>Break name</Label>
                              <Input
                                value={rule.name}
                                onChange={(event) =>
                                  setEditBreakRules((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, name: event.target.value }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Starts</Label>
                              <Input
                                type="time"
                                value={rule.start_time ?? ""}
                                onChange={(event) =>
                                  setEditBreakRules((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, start_time: event.target.value }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Ends</Label>
                              <Input
                                type="time"
                                value={rule.end_time ?? ""}
                                onChange={(event) => {
                                  const [startHour = 0, startMinute = 0] = String(
                                    rule.start_time ?? "00:00",
                                  )
                                    .split(":")
                                    .map(Number);
                                  const [endHour = 0, endMinute = 0] = event.target.value
                                    .split(":")
                                    .map(Number);
                                  const minutes = Math.max(
                                    0,
                                    endHour * 60 + endMinute - startHour * 60 - startMinute,
                                  );
                                  setEditBreakRules((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, end_time: event.target.value, minutes }
                                        : item,
                                    ),
                                  );
                                }}
                              />
                            </div>
                            <label className="flex h-10 items-center justify-between rounded-md border px-3 text-sm font-semibold">
                              Paid
                              <Switch
                                checked={rule.paid}
                                onCheckedChange={(paid) =>
                                  setEditBreakRules((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, paid } : item,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${rule.name}`}
                              onClick={() =>
                                setEditBreakRules((current) =>
                                  current.filter((_, itemIndex) => itemIndex !== index),
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {managedEmployeeId && (
                <div className="space-y-3 rounded-xl border p-3">
                  <div>
                    <Label>Salary</Label>
                    <p className="text-xs text-muted-foreground">
                      Used by payroll previews and the monthly payroll sheet.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label>Salary type</Label>
                      <Select
                        value={editSalaryType}
                        onValueChange={(value) => setEditSalaryType(value as "monthly" | "hourly")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="hourly">Hourly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        {editSalaryType === "monthly" ? "Monthly salary" : "Hourly rate"}
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          type={showEditSalary ? "number" : "password"}
                          min={0}
                          step={0.01}
                          value={editSalaryAmount}
                          onChange={(event) => setEditSalaryAmount(Number(event.target.value) || 0)}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => setShowEditSalary((current) => !current)}
                          aria-label={showEditSalary ? "Hide salary" : "Show salary"}
                        >
                          {showEditSalary ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Currency</Label>
                      <Select
                        value={editSalaryCurrency}
                        onValueChange={(value) =>
                          setEditSalaryCurrency(value as typeof editSalaryCurrency)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["EGP", "GBP", "USD", "EUR", "SAR", "AED"] as const).map((currency) => (
                            <SelectItem key={currency} value={currency}>
                              {currency}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Access scope</Label>
                  {editRole !== "team_owner" && (
                    <span className="rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">
                      {editRole === "employee" ? "Own account" : "Whole company"}
                    </span>
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {editRole === "employee" ? (
                    <button
                      type="button"
                      disabled
                      className="rounded-lg border border-[#e5185d] bg-[#fce3ec]/50 p-3 text-left text-sm"
                    >
                      <span className="font-bold">Own account only</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Employees only see their own dashboard, timesheets, leave, and schedule.
                      </span>
                    </button>
                  ) : editRole === "team_owner" ? (
                    <button
                      type="button"
                      disabled={!canChangeRoles}
                      onClick={() => changeDataScope("assigned_teams")}
                      className={cn(
                        "rounded-lg border p-3 text-left text-sm transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-45",
                        "border-[#e5185d] bg-[#fce3ec]/50",
                      )}
                    >
                      <span className="font-bold">Assigned teams</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Team leads only see the teams assigned below.
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="rounded-lg border border-[#e5185d] bg-[#fce3ec]/50 p-3 text-left text-sm"
                    >
                      <span className="font-bold">Whole company</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        HR and General admin have company-wide visibility.
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {editPermissionMode === "custom" && (
                <div className="space-y-1.5 rounded-xl border p-3">
                  <Label>Base role for this custom account</Label>
                  <Select
                    value={editRole}
                    onValueChange={(value) => changeBaseRole(value as EditableRole)}
                    disabled={!canChangeRoles}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedRoleOptions.includes("employee") && (
                        <SelectItem value="employee">Employee</SelectItem>
                      )}
                      {allowedRoleOptions.includes("team_owner") && (
                        <SelectItem value="team_owner">Team lead</SelectItem>
                      )}
                      {allowedRoleOptions.includes("hr") && <SelectItem value="hr">HR</SelectItem>}
                      {allowedRoleOptions.includes("general_admin") && (
                        <SelectItem value="general_admin">General admin</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Team lead is limited to selected teams. General admin and HR can be
                    company-wide.
                  </p>
                </div>
              )}

              {canChangeRoles && editRole === "team_owner" && (
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

              <RoleAccessSummary
                role={editRole}
                mode={editPermissionMode}
                permissionCount={visiblePermissionKeys.length}
                showFull={showFullPermissions}
                onToggleFull={() => setShowFullPermissions((value) => !value)}
              />

              {canChangeRoles && editRole === "team_owner" && (
                <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div>
                    <Label>Also track as employee</Label>
                    <p className="text-xs text-muted-foreground">
                      Use this when the team lead also works on tasks and needs their own employee
                      dashboard.
                    </p>
                  </div>
                  <Switch checked={editTrackAsEmployee} onCheckedChange={setEditTrackAsEmployee} />
                </div>
              )}

              {showFullPermissions && editPermissionMode === "custom" && catalog.data && (
                <PermissionChecklist
                  permissions={visiblePermissionDefinitions}
                  selected={editPermissions}
                  disabled={!canChangeRoles}
                  onToggle={(key, checked) =>
                    setEditPermissions((current) =>
                      checked ? [...new Set([...current, key])] : current.filter((x) => x !== key),
                    )
                  }
                />
              )}

              {showFullPermissions && catalog.data && (
                <PermissionPreview
                  role={editRole}
                  mode={editPermissionMode}
                  permissions={visiblePermissionDefinitions}
                  selectedKeys={visiblePermissionKeys}
                />
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t bg-card px-5 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditPersonRow(null);
                  setEditUser(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save employee"}
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
  currentUser,
  canManagePayroll,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: Team[];
  employees: Employee[];
  users: User[];
  currentUser?: User | null;
  canManagePayroll: boolean;
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
  const [showSalary, setShowSalary] = useState(false);
  const [breaks, setBreaks] = useState([
    { name: "Lunch", start_time: "13:00", end_time: "13:30", minutes: 30, paid: true },
    { name: "Short break", start_time: "15:30", end_time: "15:45", minutes: 15, paid: true },
  ]);
  const canCreateTeamLeader = canAssignRole(currentUser, "team_owner");
  const canCreateHr = canAssignRole(currentUser, "hr");
  const canCreateGeneralAdmin = canAssignRole(currentUser, "general_admin");

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
    setStartDate("");
    setAnnualLeaveDays(21);
    setShiftStart("09:00");
    setShiftEnd("17:00");
    setOffDays([5, 6]);
    setSalaryType("monthly");
    setSalaryAmount("0");
    setHourlyRate("0");
    setSalaryCurrency("EGP");
    setShowSalary(false);
    setBreaks([
      { name: "Lunch", start_time: "13:00", end_time: "13:30", minutes: 30, paid: true },
      { name: "Short break", start_time: "15:30", end_time: "15:45", minutes: 15, paid: true },
    ]);
    setCreatedEmployee(null);
    setCreatedInvitation(undefined);
    setInvitationEmailQueued(false);
  }

  useEffect(() => {
    if (kind === "general_admin" && !canCreateGeneralAdmin) setKind("employee");
    if (kind === "hr" && !canCreateHr) setKind("employee");
    if (kind === "team_owner" && !canCreateTeamLeader) setKind("employee");
  }, [canCreateGeneralAdmin, canCreateHr, canCreateTeamLeader, kind]);

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
        workProfile:
          kind === "employee"
            ? {
                shiftStart,
                shiftEnd,
                workingDays: [0, 1, 2, 3, 4, 5, 6].filter((day) => !offDays.includes(day)),
                weeklyOffDays: offDays,
                requiredDailyMinutes: Math.max(60, requiredDailyMinutes),
                breakRules: breaks,
                lateGraceMinutes: 15,
                ...(canManagePayroll
                  ? {
                      overtimeEnabled: true,
                      overtimeBasis: "outside_shift",
                      overtimeRateMultiplier: 1,
                      salaryAmount:
                        salaryType === "monthly" ? Number(salaryAmount) : Number(hourlyRate),
                      salaryCurrency,
                      salaryType,
                    }
                  : {}),
              }
            : undefined,
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
    return {
      value,
      label: `${hour12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`,
    };
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
  const breakStartOptions = breakTimeOptions.filter(
    (option) => timeToMinutes(option.value) < shiftEndMinutes,
  );
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
        const duration = Math.max(
          1,
          row.minutes || timeToMinutes(row.end_time) - timeToMinutes(row.start_time) || 15,
        );
        return {
          ...row,
          start_time: startTime,
          end_time: nextBreakEnd(startTime, duration),
          minutes: Math.min(duration, Math.max(1, shiftEndMinutes - timeToMinutes(startTime))),
        };
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
          Math.max(
            startMinutes + 1,
            timeToMinutes(row.end_time) <= startMinutes
              ? startMinutes + duration
              : timeToMinutes(row.end_time),
          ),
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
  }, [breaks, shiftEndMinutes, shiftStartMinutes]);
  const firstYearLeaveCredit = (() => {
    if (!startDate) return null;
    const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
    const targetMonthStart = new Date(startYear, startMonth - 1 + 6, 1, 12);
    const targetMonthLastDay = new Date(
      targetMonthStart.getFullYear(),
      targetMonthStart.getMonth() + 1,
      0,
    ).getDate();
    const eligibleAt = new Date(
      targetMonthStart.getFullYear(),
      targetMonthStart.getMonth(),
      Math.min(startDay, targetMonthLastDay),
      12,
    );
    const fullYearCredit = eligibleAt.getFullYear() > startYear;
    const remainingFullMonths = fullYearCredit ? 12 : 12 - (eligibleAt.getMonth() + 1);
    return {
      eligibleAt: eligibleAt.toLocaleDateString(),
      months: remainingFullMonths,
      days: fullYearCredit
        ? annualLeaveDays
        : Number(((remainingFullMonths * annualLeaveDays) / 12).toFixed(2)),
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
            {canCreateTeamLeader && (
              <TypeOption
                active={kind === "team_owner"}
                onClick={() => setKind("team_owner")}
                icon={UserPlus}
                title="Team leader"
                subtitle="Manages assigned teams in the dashboard and has an Employee profile, so they can receive and track their own tasks."
              />
            )}
            {canCreateGeneralAdmin && (
              <TypeOption
                active={kind === "general_admin"}
                onClick={() => setKind("general_admin")}
                icon={ShieldCheck}
                title="General admin"
                subtitle="Company-wide admin with access to every team and permission to review a team leader's own task."
              />
            )}
            {canCreateHr && (
              <TypeOption
                active={kind === "hr"}
                onClick={() => setKind("hr")}
                icon={KeyRound}
                title="HR"
                subtitle="Manages employee profiles, schedules, payroll, deductions, overtime and invitations."
              />
            )}
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
              <div>
                <Label>Employment start date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Annual leave entitlement</Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={displayedLeaveDays}
                  readOnly
                  className="bg-muted"
                />
                <p className="mt-1 text-xs text-muted-foreground">{leaveCreditHelp}</p>
              </div>
              <div>
                <Label>Shift starts</Label>
                <Select value={shiftStart} onValueChange={setShiftStart}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {shiftTimeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Shift ends</Label>
                <Select value={shiftEnd} onValueChange={setShiftEnd}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {shiftTimeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Weekly days off</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, day) => (
                  <label
                    key={label}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={offDays.includes(day)}
                      onCheckedChange={(checked) =>
                        setOffDays((current) =>
                          checked
                            ? [...new Set([...current, day])]
                            : current.filter((item) => item !== day),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Breaks (must be inside the shift)</Label>
                <Button type="button" size="sm" variant="outline" onClick={addBreak}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add break
                </Button>
              </div>
              {breaks.map((item, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_130px_130px_100px_auto]"
                >
                  <Input
                    value={item.name}
                    onChange={(e) =>
                      setBreaks((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, name: e.target.value } : row,
                        ),
                      )
                    }
                  />
                  <Select
                    value={item.start_time}
                    onValueChange={(value) => updateBreakStart(index, value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {breakStartOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={item.end_time}
                    onValueChange={(value) => updateBreakEnd(index, value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {breakTimeOptions
                        .filter(
                          (option) => timeToMinutes(option.value) > timeToMinutes(item.start_time),
                        )
                        .map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={item.paid}
                      onCheckedChange={(paid) =>
                        setBreaks((rows) =>
                          rows.map((row, i) => (i === index ? { ...row, paid } : row)),
                        )
                      }
                    />
                    Paid
                  </label>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setBreaks((rows) => rows.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div
              className={
                canManagePayroll
                  ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                  : "hidden"
              }
            >
              <div>
                <Label>Salary type</Label>
                <Select
                  value={salaryType}
                  onValueChange={(value) => setSalaryType(value as typeof salaryType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="hourly">Hourly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Monthly salary</Label>
                <Input
                  type={showSalary ? "number" : "password"}
                  min={0}
                  step="0.01"
                  value={
                    salaryType === "monthly" ? salaryAmount : calculatedMonthlySalary.toFixed(2)
                  }
                  readOnly={salaryType === "hourly"}
                  className={salaryType === "hourly" ? "bg-muted" : undefined}
                  onKeyDown={(event) => {
                    if (salaryAmount === "0" && /^\d$/.test(event.key)) {
                      event.preventDefault();
                      setSalaryAmount(event.key);
                    }
                  }}
                  onChange={(e) => setSalaryAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Hourly rate</Label>
                <Input
                  type={showSalary ? "number" : "password"}
                  min={0}
                  step="0.01"
                  value={salaryType === "monthly" ? calculatedHourlyRate.toFixed(2) : hourlyRate}
                  readOnly={salaryType === "monthly"}
                  className={salaryType === "monthly" ? "bg-muted" : undefined}
                  onKeyDown={(event) => {
                    if (hourlyRate === "0" && /^\d$/.test(event.key)) {
                      event.preventDefault();
                      setHourlyRate(event.key);
                      setSalaryAmount((Number(event.key) * estimatedMonthlyHours).toFixed(2));
                    }
                  }}
                  onChange={(e) => {
                    setHourlyRate(e.target.value);
                    setSalaryAmount(
                      (Number(e.target.value || 0) * estimatedMonthlyHours).toFixed(2),
                    );
                  }}
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={salaryCurrency} onValueChange={setSalaryCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["EGP", "GBP", "USD", "EUR", "SAR", "AED"].map((currency) => (
                      <SelectItem key={currency} value={currency}>
                        {currency}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => setShowSalary((current) => !current)}
                  aria-label={showSalary ? "Hide salary" : "Show salary"}
                >
                  {showSalary ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <p className={canManagePayroll ? "text-xs text-muted-foreground" : "hidden"}>
              Calculated using 30 paid calendar days × shift hours ={" "}
              {estimatedMonthlyHours.toFixed(2)} paid hours/month. Weekly days off and scheduled
              breaks are paid and included.
            </p>
            <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              Time outside {shiftStart}–{shiftEnd} is categorized as overtime, paid at the normal
              hourly rate, and requires approval each time. Breaks are part of the shift hours and
              are never counted as idle.
            </p>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("form")}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={
                  !startDate ||
                  shiftEnd <= shiftStart ||
                  breaks.some(
                    (item) =>
                      item.start_time < shiftStart ||
                      item.end_time > shiftEnd ||
                      item.end_time <= item.start_time,
                  )
                }
                onClick={() => setStep("review")}
              >
                Review
              </Button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-xl border bg-muted/25 p-4 sm:grid-cols-2">
              <div>
                <span className="text-xs text-muted-foreground">Name</span>
                <p className="font-bold">{name}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Email</span>
                <p className="font-bold">{email}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Role</span>
                <p className="font-bold">{kindLabel(kind)}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Teams</span>
                <p className="font-bold">
                  {teams
                    .filter((team) => teamIds.includes(team.id))
                    .map((team) => team.name)
                    .join(", ") || "Company-wide"}
                </p>
              </div>
              {kind === "employee" && (
                <>
                  <div>
                    <span className="text-xs text-muted-foreground">Start / annual leave</span>
                    <p className="font-bold">
                      {startDate} · {displayedLeaveDays} days
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Shift</span>
                    <p className="font-bold">
                      {shiftStart}–{shiftEnd}
                    </p>
                  </div>
                  {canManagePayroll && (
                    <div>
                      <span className="text-xs text-muted-foreground">Salary</span>
                      <p className="font-bold">
                        {showSalary
                          ? `${salaryAmount} ${salaryCurrency} · ${salaryType}`
                          : `•••••• ${salaryCurrency}`}
                      </p>
                    </div>
                  )}
                  <div>
                    <span className="text-xs text-muted-foreground">Breaks</span>
                    <p className="font-bold">
                      {breaks
                        .map((item) => `${item.name} ${item.start_time}–${item.end_time}`)
                        .join(", ")}
                    </p>
                  </div>
                </>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {existingPersonMessage ??
                "No account or invitation has been created yet. Confirm to save this profile and send the invitation."}
            </p>
            <div className="flex justify-between">
              <Button
                variant="ghost"
                onClick={() => setStep(kind === "employee" ? "work" : "form")}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={createMutation.isPending || Boolean(existingPerson)}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? "Creating..." : "Confirm & send invitation"}
              </Button>
            </div>
          </div>
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

type AccessCard = {
  icon: LucideIcon;
  title: string;
  description: string;
  count: string;
};

function accessCardsForRole(role: EditableRole): AccessCard[] {
  if (role === "employee") {
    return [
      {
        icon: Activity,
        title: "My activity",
        description: "Their own timer, sessions, and activity only.",
        count: "Own data",
      },
      {
        icon: Clock3,
        title: "My timesheets",
        description: "Personal worked time and attendance history.",
        count: "Own data",
      },
      {
        icon: CalendarCheck,
        title: "My leave",
        description: "Their own leave balance and holiday requests.",
        count: "Own data",
      },
      {
        icon: ClipboardList,
        title: "My schedule",
        description: "Personal shift, breaks, and workday rules.",
        count: "Own data",
      },
    ];
  }
  if (role === "team_owner") {
    return [
      {
        icon: UsersRound,
        title: "Assigned teams",
        description: "Only teams selected for this lead.",
        count: "Team scope",
      },
      {
        icon: Users,
        title: "Team members",
        description: "People and activity inside assigned teams.",
        count: "Members",
      },
      {
        icon: Clock3,
        title: "Timesheets",
        description: "Team attendance and worked time.",
        count: "Team only",
      },
      {
        icon: CalendarCheck,
        title: "Leave requests",
        description: "Holiday requests from assigned team members.",
        count: "Team only",
      },
      {
        icon: BarChart3,
        title: "Team reports",
        description: "Reports and tasks for assigned teams.",
        count: "Scoped",
      },
    ];
  }
  if (role === "hr") {
    return [
      {
        icon: LayoutDashboard,
        title: "Company dashboard",
        description: "Full workforce visibility across the company.",
        count: "All teams",
      },
      {
        icon: UsersRound,
        title: "All employees",
        description: "Profiles, invitations, schedules, and status.",
        count: "Company-wide",
      },
      {
        icon: CalendarCheck,
        title: "Leave & holidays",
        description: "Review balances and holiday requests.",
        count: "All requests",
      },
      {
        icon: ClipboardList,
        title: "Schedules",
        description: "Workdays, breaks, shifts, and time requests.",
        count: "All staff",
      },
      {
        icon: Banknote,
        title: "Payroll",
        description: "Salary rules, overtime, and payroll previews.",
        count: "Full view",
      },
      {
        icon: BarChart3,
        title: "HR reports",
        description: "Company reports for people and attendance.",
        count: "Company-wide",
      },
    ];
  }
  return [
    {
      icon: LayoutDashboard,
      title: "Company dashboard",
      description: "Full visibility across people, teams, and work.",
      count: "All teams",
    },
    {
      icon: UsersRound,
      title: "All employees",
      description: "Manage people, profiles, roles, and access.",
      count: "Company-wide",
    },
    {
      icon: CalendarCheck,
      title: "Leave & schedules",
      description: "Holiday requests, shifts, breaks, and time reviews.",
      count: "All staff",
    },
    {
      icon: Banknote,
      title: "Payroll",
      description: "Salary, overtime, deductions, and payroll previews.",
      count: "Full view",
    },
    {
      icon: Settings,
      title: "Settings & audit",
      description: "Tracking settings, audit log, and system controls.",
      count: "Admin tools",
    },
    {
      icon: KeyRound,
      title: "Access management",
      description: "Passwords, roles, permissions, and account actions.",
      count: "Full control",
    },
  ];
}

function RoleAccessSummary({
  role,
  mode,
  permissionCount,
  showFull,
  onToggleFull,
}: {
  role: EditableRole;
  mode: PermissionMode;
  permissionCount: number;
  showFull: boolean;
  onToggleFull: () => void;
}) {
  const cards = accessCardsForRole(role);
  const isCompanyWide = role === "hr" || role === "general_admin";

  return (
    <div className="rounded-xl border bg-muted/15 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Label>What this role can access</Label>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-extrabold text-primary">
              {roleLabel(role)}
              {mode === "custom" ? " · custom" : ""}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {role === "employee"
              ? "This role only sees their own account after saving."
              : isCompanyWide
                ? "This role has company-wide visibility after saving."
                : "This role only sees assigned teams after saving."}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onToggleFull}>
          <Eye className="mr-1.5 h-3.5 w-3.5" />
          {showFull ? "Hide full permissions" : "View full permissions"}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <RoleAccessCard key={card.title} card={card} />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {role === "employee"
          ? "Employee access uses the employee portal and desktop app, not the admin dashboard."
          : `${permissionCount} permission signals included in this preset.`}
      </p>
    </div>
  );
}

function RoleAccessCard({ card }: { card: AccessCard }) {
  const Icon = card.icon;
  return (
    <div className="rounded-lg border bg-card/80 p-3">
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#fce3ec] text-[#e5185d]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-extrabold text-foreground">{card.title}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {card.count}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{card.description}</p>
        </div>
      </div>
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
      <div className="grid gap-2 md:grid-cols-2">
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
  role: EditableRole;
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
          <Label>Full permission details</Label>
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
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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

function roleLabel(role: EditableRole): string {
  if (role === "employee") return "Employee";
  if (role === "team_owner") return "Team lead";
  if (role === "hr") return "HR";
  return "General admin";
}
