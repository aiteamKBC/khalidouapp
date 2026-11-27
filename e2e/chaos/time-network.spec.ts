import { expect, test } from "@playwright/test";
import { asAdmin, poll, seed } from "../fixtures/api.ts";
import { launchDesktop, newDesktopProfile, setNetwork, signIn, swal, type Desktop } from "../fixtures/desktop.ts";
import { clearToxics, toxic } from "../fixtures/toxiproxy.ts";

let desktop: Desktop;
test.beforeAll(async () => {
  desktop = await launchDesktop(newDesktopProfile("network-chaos"));
  await signIn(desktop.window, seed().employees.other.email, seed().employeePassword);
  await poll("enrolled", () => desktop.status(), s => s.enrolled === true);
  await swal(desktop.window).click("Start work");
  await poll("active", () => desktop.status(), s => s.trackingStatus === "active");
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && desktop) {
    const trace = info.outputPath("electron-trace.zip");
    await desktop.saveTrace(trace);
    await info.attach("electron trace", { path: trace, contentType: "application/zip" });
    await info.attach("electron console", { body: desktop.consoleLog.join("\n"), contentType: "text/plain" });
  }
  await clearToxics();
  await setNetwork({ kind: "online" });
});
test.afterAll(() => desktop?.kill());

test("delayed and bandwidth-limited replies cannot accelerate work", async () => {
  await toxic("slow-server", "latency", { latency: 700, jitter: 100 });
  await toxic("limited-bandwidth", "bandwidth", { rate: 64 });
  const before = await desktop.status();
  const started = performance.now();
  await desktop.syncNow();
  const after = await desktop.status();
  const realSeconds = Math.ceil((performance.now() - started) / 1000);
  expect(after.activeSeconds - before.activeSeconds).toBeLessThanOrEqual(realSeconds + 2);
  expect(after.workedTodaySeconds).toBeGreaterThanOrEqual(before.workedTodaySeconds);
  expect(desktop.pageErrors).toEqual([]);
});

test("losing a reply after server commit cannot duplicate a pause", async () => {
  const admin = await asAdmin("super");
  const response = await admin.get<any>(`/employees/${seed().employees.other.id}/sessions`);
  const session = (Array.isArray(response) ? response : response.items).find((s: any) => !s.ended_at);
  const events = async () => {
    const value = await admin.get<any>(`/sessions/${session.id}/events`);
    return Array.isArray(value) ? value : value.items ?? value.events;
  };
  const count = (rows: any[]) => rows.filter(e => e.event_type === "manual_pause_started").length;
  const beforeRows = await events();
  const before = count(beforeRows);
  const endsBefore = beforeRows.filter(e => e.event_type === "manual_pause_ended").length;
  await setNetwork({ kind: "drop_response", pathPrefix: `/api/v1/agent/sessions/${session.id}/events`, remaining: 1 });
  await desktop.window.getByRole("button", { name: "Pause", exact: true }).click();
  await poll("pause committed despite lost reply", events, rows => count(rows) === before + 1);
  await setNetwork({ kind: "online" });
  await desktop.syncNow();
  expect(count(await events())).toBe(before + 1);
  await desktop.window.getByRole("button", { name: "Resume", exact: true }).click();
  await poll("resumed", () => desktop.status(), s => s.trackingPaused === false);
  // Resume updates the UI immediately and delivers in the background. Wait for
  // that delivery before the next scenario snapshots its baseline and resets
  // TCP; otherwise its delta also includes this previous test's resume.
  await poll("resume committed once after the lost reply", events, rows =>
    rows.filter(e => e.event_type === "manual_pause_ended").length === endsBefore + 1,
    { timeoutMs: 60_000 },
  );
});

test("connection resets during pause/resume replay once in order after recovery", async () => {
  const admin = await asAdmin("super");
  const employee = seed().employees.other;
  const current = await admin.get<any>(`/employees/${employee.id}/sessions`);
  const session = (Array.isArray(current) ? current : current.items).find((s: any) => !s.ended_at);
  const events = () => admin.get<any[]>(`/sessions/${session.id}/events`);
  const count = (rows: any[], kind: string) => rows.filter(e => e.event_type === kind).length;
  const before = await events();
  await toxic("reset-connection", "reset_peer", { timeout: 0 });
  await desktop.window.getByRole("button", { name: "Pause", exact: true }).click();
  await poll("paused locally during outage", () => desktop.status(), s => s.trackingPaused === true);
  await desktop.window.getByRole("button", { name: "Resume", exact: true }).click();
  await poll("resumed locally during outage", () => desktop.status(), s => s.trackingPaused === false);
  await clearToxics();
  await desktop.syncNow();
  const after = await poll("both queued transitions synchronized", events, rows =>
    count(rows, "manual_pause_started") === count(before, "manual_pause_started") + 1 &&
    count(rows, "manual_pause_ended") === count(before, "manual_pause_ended") + 1,
    { timeoutMs: 60_000 },
  );
  const began = after.filter(e => e.event_type === "manual_pause_started").at(-1);
  const ended = after.filter(e => e.event_type === "manual_pause_ended").at(-1);
  expect(Date.parse(began.event_timestamp)).toBeLessThanOrEqual(Date.parse(ended.event_timestamp));
});
