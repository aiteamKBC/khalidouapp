import { AdminPagination } from "@/components/admin/pagination";
import { useAdminPagination } from "@/components/admin/useAdminPagination";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Card } from "@/components/admin/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/table";
import { Button } from "@/components/admin/button";
import { StatusBadge } from "@/components/admin/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/admin/alert-dialog";
import {
  dismissSignInAttempt,
  listDevices,
  listSignInAttempts,
  reactivateDevice,
  reassignDevice,
  revokeDevice,
} from "@/api/devices";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/admin/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/admin/select";
import { listEmployees } from "@/api/employees";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { formatRelative, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Laptop, ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import { MetricTile } from "@/components/admin/MetricTile";
import { findOtherOnlineDeviceForEmployee } from "@/lib/device-presence";

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
  const devs = useQuery({
    queryKey: ["devices", scope],
    queryFn: ({ signal }) => listDevices(scope, signal),
  });
  const emps = useQuery({
    queryKey: ["employees", scope],
    queryFn: ({ signal }) => listEmployees(scope, signal),
  });
  const attempts = useQuery({
    queryKey: ["device-sign-in-attempts"],
    queryFn: ({ signal }) => listSignInAttempts(signal),
    enabled: canManageDevices,
  });
  // The computer being reassigned, and who it goes to. `employeeId` is preset
  // when the dialog is opened from a sign-in attempt.
  const [reassign, setReassign] = useState<{
    deviceId: string;
    deviceName: string;
    ownerId: string;
    employeeId: string;
  } | null>(null);
  const reassignMutation = useMutation({
    mutationFn: ({ deviceId, employeeId }: { deviceId: string; employeeId: string }) =>
      reassignDevice(deviceId, employeeId),
    onSuccess: async () => {
      toast.success("Device reassigned. The new employee can sign in on it now.");
      setReassign(null);
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      await queryClient.invalidateQueries({ queryKey: ["device-sign-in-attempts"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to reassign device"),
  });
  const dismissMutation = useMutation({
    mutationFn: (id: string) => dismissSignInAttempt(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["device-sign-in-attempts"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to dismiss the attempt"),
  });
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [reactivateId, setReactivateId] = useState<string | null>(null);
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
  const reactivateMutation = useMutation({
    mutationFn: (id: string) => reactivateDevice(id),
    onSuccess: async () => {
      toast.success("Device reactivated. The employee can sign in again.");
      setReactivateId(null);
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to reactivate device"),
  });

  const devicePage = useAdminPagination(devs.data ?? []);

  return (
    <div className="studio-page">
      <PageHeader title="Devices" description="Managed devices reporting to Khaliduo." />

      <div className="admin-metrics mb-4 grid gap-3 sm:grid-cols-3">
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

      {canManageDevices && (attempts.data ?? []).length > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning-foreground" />
            <h2 className="text-sm font-extrabold">
              Sign-in attempts on another employee&apos;s computer
            </h2>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Khaliduo refused these sign-ins. Reassign the computer if it now belongs to the person
            who tried, or dismiss the attempt.
          </p>
          <div className="space-y-2">
            {(attempts.data ?? []).map((attempt) => (
              <div
                key={attempt.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3"
              >
                <div className="min-w-0 flex-1 text-sm">
                  <div>
                    <span className="font-bold">{attempt.employeeName ?? "An employee"}</span> tried
                    to sign in on{" "}
                    <span className="font-bold">
                      {attempt.ownerEmployeeName ?? "another employee"}
                    </span>
                    &apos;s computer <span className="font-bold">{attempt.deviceName}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {attempt.attemptCount === 1 ? "Once" : `${attempt.attemptCount} times`} · last{" "}
                    {formatRelative(attempt.lastAttemptedAt)}
                    {attempt.ipAddress ? ` · IP ${attempt.ipAddress}` : ""}
                    {attempt.windowsUsername ? ` · Windows user ${attempt.windowsUsername}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    setReassign({
                      deviceId: attempt.deviceId,
                      deviceName: attempt.deviceName,
                      ownerId: attempt.currentOwnerEmployeeId,
                      employeeId: attempt.employeeId,
                    })
                  }
                >
                  Reassign to {attempt.employeeName ?? "this employee"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={dismissMutation.isPending}
                  onClick={() => dismissMutation.mutate(attempt.id)}
                >
                  Dismiss
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>OS</TableHead>
              <TableHead>IP address</TableHead>
              <TableHead>MAC address</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devicePage.items.map((device) => {
              const emp = (emps.data ?? []).find((employee) => employee.id === device.employeeId);
              const otherOnlineDevice = findOtherOnlineDeviceForEmployee(devs.data ?? [], device);
              return (
                <TableRow key={device.id}>
                  <TableCell className="font-medium">{device.name}</TableCell>
                  <TableCell>
                    <div>{emp?.name ?? "-"}</div>
                    {device.status === "offline" && otherOnlineDevice && (
                      <div className="mt-0.5 text-xs font-semibold text-success">
                        Online on {otherOnlineDevice.name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{device.os}</TableCell>
                  <TableCell className="font-mono text-xs">{device.lastIpAddress ?? "-"}</TableCell>
                  <TableCell className="font-mono text-xs">{device.macAddress ?? "-"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    v{device.agentVersion}
                    {device.updateRequired && device.status !== "revoked" && (
                      <div
                        className="mt-1 w-fit rounded px-1.5 py-0.5 font-sans text-xs font-semibold bg-warning/15 text-warning-foreground"
                        title="Older than the published Khaliduo release. If this stays after the device has been online for an hour, reinstall Khaliduo on it."
                      >
                        Outdated
                      </div>
                    )}
                  </TableCell>
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
                    {canManageDevices && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setReassign({
                            deviceId: device.id,
                            deviceName: device.name,
                            ownerId: device.employeeId,
                            employeeId: "",
                          })
                        }
                      >
                        Reassign
                      </Button>
                    )}
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
                    {canManageDevices && device.tokenStatus === "revoked" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReactivateId(device.id)}
                      >
                        Reactivate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <AdminPagination {...devicePage} label="Devices" />
      </Card>

      <Dialog open={reassign !== null} onOpenChange={(open) => !open && setReassign(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign {reassign?.deviceName}</DialogTitle>
            <DialogDescription>
              {(emps.data ?? []).find((employee) => employee.id === reassign?.ownerId)?.name ??
                "The current owner"}{" "}
              is signed out of this computer and any running session on it ends. The new employee
              then signs in on it. Work already recorded stays with the current owner.
            </DialogDescription>
          </DialogHeader>
          <Select
            value={reassign?.employeeId ?? ""}
            onValueChange={(employeeId) =>
              setReassign((current) => (current ? { ...current, employeeId } : current))
            }
          >
            <SelectTrigger aria-label="New owner">
              <SelectValue placeholder="Choose the employee" />
            </SelectTrigger>
            <SelectContent>
              {(emps.data ?? [])
                .filter(
                  (employee) =>
                    employee.accountStatus === "active" && employee.id !== reassign?.ownerId,
                )
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassign(null)}>
              Cancel
            </Button>
            <Button
              disabled={!reassign?.employeeId || reassignMutation.isPending}
              onClick={() =>
                reassign?.employeeId &&
                reassignMutation.mutate({
                  deviceId: reassign.deviceId,
                  employeeId: reassign.employeeId,
                })
              }
            >
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeId !== null} onOpenChange={(open) => !open && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke device?</AlertDialogTitle>
            <AlertDialogDescription>
              The employee is signed out of this computer and Khaliduo stops tracking on it. You can
              reactivate it later; the employee then has to sign in again.
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

      <AlertDialog
        open={reactivateId !== null}
        onOpenChange={(open) => !open && setReactivateId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate device?</AlertDialogTitle>
            <AlertDialogDescription>
              This allows the same Khaliduo installation to sign in and register again. Previously
              revoked device tokens remain invalid.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reactivateMutation.isPending}
              onClick={() => reactivateId && reactivateMutation.mutate(reactivateId)}
            >
              Reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
