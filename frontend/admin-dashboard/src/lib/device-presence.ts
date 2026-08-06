import type { Device } from "@/types";

export function findOtherOnlineDeviceForEmployee(
  devices: readonly Device[],
  currentDevice: Pick<Device, "id" | "employeeId">,
): Device | undefined {
  return devices.find(
    (device) =>
      device.id !== currentDevice.id &&
      device.employeeId === currentDevice.employeeId &&
      device.status === "online",
  );
}
