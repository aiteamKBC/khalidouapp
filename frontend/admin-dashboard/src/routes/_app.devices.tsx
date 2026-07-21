import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listDevices, revokeDevice } from "@/api/devices";
import { listEmployees } from "@/api/employees";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { formatRelative, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Laptop, ShieldCheck, WifiOff } from "lucide-react";
import { MetricTile } from "@/components/ui/metric-tile";

export const Route = createFileRoute("/_app/devices")({
  component: DevicesPage,
});

function DevicesPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname !== "/devices" ? <Outlet /> : <DevicesList />;
}

function DevicesList() {
  const { scopedTeamIds, can } = useAuth();
  const canManageDevices = can(permissions.devicesManage);
  const scope = scopedTeamIds();
  const queryClient = useQueryClient();
  const devs = useQuery({ queryKey: ["devices", scope], queryFn: () => listDevices(scope) });
  const emps = useQuery({ queryKey: ["employees", scope], queryFn: () => listEmployees(scope) });
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeDevice(id),
    onSuccess: async () => {
      toast.success("Device revoked");
      setRevokeId(null);
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to revoke device"),
  });

  return (
    <div className="studio-page">
      <PageHeader title="Devices" description="Managed devices reporting to Khaliduo." />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MetricTile
          icon={Laptop}
          value={(devs.data ?? []).length}
          label="Registered devices"
          hint="Managed endpoints"
          tone="blue"
        />
        <MetricTile
          icon={ShieldCheck}
          value={
            (devs.data ?? []).filter(
              (device) => device.status !== "offline" && device.tokenStatus === "valid",
            ).length
          }
          label="Healthy devices"
          hint="Online with valid tokens"
          tone="green"
        />
        <MetricTile
          icon={WifiOff}
          value={(devs.data ?? []).filter((device) => device.status === "offline").length}
          label="Devices offline"
          hint="May need attention"
          tone="amber"
        />
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>OS</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(devs.data ?? []).map((device) => {
              const emp = (emps.data ?? []).find((employee) => employee.id === device.employeeId);
              return (
                <TableRow key={device.id}>
                  <TableCell className="font-medium">{device.name}</TableCell>
                  <TableCell>{emp?.name ?? "-"}</TableCell>
                  <TableCell className="text-sm">{device.os}</TableCell>
                  <TableCell className="font-mono text-xs">v{device.agentVersion}</TableCell>
                  <TableCell>
                    <StatusBadge status={device.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelative(device.lastSeen)}
                  </TableCell>
                  <TableCell className="text-sm">{formatDate(device.registeredAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={device.tokenStatus === "valid" ? "active" : "revoked"} />
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/devices/$deviceId" params={{ deviceId: device.id }}>
                        View
                      </Link>
                    </Button>
                    {canManageDevices && device.tokenStatus === "valid" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokeId(device.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={revokeId !== null} onOpenChange={(open) => !open && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke device?</AlertDialogTitle>
            <AlertDialogDescription>
              This will invalidate the device's token and force re-registration. The action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revokeMutation.isPending}
              onClick={() => revokeId && revokeMutation.mutate(revokeId)}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
