import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { listTimesheets } from "@/api/timesheets";
import { listEmployees } from "@/api/employees";
import { listTeams } from "@/api/teams";
import { useAuth } from "@/lib/auth";
import { formatMinutes, downloadCSV } from "@/lib/format";

export const Route = createFileRoute("/_app/timesheets")({
  component: TimesheetsPage,
});

function TimesheetsPage() {
  const { scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const emps = useQuery({ queryKey: ["employees", scope], queryFn: () => listEmployees(scope) });
  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });

  const [view, setView] = useState<"daily" | "weekly" | "monthly">("daily");
  const [date, setDate] = useState("");
  const [teamId, setTeamId] = useState("all");
  const [empId, setEmpId] = useState("all");
  const [page, setPage] = useState(0);
  const perPage = 15;
  const ts = useQuery({
    queryKey: ["ts", scope, view],
    queryFn: () => listTimesheets(scope, view),
  });

  const filtered = useMemo(
    () =>
      (ts.data ?? []).filter((t) => {
        if (date && t.date !== date) return false;
        if (teamId !== "all" && t.teamId !== teamId) return false;
        if (empId !== "all" && t.employeeId !== empId) return false;
        return true;
      }),
    [ts.data, date, teamId, empId],
  );

  const paged = filtered.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));

  const empName = (id: string) => (emps.data ?? []).find((e) => e.id === id)?.name ?? id;
  const teamName = (id: string) => (teams.data ?? []).find((t) => t.id === id)?.name ?? id;

  return (
    <div>
      <PageHeader
        title="Timesheets"
        description="Daily and weekly time-tracked records per employee."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              downloadCSV(
                "timesheets.csv",
                filtered.map((t) => ({
                  date: t.date,
                  employee: empName(t.employeeId),
                  team: teamName(t.teamId),
                  total_minutes: t.totalMinutes,
                  active_minutes: t.activeMinutes,
                  idle_minutes: t.idleMinutes,
                  manual_adjustment_minutes: t.adjustmentMinutes,
                  deleted_screenshot_minutes: t.deductedMinutes,
                  points: t.points,
                  screenshots: t.screenshotCount,
                  status: t.status,
                })),
              )
            }
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        }
      />

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tabs value={view} onValueChange={(v) => setView(v as "daily" | "weekly" | "monthly")}>
            <TabsList>
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="weekly">Weekly</TabsTrigger>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger>
              <SelectValue placeholder="Team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {(teams.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={empId} onValueChange={setEmpId}>
            <SelectTrigger>
              <SelectValue placeholder="Employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {(emps.data ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              setDate("");
              setTeamId("all");
              setEmpId("all");
              setPage(0);
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
              <TableHead>Date</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Idle</TableHead>
              <TableHead>Manual</TableHead>
              <TableHead>Deleted time</TableHead>
              <TableHead>Points</TableHead>
              <TableHead>Screenshots</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.date}</TableCell>
                <TableCell>{empName(t.employeeId)}</TableCell>
                <TableCell>{teamName(t.teamId)}</TableCell>
                <TableCell>{t.startTime ?? "—"}</TableCell>
                <TableCell>{t.endTime ?? "—"}</TableCell>
                <TableCell>{formatMinutes(t.totalMinutes)}</TableCell>
                <TableCell>{formatMinutes(t.activeMinutes)}</TableCell>
                <TableCell>{formatMinutes(t.idleMinutes)}</TableCell>
                <TableCell>{formatMinutes(t.adjustmentMinutes)}</TableCell>
                <TableCell>{formatMinutes(t.deductedMinutes)}</TableCell>
                <TableCell>{t.points.toFixed(2)}</TableCell>
                <TableCell>{t.screenshotCount}</TableCell>
                <TableCell>
                  <StatusBadge status={t.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Page {page + 1} of {totalPages} · {filtered.length} rows
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
