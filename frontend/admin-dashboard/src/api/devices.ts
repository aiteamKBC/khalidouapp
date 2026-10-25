import { apiFetch, withQuery } from "./client";
import type { Device, DeviceStatus } from "@/types";

type BackendDevice = {
  id: string;
  employee_id: string;
  device_name: string;
  operating_system: string;
  agent_version: string;
  update_required?: boolean;
  status: string;
  last_seen_at?: string | null;
  registered_at: string;
  revoked_at?: string | null;
  windows_username?: string | null;
  last_ip_address?: string | null;
  mac_address?: string | null;
};

function mapDevice(device: BackendDevice): Device {
  const lastSeen = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
  const online = lastSeen > 0 && Date.now() - lastSeen < 3 * 60_000;
  const status: DeviceStatus =
    device.status === "revoked" || device.revoked_at ? "revoked" : online ? "online" : "offline";
  return {
    id: device.id,
    name: device.device_name,
    employeeId: device.employee_id,
    os: device.operating_system,
    agentVersion: device.agent_version,
    updateRequired: device.update_required ?? false,
    status,
    lastSeen: device.last_seen_at ?? undefined,
    registeredAt: device.registered_at,
    tokenStatus: status === "revoked" ? "revoked" : "valid",
    windowsUsername: device.windows_username ?? undefined,
    lastIpAddress: device.last_ip_address ?? undefined,
    macAddress: device.mac_address ?? undefined,
  };
}

export async function listDevices(
  scopedTeamIds?: string[],
  signal?: AbortSignal,
): Promise<Device[]> {
  if (scopedTeamIds?.length === 1) {
    const devices = await apiFetch<BackendDevice[]>(
      withQuery("/devices", { page_size: 100, team_id: scopedTeamIds[0] }),
      { signal },
    );
    return devices.map(mapDevice);
  }
  const devices = await apiFetch<BackendDevice[]>(withQuery("/devices", { page_size: 100 }), {
    signal,
  });
  return devices.map(mapDevice);
}

export async function getDevice(id: string, signal?: AbortSignal): Promise<Device | undefined> {
  return mapDevice(await apiFetch<BackendDevice>(`/devices/${id}`, { signal }));
}

export async function revokeDevice(id: string): Promise<void> {
  await apiFetch(`/devices/${id}/revoke`, { method: "POST" });
}

export async function reactivateDevice(id: string): Promise<Device> {
  return mapDevice(await apiFetch<BackendDevice>(`/devices/${id}/reactivate`, { method: "POST" }));
}

export type DeviceSignInAttempt = {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceStatus: string;
  employeeId: string;
  employeeName: string | null;
  ownerEmployeeId: string;
  ownerEmployeeName: string | null;
  currentOwnerEmployeeId: string;
  firstAttemptedAt: string;
  lastAttemptedAt: string;
  attemptCount: number;
  ipAddress: string | null;
  windowsUsername: string | null;
};

type BackendSignInAttempt = {
  id: string;
  device_id: string;
  device_name: string;
  device_status: string;
  employee_id: string;
  employee_name: string | null;
  owner_employee_id: string;
  owner_employee_name: string | null;
  current_owner_employee_id: string;
  first_attempted_at: string;
  last_attempted_at: string;
  attempt_count: number;
  ip_address: string | null;
  windows_username: string | null;
};

/** Open attempts to sign in on a computer registered to another employee. */
export async function listSignInAttempts(signal?: AbortSignal): Promise<DeviceSignInAttempt[]> {
  const attempts = await apiFetch<BackendSignInAttempt[]>("/devices/sign-in-attempts", {
    signal,
  });
  return attempts.map((attempt) => ({
    id: attempt.id,
    deviceId: attempt.device_id,
    deviceName: attempt.device_name,
    deviceStatus: attempt.device_status,
    employeeId: attempt.employee_id,
    employeeName: attempt.employee_name,
    ownerEmployeeId: attempt.owner_employee_id,
    ownerEmployeeName: attempt.owner_employee_name,
    currentOwnerEmployeeId: attempt.current_owner_employee_id,
    firstAttemptedAt: attempt.first_attempted_at,
    lastAttemptedAt: attempt.last_attempted_at,
    attemptCount: attempt.attempt_count,
    ipAddress: attempt.ip_address,
    windowsUsername: attempt.windows_username,
  }));
}

export async function dismissSignInAttempt(id: string): Promise<void> {
  await apiFetch(`/devices/sign-in-attempts/${id}/dismiss`, { method: "POST" });
}

export async function reassignDevice(id: string, employeeId: string): Promise<Device> {
  return mapDevice(
    await apiFetch<BackendDevice>(`/devices/${id}/reassign`, {
      method: "POST",
      body: JSON.stringify({ employee_id: employeeId }),
    }),
  );
}
