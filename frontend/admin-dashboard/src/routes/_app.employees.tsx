import { createFileRoute, Link, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
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
import { useAuth } from "@/lib/auth";
import { listEmployees } from "@/api/employees";
import { listTeams } from "@/api/teams";
import { listDevices } from "@/api/devices";
import { formatMinutes, formatRelative } from "@/lib/format";

export const Route = createFileRoute("/_app/employees")({
  component: EmployeesPage,
});

function EmployeesPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname !== "/employees" ? (
    <Outlet />
  ) : (
    <Navigate to="/people" search={{ tab: "employees" }} />
  );
}

export function EmployeesList({ embedded = false }: { embedded?: boolean }) {
  const { scopedTeamIds, hasRole } = useAuth();
  const scope = scopedTeamIds();
  const emps = useQuery({ queryKey: ["employees", scope], queryFn: () => listEmployees(scope) });
  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });
  const devices = useQuery({ queryKey: ["devices", scope], queryFn: () => listDevices(scope) });

  const [q, setQ] = useState("");
  const [teamId, setTeamId] = useState("all");
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState("all");

  const departments = useMemo(
    () =>
      Array.from(new Set((emps.data ?? []).map((employee) => employee.department).filter(Boolean))),
    [emps.data],
  );

  const rows = useMemo(
    () =>
      (emps.data ?? []).filter((employee) => {
        if (
          q &&
          !`${employee.name} ${employee.email} ${employee.code}`
            .toLowerCase()
            .includes(q.toLowerCase())
        )
          return false;
        if (teamId !== "all" && !employee.teamIds.includes(teamId)) return false;
        if (dept !== "all" && employee.department !== dept) return false;
        if (status !== "all" && employee.status !== status) return false;
        return true;
      }),
    [emps.data, q, teamId, dept, status],
  );

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="Employees"
          description="Monitor employee activity. Add or manage people from the People page."
          actions={
            hasRole("general_admin") && (
              <Button asChild>
                <Link to="/people" search={{ tab: "directory" }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add person
                </Link>
              </Button>
            )
          }
        />
      )}

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employees..."
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger>
              <SelectValue placeholder="Team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {(teams.data ?? []).map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger>
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="idle">Idle</SelectItem>
              <SelectItem value="locked">Locked</SelectItem>
              <SelectItem value="sleeping">Sleeping</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Worked today</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Idle</TableHead>
              <TableHead>Last heartbeat</TableHead>
              <TableHead>Device</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((employee) => {
              const device = (devices.data ?? []).find(
                (item) => item.id === employee.currentDeviceId,
              );
              return (
                <TableRow key={employee.id}>
                  <TableCell>
                    <div className="font-medium">{employee.name}</div>
                    <div className="text-xs text-muted-foreground">{employee.email}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{employee.code}</TableCell>
                  <TableCell>{employee.department || "-"}</TableCell>
                  <TableCell>
                    <StatusBadge status={employee.status} />
                  </TableCell>
                  <TableCell>{formatMinutes(employee.workedTodayMinutes)}</TableCell>
                  <TableCell>{formatMinutes(employee.activeMinutes)}</TableCell>
                  <TableCell>{formatMinutes(employee.idleMinutes)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelative(employee.lastHeartbeat)}
                  </TableCell>
                  <TableCell className="text-sm">{device?.name ?? "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/employees/$employeeId" params={{ employeeId: employee.id }}>
                        View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                  No employees match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
