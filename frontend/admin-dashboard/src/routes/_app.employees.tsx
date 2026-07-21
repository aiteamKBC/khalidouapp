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
import { permissions } from "@/lib/permissions";
import { listEmployees } from "@/api/employees";
import { listTeams } from "@/api/teams";
import { formatMinutes, formatRelative } from "@/lib/format";

export const Route = createFileRoute("/_app/employees")({
  component: EmployeesPage,
});

function EmployeesPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname !== "/employees" ? (
    <Outlet />
  ) : (
    <Navigate to="/people" search={{ tab: "live" }} replace />
  );
}

export function EmployeesList({ embedded = false }: { embedded?: boolean }) {
  const { scopedTeamIds, can } = useAuth();
  const canManagePeople = can(permissions.peopleManage);
  const scope = scopedTeamIds();
  const emps = useQuery({
    queryKey: ["employees", scope],
    queryFn: () => listEmployees(scope),
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });
  const teams = useQuery({
    queryKey: ["teams", scope],
    queryFn: () => listTeams(scope),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });

  const [q, setQ] = useState("");
  const [teamId, setTeamId] = useState("all");
  const [jobTitle, setJobTitle] = useState("all");
  const [status, setStatus] = useState("all");

  const jobTitles = useMemo(
    () =>
      Array.from(new Set((emps.data ?? []).map((employee) => employee.jobTitle).filter(Boolean))),
    [emps.data],
  );

  const rows = useMemo(
    () =>
      (emps.data ?? []).filter((employee) => {
        const needle = q.trim().toLowerCase();
        if (
          needle &&
          !`${employee.name} ${employee.email} ${employee.code}`
            .toLowerCase()
            .includes(needle)
        )
          return false;
        if (teamId !== "all" && !employee.teamIds.includes(teamId)) return false;
        if (jobTitle !== "all" && employee.jobTitle !== jobTitle) return false;
        const displayStatus = employee.accountStatus === "invited" ? "invited" : employee.status;
        if (status !== "all" && displayStatus !== status) return false;
        return true;
      }),
    [emps.data, q, teamId, jobTitle, status],
  );

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="Employees"
          description="Monitor employee activity. Add or manage people from the People page."
          actions={
            canManagePeople && (
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
          <Select value={jobTitle} onValueChange={setJobTitle}>
            <SelectTrigger>
              <SelectValue placeholder="Job title" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All job titles</SelectItem>
              {jobTitles.map((value) => (
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
              <SelectItem value="invited">Invited</SelectItem>
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
              <TableHead>Job title</TableHead>
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
            {rows.map((employee) => (
              <TableRow key={employee.id}>
                  <TableCell>
                    <div className="font-medium">{employee.name}</div>
                    <div className="text-xs text-muted-foreground">{employee.email}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{employee.code}</TableCell>
                  <TableCell>{employee.jobTitle || "-"}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status={employee.accountStatus === "invited" ? "invited" : employee.status}
                    />
                  </TableCell>
                  <TableCell>{formatMinutes(employee.workedTodayMinutes)}</TableCell>
                  <TableCell>{formatMinutes(employee.activeMinutes)}</TableCell>
                  <TableCell>{formatMinutes(employee.idleMinutes)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelative(employee.lastHeartbeat)}
                  </TableCell>
                  <TableCell className="text-sm">{employee.currentDeviceName ?? "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/employees/$employeeId" params={{ employeeId: employee.id }}>
                        View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
            ))}
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
