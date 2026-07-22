import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CalendarCheck2, Clock3, Coffee, TimerReset } from "lucide-react";

import { getDailyAttendance, listDailyAttendance } from "@/api/attendance";
import { listTeams } from "@/api/teams";
import { WorkdayTimeline } from "@/components/workday-timeline";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/attendance")({ component: AttendancePage });

const today = () => new Date().toLocaleDateString("en-CA");
const duration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};
const clock = (value: string | null | undefined, timezone: string) =>
  value
    ? new Intl.DateTimeFormat([], {
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      }).format(new Date(value))
    : "—";

function AttendancePage() {
  const { scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const [day, setDay] = useState(today());
  const [teamId, setTeamId] = useState("all");
  const [status, setStatus] = useState("all");
  const [issue, setIssue] = useState<
    "all" | "late" | "missing_check_in" | "overtime" | "idle" | "leave"
  >("all");
  const [q, setQ] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });
  const attendance = useQuery({
    queryKey: ["daily-attendance", day, teamId, status, issue, q],
    queryFn: () => listDailyAttendance({ day, teamId, status, issue, q }),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
  const detail = useQuery({
    queryKey: ["daily-attendance-detail", selectedEmployeeId, day],
    queryFn: () => getDailyAttendance(selectedEmployeeId!, day),
    enabled: Boolean(selectedEmployeeId),
    refetchInterval: selectedEmployeeId ? 15_000 : false,
  });
  const rows = attendance.data ?? [];
  const summary = rows.reduce(
    (total, row) => ({
      present: total.present + (row.status === "present" ? 1 : 0),
      issues: total.issues + (row.issues.length ? 1 : 0),
      worked: total.worked + row.normalWorkedSeconds,
      overtime: total.overtime + row.recordedOvertimeSeconds,
    }),
    { present: 0, issues: 0, worked: 0, overtime: 0 },
  );

  return (
    <div className="studio-page">
      <PageHeader
        title="Daily Attendance"
        description="One auditable workday view for schedules, attendance, idle time, leave, and overtime."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={CalendarCheck2}
          label="Present"
          value={`${summary.present} / ${rows.length}`}
        />
        <Metric icon={AlertTriangle} label="Need review" value={summary.issues} tone="amber" />
        <Metric icon={Clock3} label="Normal worked" value={duration(summary.worked)} tone="green" />
        <Metric
          icon={TimerReset}
          label="Recorded overtime"
          value={duration(summary.overtime)}
          tone="violet"
        />
      </div>
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
          <Input
            placeholder="Search employee…"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger>
              <SelectValue />
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
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="present">Present</SelectItem>
              <SelectItem value="late">Late</SelectItem>
              <SelectItem value="left_early">Left early</SelectItem>
              <SelectItem value="not_started">Not started</SelectItem>
              <SelectItem value="absent">Absent</SelectItem>
              <SelectItem value="approved_leave">Approved leave</SelectItem>
            </SelectContent>
          </Select>
          <Select value={issue} onValueChange={(value) => setIssue(value as typeof issue)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All signals</SelectItem>
              <SelectItem value="late">Late employees</SelectItem>
              <SelectItem value="missing_check_in">Missing check-in</SelectItem>
              <SelectItem value="overtime">Recorded overtime</SelectItem>
              <SelectItem value="idle">Unexplained idle</SelectItem>
              <SelectItem value="leave">On leave</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              setTeamId("all");
              setStatus("all");
              setIssue("all");
              setQ("");
              setDay(today());
            }}
          >
            Reset filters
          </Button>
        </div>
      </Card>
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>First / last / sign-out</TableHead>
              <TableHead>Normal</TableHead>
              <TableHead>Paid break</TableHead>
              <TableHead>Idle</TableHead>
              <TableHead>Late</TableHead>
              <TableHead>Early leave</TableHead>
              <TableHead>Extra</TableHead>
              <TableHead>Manual</TableHead>
              <TableHead>Payable</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attendance.isLoading
              ? Array.from({ length: 6 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={12}>
                      <div className="h-10 animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedEmployeeId(row.employeeId)}
                  >
                    <TableCell>
                      <p className="font-bold">{row.employeeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.teamNames.join(", ") || row.jobTitle || "No team"}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs">
                      {clock(row.scheduledStartAt, row.timezone)} –{" "}
                      {clock(row.scheduledEndAt, row.timezone)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {clock(row.actualFirstActivityAt, row.timezone)} –{" "}
                      {clock(row.actualLastActivityAt, row.timezone)}
                      <span className="block text-[10px] text-muted-foreground">
                        Sign-out {clock(row.actualSignOutAt, row.timezone)}
                      </span>
                    </TableCell>
                    <TableCell>{duration(row.normalWorkedSeconds)}</TableCell>
                    <TableCell>{duration(row.paidBreakSeconds)}</TableCell>
                    <TableCell>{duration(row.idleSeconds)}</TableCell>
                    <TableCell>
                      {duration(row.rawLateSeconds)}
                      <span className="block text-[10px] text-muted-foreground">
                        {duration(row.deductibleLateSeconds)} deductible
                      </span>
                    </TableCell>
                    <TableCell>{duration(row.earlyLeaveSeconds)}</TableCell>
                    <TableCell>
                      {duration(row.recordedOvertimeSeconds)}
                      <span className="block text-[10px] text-muted-foreground">
                        {duration(row.approvedOvertimeSeconds)} approved
                      </span>
                    </TableCell>
                    <TableCell>
                      {duration(row.approvedManualSeconds)}
                      {row.pendingManualSeconds > 0 && (
                        <span className="block text-[10px] text-amber-700">
                          {duration(row.pendingManualSeconds)} pending
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-bold">{duration(row.totalPayableSeconds)}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                  </TableRow>
                ))}
            {!attendance.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="py-12 text-center text-muted-foreground">
                  No attendance rows match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <Dialog
        open={Boolean(selectedEmployeeId)}
        onOpenChange={(open) => !open && setSelectedEmployeeId(null)}
      >
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail.data?.employeeName ?? "Attendance detail"} · {day}
            </DialogTitle>
          </DialogHeader>
          {detail.data ? (
            <>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Small
                  label="Started"
                  value={clock(detail.data.actualFirstActivityAt, detail.data.timezone)}
                />
                <Small
                  label="Last activity"
                  value={clock(detail.data.actualLastActivityAt, detail.data.timezone)}
                />
                <Small
                  label="Signed out"
                  value={clock(detail.data.actualSignOutAt, detail.data.timezone)}
                />
                <Small label="Paid breaks" value={duration(detail.data.paidBreakSeconds)} />
                <Small label="Unpaid breaks" value={duration(detail.data.unpaidBreakSeconds)} />
                <Small
                  label="Manual approved"
                  value={duration(detail.data.approvedManualSeconds)}
                />
                <Small label="Before shift" value={duration(detail.data.preShiftExtraSeconds)} />
                <Small label="After shift" value={duration(detail.data.postShiftExtraSeconds)} />
                <Small label="Payable" value={duration(detail.data.totalPayableSeconds)} />
              </div>
              <WorkdayTimeline timeline={detail.data.timeline} />
            </>
          ) : (
            <div className="h-48 animate-pulse rounded bg-muted" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "blue",
}: {
  icon: typeof Clock3;
  label: string;
  value: string | number;
  tone?: "blue" | "green" | "amber" | "violet";
}) {
  const colors = {
    blue: "bg-blue-500/10 text-blue-600",
    green: "bg-emerald-500/10 text-emerald-600",
    amber: "bg-amber-500/10 text-amber-700",
    violet: "bg-violet-500/10 text-violet-600",
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`grid h-10 w-10 place-items-center rounded-lg ${colors[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-2xl font-extrabold">{value}</p>
        <p className="text-xs font-bold text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}
function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono font-bold">{value}</p>
    </div>
  );
}
