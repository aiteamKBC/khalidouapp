import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { listEmployees } from "@/api/employees";
import { listTeams } from "@/api/teams";
import { listDevices } from "@/api/devices";
import { listTasks } from "@/api/projects";
import { useAuth } from "@/lib/auth";
import { formatMinutes, formatRelative } from "@/lib/format";

export const Route = createFileRoute("/_app/live-activity")({
  component: () => <Navigate to="/people" search={{ tab: "live" }} />,
});

export function LiveActivityPage({ embedded = false }: { embedded?: boolean }) {
  const { scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const emps = useQuery({
    queryKey: ["live", scope],
    queryFn: () => listEmployees(scope),
    refetchInterval: 15_000,
  });
  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });
  const tasks = useQuery({
    queryKey: ["tasks", scope],
    queryFn: () => listTasks({ scopedTeamIds: scope }),
  });
  const devices = useQuery({ queryKey: ["devices", scope], queryFn: () => listDevices(scope) });

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="Live Activity"
          description="Real-time tracking state across your workforce."
          actions={
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              <RefreshCw className={`h-3 w-3 ${emps.isFetching ? "animate-spin" : ""}`} />
              {emps.isFetching ? "Refreshing..." : "Auto-refresh 15s"}
            </span>
          }
        />
      )}

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Idle</TableHead>
              <TableHead>Last heartbeat</TableHead>
              <TableHead>Device</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(emps.data ?? []).map((employee) => {
              const task = (tasks.data ?? []).find((item) => item.id === employee.currentTaskId);
              const team = (teams.data ?? []).find(
                (item) => item.id === (employee.currentTeamId ?? employee.teamIds[0]),
              );
              const device = (devices.data ?? []).find(
                (item) => item.id === employee.currentDeviceId,
              );
              const session = employee.sessionStart
                ? Math.round((Date.now() - new Date(employee.sessionStart).getTime()) / 60000)
                : 0;
              return (
                <TableRow key={employee.id}>
                  <TableCell className="font-medium">{employee.name}</TableCell>
                  <TableCell className="text-sm">{team?.name ?? "-"}</TableCell>
                  <TableCell className="text-sm">{task?.projectName ?? "-"}</TableCell>
                  <TableCell className="text-sm">{task?.name ?? "-"}</TableCell>
                  <TableCell>
                    <StatusBadge status={employee.status} />
                  </TableCell>
                  <TableCell>{employee.sessionStart ? formatMinutes(session) : "-"}</TableCell>
                  <TableCell>{formatMinutes(employee.idleMinutes)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelative(employee.lastHeartbeat)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {device ? <StatusBadge status={device.status} /> : "-"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
