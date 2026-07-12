import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import {
  Plus,
  Search,
  UserPlus,
  UserCircle,
  ShieldCheck,
  KeyRound,
  Copy,
  ArrowLeft,
  CheckCircle2,
  Activity,
  UsersRound,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  createEnrollmentCode,
  createPortalAccessKey,
  getEmployee,
  listEmployees,
} from "@/api/employees";
import { deactivateUser, listUsers, updateUser } from "@/api/users";
import { addTeamOwner, listTeams, removeTeamOwner } from "@/api/teams";
import { invitePerson } from "@/api/people";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import type { Employee, Role, Team, User, UserStatus } from "@/types";
import { EmployeesList } from "./_app.employees";
import { LiveActivityPage } from "./_app.live-activity";

export const Route = createFileRoute("/_app/people")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab:
      search.tab === "directory" || search.tab === "employees" || search.tab === "live"
        ? search.tab
        : "directory",
  }),
  component: PeopleHubPage,
});

// A person is either a tracked Employee (no dashboard login — uses a desktop
// enrollment code + optional portal key) or an admin User (dashboard login with
// a password + role). This hub is the single place to create and manage both.
type PersonKind = "employee" | "team_owner" | "general_admin";
type TypeFilter = "all" | "employees" | "admins";

type PersonRow = {
  id: string;
  kind: "employee" | "admin";
  name: string;
  email: string;
  roleLabel: string;
  detail: string;
  status: UserStatus;
  employee?: Employee;
  user?: User;
};

function PeopleHubPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const tab = search.tab === "directory" && !hasRole("general_admin") ? "employees" : search.tab;

  return (
    <div>
      <PageHeader
        title="People"
        description="Manage people, employee tracking, and live workforce activity from one place."
      />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {hasRole("general_admin") && (
          <Button
            variant="ghost"
            className={`rounded-none border-b-2 px-4 ${tab === "directory" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
            onClick={() => navigate({ to: "/people", search: { tab: "directory" } })}
          >
            <UsersRound className="mr-2 h-4 w-4" /> Directory
          </Button>
        )}
        <Button
          variant="ghost"
          className={`rounded-none border-b-2 px-4 ${tab === "employees" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
          onClick={() => navigate({ to: "/people", search: { tab: "employees" } })}
        >
          <UserCircle className="mr-2 h-4 w-4" /> Employees
        </Button>
        <Button
          variant="ghost"
          className={`rounded-none border-b-2 px-4 ${tab === "live" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
          onClick={() => navigate({ to: "/people", search: { tab: "live" } })}
        >
          <Activity className="mr-2 h-4 w-4" /> Live Activity
        </Button>
      </div>
      {tab === "directory" ? (
        <PeopleDirectory embedded />
      ) : tab === "employees" ? (
        <EmployeesList embedded />
      ) : (
        <LiveActivityPage embedded />
      )}
    </div>
  );
}

function PeopleDirectory({ embedded = false }: { embedded?: boolean }) {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const users = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const employees = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees() });
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => listTeams() });

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [wizardOpen, setWizardOpen] = useState(false);

  // Admin edit ("manage access") state.
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<Role>("team_owner");
  const [editTeamIds, setEditTeamIds] = useState<string[]>([]);

  const teamNames = useMemo(
    () => new Map((teams.data ?? []).map((team) => [team.id, team.name])),
    [teams.data],
  );

  const rows = useMemo<PersonRow[]>(() => {
    const employeeRows: PersonRow[] = (employees.data ?? []).map((employee) => ({
      id: employee.id,
      kind: "employee",
      name: employee.name,
      email: employee.email,
      roleLabel: "Employee",
      detail: employee.department || "—",
      status: employee.active ? "active" : "inactive",
      employee,
    }));
    const adminRows: PersonRow[] = (users.data ?? []).map((user) => ({
      id: user.id,
      kind: "admin",
      name: user.name,
      email: user.email,
      roleLabel: user.role === "general_admin" ? "General admin" : "Team manager",
      detail:
        user.role === "general_admin"
          ? "All teams"
          : user.assignedTeamIds
              .map((id) => teamNames.get(id))
              .filter(Boolean)
              .join(", ") || "—",
      status: user.status,
      user,
    }));
    const all = [...adminRows, ...employeeRows];
    return all.filter((row) => {
      if (typeFilter === "employees" && row.kind !== "employee") return false;
      if (typeFilter === "admins" && row.kind !== "admin") return false;
      if (q && !`${row.name} ${row.email}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [employees.data, users.data, teamNames, typeFilter, q]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editUser) throw new Error("Choose a person to manage.");
      const updated = await updateUser(editUser.id, {
        name: editName,
        email: editEmail,
        password: editPassword || undefined,
        role: editRole,
      });
      const current = new Set(editUser.assignedTeamIds);
      const next = new Set(editRole === "team_owner" ? editTeamIds : []);
      await Promise.all([
        ...[...current].filter((id) => !next.has(id)).map((id) => removeTeamOwner(id, editUser.id)),
        ...[...next].filter((id) => !current.has(id)).map((id) => addTeamOwner(id, editUser.id)),
      ]);
      return updated;
    },
    onSuccess: async () => {
      toast.success("Access updated");
      setEditUser(null);
      setEditPassword("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to update access"),
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateUser,
    onSuccess: async () => {
      toast.success("Admin deactivated");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to deactivate"),
  });

  if (!hasRole("general_admin")) return <Navigate to="/dashboard" />;

  function openEdit(user: User) {
    setEditUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditPassword("");
    setEditRole(user.role);
    setEditTeamIds(user.assignedTeamIds);
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
            <h2 className="text-sm font-semibold">People directory & access</h2>
            <p className="text-xs text-muted-foreground">
              Add employees, Team Managers, or General Admins and choose their teams and sign-in
              method.
            </p>
          </div>
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add person
          </Button>
        </div>
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
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
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Type / role</TableHead>
              <TableHead>Teams / department</TableHead>
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
                  {row.kind === "employee" ? "Enrollment code + portal key" : "Password"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="space-x-1 text-right">
                  {row.kind === "employee" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        navigate({
                          to: "/employees/$employeeId",
                          params: { employeeId: row.id },
                        })
                      }
                    >
                      Access & codes
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(row.user!)}>
                        Manage access
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={row.status !== "active" || deactivateMutation.isPending}
                        onClick={() => deactivateMutation.mutate(row.id)}
                      >
                        Deactivate
                      </Button>
                    </>
                  )}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage admin access</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              updateMutation.mutate();
            }}
          >
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
                <Label>Role</Label>
                <Select value={editRole} onValueChange={(value) => setEditRole(value as Role)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team_owner">Team manager</SelectItem>
                    <SelectItem value="general_admin">General admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editRole === "team_owner" && (
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
            <div className="flex justify-end gap-2">
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
    </div>
  );
}

function AddPersonWizard({
  open,
  onOpenChange,
  teams,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: Team[];
  onCreated: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<"type" | "form" | "credentials">("type");
  const [kind, setKind] = useState<PersonKind>("employee");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);

  // Credentials step (employee only).
  const [createdEmployee, setCreatedEmployee] = useState<Employee | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState<string>();
  const [portalKey, setPortalKey] = useState<string>();

  function reset() {
    setStep("type");
    setKind("employee");
    setName("");
    setEmail("");
    setDepartment("");
    setTeamIds([]);
    setCreatedEmployee(null);
    setEnrollmentCode(undefined);
    setPortalKey(undefined);
  }

  function close() {
    onOpenChange(false);
    // Delay reset so the closing animation doesn't flash the first step.
    setTimeout(reset, 200);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const invitation = await invitePerson({
        name,
        email,
        kind: kind === "team_owner" ? "team_manager" : kind,
        teamIds,
        department,
        timezone: "Africa/Cairo",
      });
      const employee = invitation.employeeId ? await getEmployee(invitation.employeeId) : undefined;
      return { kind, employee, invitation };
    },
    onSuccess: async (result) => {
      await onCreated();
      if (result.kind === "employee" && result.employee) {
        setCreatedEmployee(result.employee);
        setStep("credentials");
        toast.success("Employee created — now share their sign-in code");
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

  const codeMutation = useMutation({
    mutationFn: () => createEnrollmentCode(createdEmployee!.id, 14),
    onSuccess: (code) => {
      setEnrollmentCode(code.code);
      toast.success("Enrollment code created");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to create code"),
  });

  const keyMutation = useMutation({
    mutationFn: () => createPortalAccessKey(createdEmployee!.id),
    onSuccess: (result) => {
      setPortalKey(result.accessKey);
      toast.success("Portal key created");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to create portal key"),
  });

  function submitForm(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "type" && "Add a person"}
            {step === "form" && `New ${kindLabel(kind).toLowerCase()}`}
            {step === "credentials" && "Employee sign-in"}
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
              subtitle="Tracked worker. Signs in on the desktop app with an enrollment code (and optional web portal key). No password, no dashboard access."
            />
            <TypeOption
              active={kind === "team_owner"}
              onClick={() => setKind("team_owner")}
              icon={UserPlus}
              title="Team manager"
              subtitle="Manages assigned teams in the dashboard and has an Employee profile, so they can receive and track their own tasks."
            />
            <TypeOption
              active={kind === "general_admin"}
              onClick={() => setKind("general_admin")}
              icon={ShieldCheck}
              title="General admin"
              subtitle="Company-wide admin with access to every team and permission to review a team manager's own task."
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
              </div>
              {kind === "employee" && (
                <div className="space-y-1.5">
                  <Label htmlFor="person-department">Department</Label>
                  <Input
                    id="person-department"
                    value={department}
                    onChange={(event) => setDepartment(event.target.value)}
                  />
                </div>
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
                    ((kind === "employee" || kind === "team_owner") && teamIds.length === 0)
                  }
                >
                  {createMutation.isPending
                    ? "Creating..."
                    : `Create ${kindLabel(kind).toLowerCase()}`}
                </Button>
              </div>
            </div>
          </form>
        )}

        {step === "credentials" && createdEmployee && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span>
                <span className="font-medium">{createdEmployee.name}</span> was created. Generate a
                sign-in credential below and share it with them.
              </span>
            </div>

            <CredentialRow
              title="Desktop enrollment code"
              subtitle="Used once to link the desktop app. It is shown here only and is not sent by email."
              value={enrollmentCode}
              buttonLabel={enrollmentCode ? "Regenerate" : "Generate code"}
              onGenerate={() => codeMutation.mutate()}
              pending={codeMutation.isPending}
            />

            <CredentialRow
              title="Web portal key (optional)"
              subtitle="Lets them sign in at /employee. Share it securely; it is not sent by email."
              value={portalKey}
              buttonLabel={portalKey ? "Regenerate" : "Generate key"}
              onGenerate={() => keyMutation.mutate()}
              pending={keyMutation.isPending}
            />

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

function CredentialRow({
  title,
  subtitle,
  value,
  buttonLabel,
  onGenerate,
  pending,
}: {
  title: string;
  subtitle: string;
  value?: string;
  buttonLabel: string;
  onGenerate: () => void;
  pending: boolean;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onGenerate} disabled={pending}>
          <KeyRound className="mr-2 h-4 w-4" />
          {pending ? "..." : buttonLabel}
        </Button>
      </div>
      {value && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-success/30 bg-success/10 p-3">
          <div className="break-all font-mono text-base font-semibold">{value}</div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(value);
              toast.success("Copied");
            }}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy
          </Button>
        </div>
      )}
    </div>
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
  if (kind === "team_owner") return "Team manager";
  return "General admin";
}
