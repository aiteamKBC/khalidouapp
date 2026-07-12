import { apiFetch, withQuery } from "./client";
import type { Device, DeviceStatus } from "@/types";

type BackendDevice = {
  id: string;
  employee_id: string;
  device_name: string;
  operating_system: string;
  agent_version: string;
  status: string;
  last_seen_at?: string | null;
  registered_at: string;
  revoked_at?: string | null;
  windows_username?: string | null;
  last_ip_address?: string | null;
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
    status,
    lastSeen: device.last_seen_at ?? undefined,
    registeredAt: device.registered_at,
    tokenStatus: status === "revoked" ? "revoked" : "valid",
    windowsUsername: device.windows_username ?? undefined,
    lastIpAddress: device.last_ip_address ?? undefined,
  };
}

export async function listDevices(scopedTeamIds?: string[]): Promise<Device[]> {
  if (scopedTeamIds?.length === 1) {
    const devices = await apiFetch<BackendDevice[]>(
      withQuery("/devices", { page_size: 100, team_id: scopedTeamIds[0] }),
    );
    return devices.map(mapDevice);
  }
  const devices = await apiFetch<BackendDevice[]>(withQuery("/devices", { page_size: 100 }));
  return devices.map(mapDevice);
}

export async function getDevice(id: string): Promise<Device | undefined> {
  return mapDevice(await apiFetch<BackendDevice>(`/devices/${id}`));
}

export async function revokeDevice(id: string): Promise<void> {
  await apiFetch(`/devices/${id}/revoke`, { method: "POST" });
}
