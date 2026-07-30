import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getDevice } from "@/api/devices";
import { listEmployees } from "@/api/employees";
import { formatDate, formatRelative } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { retryTransientRequest } from "@/api/client";

export const Route = createFileRoute("/_app/devices/$deviceId")({
  component: DeviceDetailPage,
});

function DeviceDetailPage() {
  const { deviceId } = Route.useParams();
  const scope = useAuth().scopedTeamIds();
  const device = useQuery({
    queryKey: ["device", scope, deviceId],
    queryFn: ({ signal }) => getDevice(deviceId, signal),
    retry: retryTransientRequest,
  });
  const employees = useQuery({
    queryKey: ["employees", scope],
    queryFn: ({ signal }) => listEmployees(scope, signal),
    staleTime: 30_000,
    retry: retryTransientRequest,
  });

  if (!device.data) return <div className="text-sm text-muted-foreground">Loading device...</div>;
  const employee = (employees.data ?? []).find((item) => item.id === device.data!.employeeId);

  return (
    <div>
      <BackButton fallbackHref="/devices" variant="ghost" size="sm" className="mb-2 -ml-2" />
      <PageHeader
        title={device.data.name}
        description={employee ? `Assigned to ${employee.name}` : undefined}
        actions={<StatusBadge status={device.data.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Device information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <Row k="Operating system" v={device.data.os} />
          <Row k="Agent version" v={`v${device.data.agentVersion}`} />
          <Row k="Registered" v={formatDate(device.data.registeredAt)} />
          <Row k="Last seen" v={formatRelative(device.data.lastSeen)} />
          <Row k="Windows user" v={device.data.windowsUsername ?? "-"} />
          <Row k="Last IP address" v={device.data.lastIpAddress ?? "-"} />
          <Row k="MAC address" v={device.data.macAddress ?? "-"} />
          <Row
            k="Token"
            v={<StatusBadge status={device.data.tokenStatus === "valid" ? "active" : "revoked"} />}
          />
          <Row k="Status" v={<StatusBadge status={device.data.status} />} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
