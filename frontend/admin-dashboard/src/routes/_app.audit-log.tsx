import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { listAuditLog, listUsers } from "@/api/users";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/audit-log")({
  component: AuditLogPage,
});

function AuditLogPage() {
  const { hasRole } = useAuth();
  const isGeneralAdmin = hasRole("general_admin");
  const log = useQuery({
    queryKey: ["audit"],
    queryFn: listAuditLog,
    enabled: isGeneralAdmin,
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    enabled: isGeneralAdmin,
  });
  const [userId, setUserId] = useState("all");
  const [action, setAction] = useState("all");
  const [entity, setEntity] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const actions = useMemo(
    () => Array.from(new Set((log.data ?? []).map((e) => e.action))),
    [log.data],
  );
  const entities = useMemo(
    () => Array.from(new Set((log.data ?? []).map((e) => e.entityType))),
    [log.data],
  );

  const rows = (log.data ?? []).filter((e) => {
    if (userId !== "all" && e.userId !== userId) return false;
    if (action !== "all" && e.action !== action) return false;
    if (entity !== "all" && e.entityType !== entity) return false;
    if (from && e.at < from) return false;
    if (to && e.at > to) return false;
    return true;
  });

  if (!isGeneralAdmin) return <Navigate to="/dashboard" />;

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Historical record of admin actions and system events."
      />

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="User" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All users</SelectItem>
              {(users.data ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger>
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger>
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {entities.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button
            variant="outline"
            onClick={() => {
              setUserId("all");
              setAction("all");
              setEntity("all");
              setFrom("");
              setTo("");
            }}
          >
            Reset
          </Button>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(e.at)}
                </TableCell>
                <TableCell>{e.userName}</TableCell>
                <TableCell className="text-sm capitalize">{e.action.replace(/_/g, " ")}</TableCell>
                <TableCell className="text-sm">{e.entityType}</TableCell>
                <TableCell className="text-sm">{e.entityName}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{e.ip}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{e.details ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
