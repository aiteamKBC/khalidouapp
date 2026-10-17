// Desktop edge cases outside the main workday journey.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { asAdmin, companyClock, poll, seed, type AdminApi } from "../fixtures/api.ts";
import { desktopLaunchOptions, launchDesktop, nav, newDesktopProfile, signIn, swal, type Desktop, type DesktopProfile } from "../fixtures/desktop.ts";

test.describe.configure({ mode: "serial" });

let hr: AdminApi;
let superAdmin: AdminApi;
let profile: DesktopProfile;
let desktop: Desktop;
const lamia = () => seed().employees.late;

const openSessionOf = async (employeeId: string) => {
  const rows = await superAdmin.get<any>(`/employees/${employeeId}/sessions`);
  return (Array.isArray(rows) ? rows : rows.items ?? []).find((s: any) => !s.ended_at);
};

test.beforeAll(async () => {
  hr = await asAdmin("hr");
  superAdmin = await asAdmin("super");
  profile = newDesktopProfile("lamia");
  desktop = await launchDesktop(profile);
  await signIn(desktop.window, lamia().email, seed().employeePassword);
  await poll("enrolled", () => desktop.status(), (s) => s.enrolled === true);
  await swal(desktop.window).click("Start work");
  await poll("tracking", () => desktop.status(), (s) => s.trackingStatus === "active");
});
test.afterAll(() => desktop?.kill());

test("every view renders without NaN / Invalid Date or page errors", async () => {
  for (const view of ["Timer", "Tasks", "Requests", "Meeting", "Settings"] as const) {
    await nav(desktop.window, view);
    await desktop.window.waitForTimeout(500);
    await expect(desktop.window.locator("body"), view).not.toContainText(/\bNaN\b|Invalid Date/);
  }
  expect(desktop.pageErrors).toEqual([]);
  await nav(desktop.window, "Timer");
});

test("an admin closing the session remotely stops tracking on the desktop", async () => {
  const session = await openSessionOf(lamia().id);
  await superAdmin.post(`/attendance/employee/${lamia().id}/sessions/close`, {
    session_id: session.id,
    reason: "Closed remotely by E2E",
  });
  await poll("session closed on the server", async () => (await superAdmin.get<any>(`/sessions/${session.id}`)), (s: any) =>
    Boolean((s.session ?? s).ended_at),
  );
  // Within a heartbeat or two the app notices: either it asks to start again,
  // or it waits for fresh input. It must not keep counting the closed session.
  await poll(
    "desktop reacts to the remote close",
    async () => ({ status: await desktop.status(), popup: await desktop.window.locator(".swal2-popup").count() }),
    ({ status, popup }) => popup > 0 || status.trackingStatus !== "active",
    { timeoutMs: 60_000, intervalMs: 2_000 },
  ).catch(async (error) => {
    const again = await openSessionOf(lamia().id);
    // A brand-new session (fresh input after the close) is also correct.
    if (!again || again.id === session.id) throw error;
  });
  const still = await openSessionOf(lamia().id);
  expect(still?.id).not.toBe(session.id);
});

test("starting outside the scheduled shift asks about extra time; 'Not working' starts nothing", async () => {
  const omar = seed().employees.other;
  const original = await hr.get(`/employees/${omar.id}/work-profile`);
  const hour = Number(companyClock(0).slice(0, 2));
  const [start, end] = hour >= 3 ? ["00:30", "01:30"] : ["22:00", "23:00"];
  // Breaks must sit inside the shift, so clear them while the shift is moved.
  await hr.patch(`/employees/${omar.id}/work-profile`, { shift_start: start, shift_end: end, break_rules: [] });
  const omarDesktop = await launchDesktop(newDesktopProfile("omar"));
  try {
    await signIn(omarDesktop.window, omar.email, seed().employeePassword);
    const popup = swal(omarDesktop.window);
    await expect(popup.title).toHaveText("Start extra time?", { timeout: 30_000 });
    await popup.click("Not working");
    await omarDesktop.window.waitForTimeout(5_000);
    expect(await openSessionOf(omar.id)).toBeUndefined();
    expect((await omarDesktop.status()).trackingStatus).not.toBe("active");
  } finally {
    omarDesktop.kill();
    await hr.patch(`/employees/${omar.id}/work-profile`, {
      shift_start: original.shift_start.slice(0, 5),
      shift_end: original.shift_end.slice(0, 5),
      break_rules: original.break_rules,
    });
  }
});

// Runs last: when it fails it leaves this profile signed out.
test("a second launch on the same profile hands over and leaves the running app signed in", async () => {
  await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide());
  // The second instance loses the single-instance lock and must exit on its
  // own. Started as a plain process: Playwright cannot attach to an app that
  // quits during startup.
  const options = desktopLaunchOptions(profile);
  const second = spawn(options.executablePath, options.args, { cwd: options.cwd, env: options.env, stdio: "ignore" });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error("second instance did not exit"));
    }, 30_000);
    second.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  expect(exitCode).not.toBeNull();
  await poll("first window is shown again", () => desktop.isWindowVisible(), (visible) => visible === true, { timeoutMs: 15_000 });
  expect((await desktop.status()).trackingStatus).toBe("active");

  // The running app must be untouched: still enrolled, token still stored, and
  // still syncing. (Currently fails: when the lock is refused, main.ts calls
  // app.quit() but app.whenReady() still runs hydrateIdentityStatus(), which
  // cannot decrypt the token and clears the shared enrollment.)
  const identity = fs.readFileSync(path.join(profile.userData, "identity.json"), "utf-8");
  expect(identity, "identity.json after a second launch").toContain("encryptedDeviceToken");
  const sessionId = (await openSessionOf(lamia().id))?.id;
  const before = await superAdmin.get<any>(`/employees/${lamia().id}/status`);
  await poll(
    "heartbeats keep arriving after a second launch",
    () => superAdmin.get<any>(`/employees/${lamia().id}/status`),
    (s) => Date.parse(s.last_heartbeat) > Date.parse(before.last_heartbeat) && s.current_session?.id === sessionId,
    { timeoutMs: 45_000 },
  );
});
