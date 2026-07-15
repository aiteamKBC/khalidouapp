import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { buildReport, fetchReportTotals } from "@/api/reports";
import { listTeams } from "@/api/teams";
import { listEmployees } from "@/api/employees";
import { listTimesheets } from "@/api/timesheets";
import { useAuth } from "@/lib/auth";
import { Clock, Camera, Activity, Coffee } from "lucide-react";
import { downloadCSV } from "@/lib/format";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [teamId, setTeamId] = useState("all");
  const [empId, setEmpId] = useState("all");
  const selectedScope = teamId !== "all" ? [teamId] : scope;
  const totals = useQuery({
    queryKey: ["report-totals", selectedScope],
    queryFn: () => fetchReportTotals(scope, teamId),
  });
  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });
  const emps = useQuery({ queryKey: ["employees", scope], queryFn: () => listEmployees(scope) });
  const timesheets = useQuery({
    queryKey: ["timesheets", "weekly", selectedScope],
    queryFn: () => listTimesheets(selectedScope, "weekly"),
  });
  const report = useMemo(
    () =>
      totals.data
        ? buildReport(
            totals.data,
            (teams.data ?? []).filter((team) => teamId === "all" || team.id === teamId),
            emps.data ?? [],
            timesheets.data ?? [],
            empId,
          )
        : undefined,
    [totals.data, teams.data, emps.data, timesheets.data, teamId, empId],
  );

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Reports"
        description="Aggregated productivity insights."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                report && downloadCSV("report-hours-by-employee.csv", report.byEmployee)
              }
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </>
        }
      />

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="From"
          />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" />
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
              setFrom("");
              setTo("");
              setTeamId("all");
              setEmpId("all");
            }}
          >
            Reset
          </Button>
        </div>
      </Card>

      {report && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            <StatCard
              label="Total hours"
              value={`${report.totalHours}h`}
              icon={Clock}
              tone="info"
            />
            <StatCard
              label="Active"
              value={`${report.activeVsIdle.active}h`}
              icon={Activity}
              tone="success"
            />
            <StatCard
              label="Idle"
              value={`${report.activeVsIdle.idle}h`}
              icon={Coffee}
              tone="warning"
            />
            <StatCard label="Screenshots" value={report.screenshots} icon={Camera} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Hours by team</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer>
                  <BarChart data={report.byTeam}>
                    <XAxis dataKey="team" stroke="var(--muted-foreground)" fontSize={12} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="hours" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Active vs idle</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Active", value: report.activeVsIdle.active },
                        { name: "Idle", value: report.activeVsIdle.idle },
                      ]}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={80}
                      innerRadius={50}
                    >
                      <Cell fill="var(--success)" />
                      <Cell fill="var(--warning)" />
                    </Pie>
                    <Legend />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Hours by employee</CardTitle>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer>
                  <BarChart data={report.byEmployee}>
                    <XAxis
                      dataKey="employee"
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={70}
                    />
                    <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="hours" fill="var(--info)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
