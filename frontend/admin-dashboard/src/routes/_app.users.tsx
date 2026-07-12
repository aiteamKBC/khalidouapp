import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
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
import { createUser, deactivateUser, listUsers, updateUser } from "@/api/users";
import { addTeamOwner, listTeams, removeTeamOwner } from "@/api/teams";
import { formatRelative } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import type { Role, User } from "@/types";

export const Route = createFileRoute("/_app/users")({
  component: UsersPage,
});

function UsersPage() {
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => listTeams() });
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("team_owner");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<Role>("team_owner");

  const createMutation = useMutation({
    mutationFn: async () => {
      const user = await createUser({ name, email, password, role });
      if (role === "team_owner") {
        await Promise.all(teamIds.map((teamId) => addTeamOwner(teamId, user.id)));
      }
      return user;
    },
    onSuccess: async () => {
      toast.success("User created");
      setCreateOpen(false);
      setName("");
      setEmail("");
      setPassword("");
      setRole("team_owner");
      setTeamIds([]);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to create user"),
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateUser,
    onSuccess: async () => {
      toast.success("User deactivated");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to deactivate user"),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingUser) throw new Error("Choose a user to manage.");
      const user = await updateUser(editingUser.id, {
        name: editName,
        email: editEmail,
        password: editPassword || undefined,
        role: editRole,
      });
      const currentTeamIds = new Set(editingUser.assignedTeamIds);
      const nextTeamIds = new Set(editRole === "team_owner" ? teamIds : []);
      await Promise.all([
        ...[...currentTeamIds]
          .filter((teamId) => !nextTeamIds.has(teamId))
          .map((teamId) => removeTeamOwner(teamId, editingUser.id)),
        ...[...nextTeamIds]
          .filter((teamId) => !currentTeamIds.has(teamId))
          .map((teamId) => addTeamOwner(teamId, editingUser.id)),
      ]);
      return user;
    },
    onSuccess: async () => {
      toast.success("User access updated");
      setEditOpen(false);
      setEditingUser(null);
      setEditPassword("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to update user access"),
  });

  if (!hasRole("general_admin")) return <Navigate to="/dashboard" />;

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate();
  }

  function openUserAccess(user: User) {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditPassword("");
    setEditRole(user.role);
    setTeamIds(user.assignedTeamIds);
    setEditOpen(true);
  }

  function toggleTeam(teamId: string, checked: boolean) {
    setTeamIds((current) =>
      checked ? [...new Set([...current, teamId])] : current.filter((id) => id !== teamId),
    );
  }

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        description="One place for admin passwords, roles and team access. Employee access is managed from Employees."
        actions={
          <Button
            onClick={() => {
              setTeamIds([]);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add admin user
          </Button>
        }
      />

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Assigned teams</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last update</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users.data ?? []).map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                <TableCell className="text-sm">
                  {user.role === "team_owner" ? "Team manager" : "General admin"}
                </TableCell>
                <TableCell className="text-sm">
                  {user.assignedTeamIds
                    .map((id) => (teams.data ?? []).find((team) => team.id === id)?.name)
                    .filter(Boolean)
                    .join(", ") || "-"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={user.status} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatRelative(user.lastLogin)}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="sm" onClick={() => openUserAccess(user)}>
                    Manage access
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={user.status !== "active" || deactivateMutation.isPending}
                    onClick={() => deactivateMutation.mutate(user.id)}
                  >
                    Deactivate
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setTeamIds([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add admin user</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="admin-name">Name</Label>
                <Input
                  id="admin-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-email">Email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-password">Temporary password</Label>
                <Input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={role} onValueChange={(value) => setRole(value as Role)}>
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
            {role === "team_owner" && (
              <TeamAccessSelector
                teams={teams.data ?? []}
                teamIds={teamIds}
                onToggle={toggleTeam}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create admin user"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setEditingUser(null);
            setEditPassword("");
          }
        }}
      >
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
                <Label htmlFor="edit-admin-name">Name</Label>
                <Input
                  id="edit-admin-name"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-admin-email">Email</Label>
                <Input
                  id="edit-admin-email"
                  type="email"
                  value={editEmail}
                  onChange={(event) => setEditEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-admin-password">New password</Label>
                <Input
                  id="edit-admin-password"
                  type="password"
                  value={editPassword}
                  onChange={(event) => setEditPassword(event.target.value)}
                  minLength={editPassword ? 8 : undefined}
                  placeholder="Leave blank to keep the current password"
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
                teamIds={teamIds}
                onToggle={toggleTeam}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
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
        <Label>Team access</Label>
        <p className="text-xs text-muted-foreground">
          Choose the teams this team manager can manage. General admins can manage every team.
        </p>
      </div>
      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Create a team before assigning a team manager.
        </p>
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
