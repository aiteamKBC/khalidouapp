import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import { permissions } from "@/lib/permissions";

export const Route = createFileRoute("/_app/audit-log")({
  component: AuditLogPage,
});

const PAGE_SIZE = 100;

function AuditLogPage() {
  const { can } = useAuth();
  const canViewAudit = can(permissions.auditView);
  const [userId, setUserId] = useState("all");
  const [action, setAction] = useState("all");
  const [entity, setEntity] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  // Filters are sent to the backend so search reaches the full history rather
  // than only the loaded page; results are paginated honestly (W11).
  const log = useQuery({
    queryKey: ["audit", { userId, action, entity, from, to, page }],
    queryFn: ({ signal }) =>
      listAuditLog(
        {
          page,
          pageSize: PAGE_SIZE,
          userId: userId === "all" ? undefined : userId,
          action: action === "all" ? undefined : action,
          entityType: entity === "all" ? undefined : entity,
          dateFrom: from || undefined,
          dateTo: to || undefined,
          // The displayed timestamps use the browser timezone; filter by the
          // same zone so a From/To day matches what the viewer sees (W12).
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        signal,
      ),
    enabled: canViewAudit,
    placeholderData: (previous) => previous,
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: ({ signal }) => listUsers(signal),
    enabled: canViewAudit,
  });

  const resetToFirstPage = () => setPage(1);
  const onUserChange = (value: string) => {
    setUserId(value);
    resetToFirstPage();
  };
  const onActionChange = (value: string) => {
    setAction(value);
    resetToFirstPage();
  };
  const onEntityChange = (value: string) => {
    setEntity(value);
    resetToFirstPage();
  };
  const onFromChange = (value: string) => {
    setFrom(value);
    resetToFirstPage();
  };
  const onToChange = (value: string) => {
    setTo(value);
    resetToFirstPage();
  };

  const actions = log.data?.availableActions ?? [];
  const entities = log.data?.availableEntityTypes ?? [];
  const rows = log.data?.rows ?? [];
  const total = log.data?.total ?? 0;
  const totalPages = log.data?.totalPages ?? 1;

  if (!canViewAudit) return <Navigate to="/dashboard" replace />;

  return (
    <div className="studio-page">
      <PageHeader
        title="Audit Log"
        description="Historical record of admin actions and system events."
      />

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Select value={userId} onValueChange={onUserChange}>
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
          <Select value={action} onValueChange={onActionChange}>
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
          <Select value={entity} onValueChange={onEntityChange}>
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
          <Input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
          <Button
            variant="outline"
            onClick={() => {
              setUserId("all");
              setAction("all");
              setEntity("all");
              setFrom("");
              setTo("");
              setPage(1);
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

      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total === 0
            ? "No matching events"
            : `Page ${page} of ${totalPages} • ${total} event${total === 1 ? "" : "s"}`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || log.isFetching}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || log.isFetching}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
