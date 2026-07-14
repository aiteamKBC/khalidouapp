import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Ban, Copy, KeyRound, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ProtectedImage } from "@/components/ProtectedImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { DatePicker } from "@/components/ui/date-picker";
import { WorkdayTimeline } from "@/components/workday-timeline";
import {
  createEnrollmentCode,
  createPortalAccessKey,
  getEmployee,
  listEnrollmentCodes,
  revokeEnrollmentCode,
  revokePortalAccessKey,
} from "@/api/employees";
import { getWorkdayTimeline, listSessions, listActivity } from "@/api/sessions";
import { listScreenshots } from "@/api/screenshots";
import { listTimesheets } from "@/api/timesheets";
import { listDevices } from "@/api/devices";
import { listTeams } from "@/api/teams";
import { resendPersonInvitation, type PersonInvitationSummary } from "@/api/people";
import { useAuth } from "@/lib/auth";
import { formatMinutes, formatRelative, formatDateTime } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/employees/$employeeId")({
  component: EmployeeDetailPage,
});

function EmployeeDetailPage() {
  const { employeeId } = Route.useParams();
  const { hasRole } = useAuth();
  const canManageEnrollment = hasRole("general_admin");
  const [activeTab, setActiveTab] = useState("profile");
  const [timelineDay, setTimelineDay] = useState(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  });
  const emp = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => getEmployee(employeeId),
  });
  const sessions = useQuery({
    queryKey: ["sessions", employeeId],
    queryFn: () => listSessions(employeeId),
    enabled: activeTab === "sessions",
  });
  const activity = useQuery({
    queryKey: ["activity", employeeId],
    queryFn: () => listActivity(employeeId),
    enabled: activeTab === "activity",
  });
  const timeline = useQuery({
    queryKey: ["workday-timeline", employeeId, timelineDay],
    queryFn: () => getWorkdayTimeline(employeeId, timelineDay),
    enabled: activeTab === "workday",
    refetchInterval: activeTab === "workday" ? 60_000 : false,
  });
  const shots = useQuery({
    queryKey: ["emp-shots", employeeId],
    queryFn: () => listScreenshots(),
    enabled: activeTab === "screenshots",
  });
  const ts = useQuery({
    queryKey: ["emp-ts", employeeId],
    queryFn: () => listTimesheets(),
    enabled: activeTab === "timesheets",
  });
  const devs = useQuery({
    queryKey: ["devices"],
    queryFn: () => listDevices(),
    enabled: activeTab === "profile" || activeTab === "devices",
  });
  const teams = useQuery({
    queryKey: ["teams"],
    queryFn: () => listTeams(),
    enabled: activeTab === "profile",
  });

  if (!emp.data) return <div className="text-sm text-muted-foreground">Loading...</div>;

  const e = emp.data;
  const device = (devs.data ?? []).find((item) => item.id === e.currentDeviceId);
  const empTeams = (teams.data ?? []).filter((team) => e.teamIds.includes(team.id));
  const empShots = (shots.data ?? []).filter((screenshot) => screenshot.employeeId === e.id);
  const empTs = (ts.data ?? []).filter((timesheet) => timesheet.employeeId === e.id);

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/employees">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Link>
      </Button>
      <PageHeader
        title={e.name}
        description={`${e.code} - ${e.department || "No department"}`}
        actions={
          <div className="flex items-center gap-2">
            {canManageEnrollment && (
              <Button variant="outline" size="sm" onClick={() => setActiveTab("access")}>
                <KeyRound className="mr-2 h-4 w-4" />
                Set up access
              </Button>
            )}
            <StatusBadge status={e.accountStatus === "invited" ? "invited" : e.status} />
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="workday">Workday</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
          <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          {canManageEnrollment && <TabsTrigger value="access">Access & devices</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row k="Name" v={e.name} />
                <Row k="Email" v={e.email} />
                <Row k="Employee code" v={e.code} />
                <Row k="Department" v={e.department || "-"} />
                <Row k="Teams" v={empTeams.map((team) => team.name).join(", ") || "-"} />
                <Row k="Portal access" v={e.portalAccessEnabled ? "Enabled" : "Not configured"} />
                <Row k="Portal last login" v={formatDateTime(e.portalLastLoginAt)} />
                <Row k="Portal login IP" v={e.portalLastLoginIp || "-"} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Current status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row
                  k="Status"
                  v={<StatusBadge status={e.accountStatus === "invited" ? "invited" : e.status} />}
                />
                <Row k="Session start" v={formatDateTime(e.sessionStart)} />
                <Row k="Worked today" v={formatMinutes(e.workedTodayMinutes)} />
                <Row k="Active" v={formatMinutes(e.activeMinutes)} />
                <Row k="Idle" v={formatMinutes(e.idleMinutes)} />
                <Row k="Last heartbeat" v={formatRelative(e.lastHeartbeat)} />
                <Row k="Last screenshot" v={formatRelative(e.lastScreenshotAt)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Current device</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {device ? (
                  <>
                    <Row k="Name" v={device.name} />
                    <Row k="OS" v={device.os} />
                    <Row k="Agent" v={device.agentVersion} />
                    <Row k="Status" v={<StatusBadge status={device.status} />} />
                  </>
                ) : (
                  <p className="text-muted-foreground">No device.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="workday">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle>Workday activity</CardTitle>
              <DatePicker
                value={timelineDay}
                onChange={(value) => value && setTimelineDay(value)}
                clearable={false}
                className="w-44"
              />
            </CardHeader>
            <CardContent>
              <WorkdayTimeline timeline={timeline.data} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border text-sm">
                {(sessions.data ?? []).map((session) => (
                  <div key={session.id} className="grid grid-cols-4 gap-2 px-4 py-3">
                    <div>{formatDateTime(session.startedAt)}</div>
                    <div className="text-muted-foreground">
                      {session.endedAt ? formatDateTime(session.endedAt) : "In progress"}
                    </div>
                    <div>Active {formatMinutes(session.activeMinutes)}</div>
                    <div className="text-right">{session.screenshotCount} screenshots</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="screenshots">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {empShots.slice(0, 12).map((screenshot) => (
              <ProtectedImage
                key={screenshot.id}
                src={screenshot.thumbnailUrl}
                alt=""
                className="aspect-video w-full rounded-md object-cover ring-1 ring-border"
              />
            ))}
            {empShots.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-full">No screenshots.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="timesheets">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border text-sm">
                {empTs.map((timesheet) => (
                  <div key={timesheet.id} className="grid grid-cols-4 gap-2 px-4 py-3">
                    <div>{timesheet.date}</div>
                    <div>{formatMinutes(timesheet.totalMinutes)}</div>
                    <div className="text-muted-foreground">
                      {formatMinutes(timesheet.idleMinutes)} idle
                    </div>
                    <div className="text-right">
                      <StatusBadge status={timesheet.status} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="devices">
          <Card>
            <CardContent className="p-4 text-sm">
              {device ? (
                <div>
                  {device.name} - {device.os} - {device.agentVersion}
                </div>
              ) : (
                <p className="text-muted-foreground">No device.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border text-sm">
                {(activity.data ?? []).map((event) => (
                  <div key={event.id} className="flex justify-between px-4 py-3">
                    <span className="capitalize">{event.type.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground">{formatRelative(event.at)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {canManageEnrollment && (
          <TabsContent value="access">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Employee access</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Employees normally choose their own password from the email invitation. Legacy
                    portal keys and single-use desktop enrollment codes remain available as backups.
                  </p>
                </CardHeader>
              </Card>
              {e.invitation && e.accountStatus === "invited" && (
                <InvitationAccessPanel
                  employeeId={employeeId}
                  email={e.email}
                  invitation={e.invitation}
                />
              )}
              <PortalAccessPanel
                employeeId={employeeId}
                email={e.email}
                enabled={e.portalAccessEnabled}
              />
              <EnrollmentCodesPanel employeeId={employeeId} />
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function InvitationAccessPanel({
  employeeId,
  email,
  invitation,
}: {
  employeeId: string;
  email: string;
  invitation: PersonInvitationSummary;
}) {
  const queryClient = useQueryClient();
  const resend = useMutation({
    mutationFn: () => resendPersonInvitation(invitation.id),
    onSuccess: async ({ emailQueued }) => {
      toast.success(
        emailQueued ? "Invitation sent again" : "Invitation renewed, but email was not queued",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employee", employeeId] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to resend invitation"),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Email invitation</CardTitle>
              <StatusBadge status={invitation.status === "expired" ? "expired" : "invited"} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {email} must accept the secure link and choose a password before signing in.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Link expires {formatDateTime(invitation.expiresAt)}.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {resend.isPending ? "Sending..." : "Resend invitation"}
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}

function PortalAccessPanel({
  employeeId,
  email,
  enabled,
}: {
  employeeId: string;
  email: string;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [accessKey, setAccessKey] = useState<string>();
  const createMutation = useMutation({
    mutationFn: () => createPortalAccessKey(employeeId),
    onSuccess: async (result) => {
      setAccessKey(result.accessKey);
      toast.success("Employee portal key created");
      await queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to create portal key"),
  });
  const revokeMutation = useMutation({
    mutationFn: () => revokePortalAccessKey(employeeId),
    onSuccess: async () => {
      setAccessKey(undefined);
      toast.success("Employee portal access revoked");
      await queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Legacy browser access key</CardTitle>
        <p className="text-sm text-muted-foreground">
          Backup for employees who cannot use their invitation password. The plain key is shown once
          and is not sent by email.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Row k="Login email" v={email} />
        <Row k="Current status" v={enabled ? "Enabled" : "Not configured"} />
        {accessKey && (
          <div className="rounded-md border border-success/30 bg-success/10 p-4">
            <div className="text-xs font-medium uppercase text-success">New access key</div>
            <div className="mt-1 break-all font-mono text-lg font-semibold">{accessKey}</div>
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(accessKey);
                toast.success("Access key copied");
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copy
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              if (
                enabled &&
                !window.confirm(
                  "Replace this employee portal key? The previous KHW- key will stop working immediately.",
                )
              ) {
                return;
              }
              createMutation.mutate();
            }}
            disabled={createMutation.isPending}
          >
            <KeyRound className="mr-2 h-4 w-4" />
            {enabled ? "Replace portal key" : "Create portal key"}
          </Button>
          {enabled && (
            <Button
              variant="outline"
              onClick={() => revokeMutation.mutate()}
              disabled={revokeMutation.isPending}
            >
              <Ban className="mr-2 h-4 w-4" /> Revoke access
            </Button>
          )}
        </div>
        {enabled && (
          <p className="text-xs text-muted-foreground">
            Replacing the portal key immediately invalidates the previous KHW- key.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function EnrollmentCodesPanel({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [generatedCode, setGeneratedCode] = useState<string | undefined>();
  const codes = useQuery({
    queryKey: ["employee-enrollment-codes", employeeId],
    queryFn: () => listEnrollmentCodes(employeeId),
  });

  const refreshCodes = async () => {
    await queryClient.invalidateQueries({ queryKey: ["employee-enrollment-codes", employeeId] });
  };

  const createMutation = useMutation({
    mutationFn: () => createEnrollmentCode(employeeId, expiresInDays),
    onSuccess: async (code) => {
      setGeneratedCode(code.code);
      toast.success("Enrollment code created");
      await refreshCodes();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to create enrollment code"),
  });

  const revokeMutation = useMutation({
    mutationFn: (codeId: string) => revokeEnrollmentCode(employeeId, codeId),
    onSuccess: async () => {
      toast.success("Enrollment code revoked");
      await refreshCodes();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to revoke enrollment code"),
  });

  async function copyCode(code?: string) {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    toast.success("Enrollment code copied");
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Device enrollment</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Create single-use codes for installing Khaliduo on employee devices. Codes are shown
            here only and are not sent by email.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="enrollment-expiry">Expires in days</Label>
            <Input
              id="enrollment-expiry"
              type="number"
              min={1}
              max={90}
              value={expiresInDays}
              onChange={(event) =>
                setExpiresInDays(Math.max(1, Math.min(90, Number(event.target.value) || 14)))
              }
              className="w-28"
            />
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            <KeyRound className="h-4 w-4 mr-2" />
            {createMutation.isPending ? "Generating..." : "Generate code"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {generatedCode && (
          <div className="flex flex-col gap-3 rounded-md border border-success/30 bg-success/10 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-medium uppercase text-success">New code</div>
              <div className="font-mono text-lg font-semibold tracking-normal">{generatedCode}</div>
              <div className="text-xs text-muted-foreground">
                It is stored securely and will not be shown again after refresh.
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => copyCode(generatedCode)}>
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(codes.data ?? []).map((code) => (
              <TableRow key={code.id}>
                <TableCell className="font-mono text-xs">{code.codeHint}</TableCell>
                <TableCell>
                  <StatusBadge status={code.status} />
                </TableCell>
                <TableCell>{formatDateTime(code.expiresAt)}</TableCell>
                <TableCell>{formatDateTime(code.usedAt)}</TableCell>
                <TableCell>{formatDateTime(code.createdAt)}</TableCell>
                <TableCell className="text-right">
                  {code.status === "active" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revokeMutation.isPending}
                      onClick={() => revokeMutation.mutate(code.id)}
                    >
                      <Ban className="h-4 w-4 mr-2" />
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(codes.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No enrollment codes yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
