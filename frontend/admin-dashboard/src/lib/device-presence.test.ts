import assert from "node:assert/strict";
import test from "node:test";

import { findOtherOnlineDeviceForEmployee } from "./device-presence.ts";

type TestDevice = Parameters<typeof findOtherOnlineDeviceForEmployee>[0][number];

function device(id: string, employeeId: string, status: TestDevice["status"]): TestDevice {
  return {
    id,
    employeeId,
    name: id,
    os: "Windows",
    agentVersion: "1.1.93",
    status,
    registeredAt: "2026-08-01T00:00:00Z",
    tokenStatus: "valid",
  };
}

test("an offline registration exposes another online device for the same employee", () => {
  const oldDevice = device("old-device", "employee-a", "offline");
  const currentDevice = device("current-device", "employee-a", "online");

  assert.equal(
    findOtherOnlineDeviceForEmployee([oldDevice, currentDevice], oldDevice)?.id,
    "current-device",
  );
});

test("a device owned by another employee never explains the employee's presence", () => {
  const oldDevice = device("old-device", "employee-a", "offline");
  const unrelatedDevice = device("unrelated-device", "employee-b", "online");

  assert.equal(
    findOtherOnlineDeviceForEmployee([oldDevice, unrelatedDevice], oldDevice),
    undefined,
  );
});
