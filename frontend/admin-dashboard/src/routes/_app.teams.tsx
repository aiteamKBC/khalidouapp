import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Clock3, Plus, RotateCcw, Search, ShieldCheck, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { addTeamMember, addTeamOwner, createTeam, listTeams } from "@/api/teams";
import { listEmployees } from "@/api/employees";
import { listUsers } from "@/api/users";
import { formatMinutes, formatRelative } from "@/lib/format";
import { toast } from "sonner";
import { MetricTile } from "@/components/ui/metric-tile";

export const Route = createFileRoute("/_app/teams")({
  component: TeamsPage,
});

function TeamsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname !== "/teams" ? <Outlet /> : <TeamsList />;
}

function TeamsList() {
  const { scopedTeamIds, can } = useAuth();
  const canManageTeams = can(permissions.teamsManage);
  const canManageAccess = can(permissions.accessManage);
  const scope = scopedTeamIds();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });
  const emps = useQuery({
    queryKey: ["employees-all"],
    queryFn: () => listEmployees(),
    refetchInterval: 30_000,
  });
  const owners = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    enabled: canManageAccess,
  });

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [ownerId, setOwnerId] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
  const [newOwnerIds, setNewOwnerIds] = useState<string[]>([]);

  function resetCreateForm() {
    setNewName("");
    setNewDescription("");
    setNewMemberIds([]);
    setNewOwnerIds([]);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const team = await createTeam({ name: newName, description: newDescription });
      // Add the chosen members and owners to the freshly-created team.
      await Promise.all([
        ...newMemberIds.map((id) => addTeamMember(team.id, id)),
        ...newOwnerIds.map((id) => addTeamOwner(team.id, id)),
      ]);
      return team;
    },
    onSuccess: async () => {
      toast.success("Team created");
      setCreateOpen(false);
      resetCreateForm();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
        queryClient.invalidateQueries({ queryKey: ["employees-all"] }),
        queryClient.invalidateQueries({ queryKey: ["users"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to create team"),
  });

  const rows = useMemo(() => {
    return (teams.data ?? []).filter((team) => {
      if (q && !team.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (status !== "all" && team.status !== status) return false;
      if (ownerId === "none" && team.ownerIds.length > 0) return false;
      if (ownerId !== "all" && ownerId !== "none" && !team.ownerIds.includes(ownerId)) return false;
      return true;
    });
  }, [teams.data, q, status, ownerId]);

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate();
  }

  function toggleMember(id: string, checked: boolean) {
    setNewMemberIds((cur) => (checked ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)));
  }

  function toggleOwner(id: string, checked: boolean) {
    setNewOwnerIds((cur) => (checked ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)));
  }

  const teamOwnerUsers = (owners.data ?? []).filter((user) => user.role === "team_owner");
  const hasActiveFilters = Boolean(q) || status !== "all" || ownerId !== "all";

  function clearFilters() {
    setQ("");
    setStatus("all");
    setOwnerId("all");
  }

  return (
    <div className="studio-page">
      <PageHeader
        title="Teams"
        description="Organize employees into teams and assign owners."
        actions={
          canManageTeams && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New team
            </Button>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          icon={UsersRound}
          value={(teams.data ?? []).length}
          label="Total teams"
          hint="Across your workspace"
          tone="violet"
        />
        <MetricTile
          icon={ShieldCheck}
          value={(teams.data ?? []).filter((team) => team.ownerIds.length > 0).length}
          label="Teams with owners"
          hint="Clear accountability"
          tone="green"
        />
        <MetricTile
          icon={UsersRound}
          value={(emps.data ?? []).filter((employee) => employee.status !== "offline").length}
          label="People online"
          hint="Live right now"
          tone="blue"
        />
        <MetricTile
          icon={Clock3}
          value={formatMinutes(
            (emps.data ?? []).reduce((sum, employee) => sum + employee.workedTodayMinutes, 0),
          )}
          label="Worked today"
          hint="All visible members"
          tone="pink"
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search teams..."
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          {canManageAccess && (
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                <SelectItem value="none">No owner</SelectItem>
                {(owners.data ?? []).map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name} ·{" "}
                    {user.role === "general_admin"
                      ? "General admin"
                      : user.role === "hr"
                        ? "HR"
                        : "Team manager"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {teams.isLoading
              ? "Loading teams..."
              : `${rows.length} ${rows.length === 1 ? "team" : "teams"}${
                  hasActiveFilters ? ` shown out of ${(teams.data ?? []).length}` : ""
                }`}
          </span>
          {hasActiveFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      {emps.isError && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-destructive/40 p-4">
          <p className="text-sm text-destructive">
            Employee totals and activity are unavailable, so team metrics are temporarily hidden.
          </p>
          <Button variant="outline" size="sm" onClick={() => emps.refetch()}>
            Retry
          </Button>
        </Card>
      )}

      {teams.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`team-card-skeleton-${index}`} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="py-12 text-center text-sm text-muted-foreground">
          {hasActiveFilters ? "No teams match your filters." : "No teams have been created yet."}
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {rows.map((team) => {
            const members = (emps.data ?? []).filter((employee) =>
              employee.teamIds.includes(team.id),
            );
            const online = members.filter((employee) => employee.status !== "offline").length;
            const workedMinutes = members.reduce(
              (sum, employee) => sum + employee.workedTodayMinutes,
              0,
            );
            const lastHeartbeat = members
              .map((member) => member.lastHeartbeat)
              .filter(Boolean)
              .sort()
              .reverse()[0];
            const ownerNames = team.ownerIds
              .map((id) => (owners.data ?? []).find((user) => user.id === id)?.name)
              .filter(Boolean);
            return (
              <Card
                key={team.id}
                className="group overflow-hidden p-5 transition hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                      <UsersRound className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-extrabold">{team.name}</h3>
                      <p className="truncate text-xs text-muted-foreground">
                        {team.description || "No description yet"}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={team.status} />
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <TeamMiniMetric label="Members" value={emps.isError ? "—" : members.length} />
                  <TeamMiniMetric label="Online" value={emps.isError ? "—" : online} tone="green" />
                  <TeamMiniMetric
                    label="Hours today"
                    value={emps.isError ? "—" : formatMinutes(workedMinutes)}
                  />
                  <TeamMiniMetric
                    label="Latest"
                    value={emps.isError ? "—" : formatRelative(lastHeartbeat)}
                  />
                </div>

                <div className="mt-5 rounded-2xl bg-muted/45 p-3">
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
                    Team manager
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold">
                    {ownerNames.length ? ownerNames.join(", ") : "No manager assigned"}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex -space-x-2">
                    {members.slice(0, 5).map((member) => (
                      <span
                        key={member.id}
                        title={member.name}
                        className="grid h-8 w-8 place-items-center rounded-full border-2 border-card bg-muted text-[10px] font-bold"
                      >
                        {member.name
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                    ))}
                    {members.length > 5 && (
                      <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-card bg-primary/10 text-[10px] font-bold text-primary">
                        +{members.length - 5}
                      </span>
                    )}
                  </div>
                  <Button asChild size="sm">
                    <Link to="/teams/$teamId" params={{ teamId: team.id }}>
                      Open workspace
                    </Link>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead className="hidden lg:table-cell">Owners</TableHead>
              <TableHead>Employees</TableHead>
              <TableHead className="hidden sm:table-cell">Online</TableHead>
              <TableHead className="hidden md:table-cell">Hours today</TableHead>
              <TableHead className="hidden xl:table-cell">Last activity</TableHead>
              <TableHead>Team status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((team) => {
              const members = (emps.data ?? []).filter((employee) =>
                employee.teamIds.includes(team.id),
              );
              const online = members.filter((employee) => employee.status !== "offline").length;
              const workedMinutes = members.reduce(
                (sum, employee) => sum + employee.workedTodayMinutes,
                0,
              );
              const lastHeartbeat = members
                .map((member) => member.lastHeartbeat)
                .filter(Boolean)
                .sort()
                .reverse()[0];
              const ownerNames = team.ownerIds
                .map((id) => (owners.data ?? []).find((user) => user.id === id)?.name)
                .filter(Boolean)
                .join(", ");
              return (
                <TableRow
                  key={team.id}
                  role="link"
                  tabIndex={0}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => navigate({ to: "/teams/$teamId", params: { teamId: team.id } })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate({ to: "/teams/$teamId", params: { teamId: team.id } });
                    }
                  }}
                >
                  <TableCell>
                    <div className="font-medium">{team.name}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {team.description}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {ownerNames || `${team.ownerIds.length} owner(s)`}
                  </TableCell>
                  <TableCell>{emps.isError ? "—" : members.length}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {emps.isError ? "—" : online}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {emps.isError ? "—" : formatMinutes(workedMinutes)}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                    {emps.isError ? "—" : formatRelative(lastHeartbeat)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={team.status} />
                  </TableCell>
                  <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/teams/$teamId" params={{ teamId: team.id }}>
                        View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {teams.isLoading &&
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={`team-skeleton-${index}`}>
                  <TableCell>
                    <Skeleton className="h-9 w-40" />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Skeleton className="h-5 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-8" />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Skeleton className="h-5 w-8" />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Skeleton className="h-5 w-14" />
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-6 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-8 w-12" />
                  </TableCell>
                </TableRow>
              ))}
            {!teams.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm">
                  {teams.isError ? (
                    <div className="flex flex-col items-center gap-3 text-destructive">
                      <span>Couldn&apos;t load teams. Check your connection and try again.</span>
                      <Button variant="outline" size="sm" onClick={() => teams.refetch()}>
                        Retry
                      </Button>
                    </div>
                  ) : (teams.data ?? []).length === 0 ? (
                    <span className="text-muted-foreground">
                      No teams yet. Click “New team” to create one.
                    </span>
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <span>No teams match your filters.</span>
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCreateForm();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create team</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Name</Label>
              <Input
                id="team-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-description">Description</Label>
              <Textarea
                id="team-description"
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
              />
            </div>

            <PickList
              label="Owners"
              hint="Team owners (admins) who manage this team. Add owners from the People page first."
              empty="No team owners yet — create one in People."
              options={teamOwnerUsers.map((user) => ({ id: user.id, label: user.name }))}
              selected={newOwnerIds}
              onToggle={toggleOwner}
            />

            <PickList
              label="Members"
              hint="Employees to add to this team."
              empty="No employees yet — add one in People."
              options={(emps.data ?? []).map((employee) => ({
                id: employee.id,
                label: employee.name,
                sub: employee.email,
              }))}
              selected={newMemberIds}
              onToggle={toggleMember}
            />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending
                  ? "Creating..."
                  : `Create team${
                      newMemberIds.length || newOwnerIds.length
                        ? ` (${newOwnerIds.length} owner, ${newMemberIds.length} member)`
                        : ""
                    }`}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TeamMiniMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "green";
}) {
  return (
    <div className="rounded-2xl border bg-background/70 p-3 text-center">
      <p
        className={`font-mono-numeric text-xl font-extrabold ${
          tone === "green" ? "text-success" : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function PickList({
  label,
  hint,
  empty,
  options,
  selected,
  onToggle,
}: {
  label: string;
  hint: string;
  empty: string;
  options: { id: string; label: string; sub?: string }[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div>
        <Label>
          {label}
          {selected.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {selected.length} selected
            </span>
          )}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
          {options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(option.id)}
                onCheckedChange={(checked) => onToggle(option.id, checked === true)}
              />
              <span>
                {option.label}
                {option.sub && (
                  <span className="ml-1 text-xs text-muted-foreground">{option.sub}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
