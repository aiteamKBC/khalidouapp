// One employee's whole workday, in order, across the desktop app and the website.
//
// Dina (seed employee "day") signs in on a fresh computer, works, goes idle,
// explains idle time, takes a break, holds a meeting, pauses, files requests,
// loses the network, quits, comes back, and signs out. Meanwhile HR and her
// team lead review everything on the website, and payroll picks it up.
//
// Every step checks both what the person sees and what the backend stored.
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { asAdmin, companyClock, companyToday, poll, seed, type AdminApi } from "../fixtures/api.ts";
import { launchDesktop, newDesktopProfile, nav, setNetwork, signIn, swal, type Desktop, type DesktopProfile } from "../fixtures/desktop.ts";
import { signInAs, watchPage } from "../fixtures/web.ts";

test.describe.configure({ mode: "serial" });

let profile: DesktopProfile;
let desktop: Desktop;
let hr: AdminApi;
let superAdmin: AdminApi;
const dina = () => seed().employees.day;
/** List endpoints answer either a bare array or a paginated { items } object. */
const listOf = (rows: any): any[] => (Array.isArray(rows) ? rows : (rows?.items ?? rows?.requests ?? rows?.results ?? []));

async function sessionsToday() {
  const rows = await superAdmin.get<any>(`/employees/${dina().id}/sessions`);
  const list: any[] = Array.isArray(rows) ? rows : (rows.items ?? rows.sessions ?? []);
  return list;
}
async function openSession() {
  return (await sessionsToday()).find((s) => !s.ended_at);
}
async function sessionEvents(sessionId: string) {
  const rows = await superAdmin.get<any>(`/sessions/${sessionId}/events`);
  const list: any[] = Array.isArray(rows) ? rows : (rows.items ?? rows.events ?? []);
  return list.map((e) => e.event_type as string);
}

async function webPage(browser: Browser, who: Parameters<typeof signInAs>[1], url: string) {
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:5175` });
  const page = await context.newPage();
  const watch = watchPage(page);
  await signInAs(page, who);
  await page.goto(url);
  return { page, watch, close: () => context.close() };
}

test.beforeAll(async () => {
  hr = await asAdmin("hr");
  superAdmin = await asAdmin("super");
  profile = newDesktopProfile("dina");
});

test.afterAll(() => desktop?.kill());

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus || !desktop) return;
  await testInfo.attach("desktop-renderer-console", { body: desktop.consoleLog.join("\n"), contentType: "text/plain" });
  const mainLog = path.join(profile.userData, "logs", "main.log");
  if (fs.existsSync(mainLog)) await testInfo.attach("desktop-main-log", { path: mainLog, contentType: "text/plain" });
});

test("01 · HR sees Dina's profile on the website", async ({ browser }) => {
  const web = await webPage(browser, "hr", "/employees");
  await expect(web.page.getByText(dina().name).first()).toBeVisible({ timeout: 30_000 });
  const profileData = await hr.get(`/employees/${dina().id}/work-profile`);
  expect(profileData.shift_start).toBeTruthy();
  expect(profileData.working_days).toHaveLength(7);
  await web.watch.assertClean();
  await web.close();
});

test("02 · Dina signs in on a fresh computer", async () => {
  desktop = await launchDesktop(profile);
  const { window } = desktop;
  await expect(window.getByRole("heading", { name: "Sign in to set up this computer" })).toBeVisible();

  await signIn(window, dina().email, "not-her-password");
  await expect(window.locator(".k-error")).toBeVisible();
  expect((await desktop.status()).enrolled).toBe(false);

  await signIn(window, dina().email, seed().employeePassword);
  await poll("enrollment", () => desktop.status(), (s) => s.enrolled === true);

  // The device token is stored encrypted (DPAPI), never as a readable JWT.
  const identity = fs.readFileSync(path.join(profile.userData, "identity.json"), "utf-8");
  expect(identity).toContain("encryptedDeviceToken");
  expect(identity).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
});

test("03 · 'Start work tracking?' → Start work opens a server session", async () => {
  const { window } = desktop;
  const popup = swal(window);
  await expect(popup.title).toHaveText("Start work tracking?", { timeout: 30_000 });
  // Nothing is counted before she confirms.
  expect(await openSession()).toBeUndefined();
  await popup.click("Start work");

  const session = await poll("open server session", openSession, (s) => Boolean(s));
  expect(session.ended_at).toBeFalsy();
  await poll("tracking active", () => desktop.status(), (s) => s.trackingStatus === "active");
  const first = (await desktop.status()).workedTodaySeconds;
  await poll("timer counting", () => desktop.status(), (s) => s.workedTodaySeconds >= first + 3);
});

test("04 · heartbeats reach the server and HR sees her live", async ({ browser }) => {
  const started = Date.parse((await openSession()).started_at);
  // HEARTBEAT_INTERVAL_SECONDS=10 in the harness: wait for a periodic beat,
  // not just the one sent at session start.
  await poll(
    "a periodic heartbeat",
    () => superAdmin.get(`/employees/${dina().id}/status`),
    (s: any) => s.online_status === "online" && s.activity_status === "active" && Date.parse(s.last_heartbeat) > started + 8_000,
    { timeoutMs: 45_000 },
  );
  const web = await webPage(browser, "hr", "/live-activity");
  await expect(web.page.getByText(dina().name).first()).toBeVisible({ timeout: 30_000 });
  await web.watch.assertClean();
  await web.close();
});

test("05 · idle past the threshold → 'Are you still working?' → Continue working", async () => {
  const { window } = desktop;
  const session = await openSession();
  // The seeded company idle threshold is 1 minute.
  await desktop.goIdle(65);
  const popup = swal(window);
  await expect(popup.title).toHaveText("Are you still working?", { timeout: 20_000 });
  await poll("idle_started on the server", () => sessionEvents(session.id), (e) => e.includes("idle_started"));

  await desktop.becomeActive();
  await popup.click("Continue working");
  await expect(popup.popup).toBeHidden();
  await poll("idle_ended on the server", () => sessionEvents(session.id), (e) => e.includes("idle_ended"));
  await poll("tracking active again", () => desktop.status(), (s) => s.trackingStatus === "active");

  // 1.1.99: resuming must not trigger a second, back-to-back idle popup.
  await window.waitForTimeout(7_000);
  await expect(window.locator(".swal2-popup")).toHaveCount(0);
});

test("06 · 'I was working' opens Requests on that idle period and files an explanation", async () => {
  test.setTimeout(5 * 60_000);
  const { window } = desktop;
  await desktop.goIdle(65);
  const popup = swal(window);
  await expect(popup.title).toHaveText("Are you still working?", { timeout: 20_000 });
  // The explainable period runs from the popup to the click; under a minute
  // the app (correctly) says there is nothing to explain. Stay away 70 s.
  await window.waitForTimeout(70_000);
  await desktop.becomeActive();
  await popup.click("I was working during this idle period");

  // 1.1.100: the Requests view opens with this period already selected.
  const dialog = window.getByRole("dialog", { name: "Explain Idle Time" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const period = dialog.getByRole("combobox");
  await expect(period).not.toHaveValue("", { timeout: 15_000 });
  await expect(window.locator(".k-error")).toHaveCount(0);

  await dialog.locator("#idle-request-reason").fill("Whiteboard session with the design team, away from my desk.");
  await dialog.getByRole("button", { name: "Submit to HR" }).click();

  const request = await poll(
    "idle_time request on the server",
    () => hr.get<any>(`/time-adjustment-requests?employee_id=${dina().id}`),
    (rows) => listOf(rows).some((r) => r.request_type === "idle_time" && r.status === "pending"),
  );
  const idleRequest = listOf(request).find((r) => r.request_type === "idle_time");
  expect(idleRequest.reason).toContain("Whiteboard session");
});

async function attendanceToday() {
  return superAdmin.get<any>(`/attendance/employee/${dina().id}/${companyToday()}`);
}
async function setBreak(rule: { name: string; start: string; end: string; minutes: number }) {
  await hr.patch(`/employees/${dina().id}/work-profile`, {
    break_rules: [{ name: rule.name, minutes: rule.minutes, paid: true, anchor: "fixed", start_time: rule.start, end_time: rule.end }],
  });
  await desktop.syncNow();
  await poll(
    `desktop picks up the "${rule.name}" break`,
    () => desktop.status(),
    (s) => JSON.stringify(s.requestPolicy?.break_rules ?? []).includes(rule.name),
    { timeoutMs: 120_000, intervalMs: 3_000 },
  );
}
/** Milliseconds until company wall-clock "HH:MM" today. */
function msUntilClock(hhmm: string) {
  const toMinutes = (value: string) => value.split(":").map(Number).reduce((h, m) => h * 60 + m);
  return (toMinutes(hhmm) - toMinutes(companyClock(0))) * 60_000 - new Date().getSeconds() * 1000;
}
/** "HH:MM" minus `minutes`. */
function clockMinus(hhmm: string, minutes: number) {
  const total = hhmm.split(":").map(Number).reduce((h, m) => h * 60 + m) - minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

test("07 · paid break: resting is paid break, working through it saves minutes that cover later idle automatically", async () => {
  test.setTimeout(10 * 60_000);
  const { window } = desktop;
  const breakEnd = companyClock(3);
  await setBreak({ name: "Tea", start: companyClock(-1), end: breakEnd, minutes: 4 });

  // Work through the first part of the break → break-bank credit.
  await desktop.becomeActive();
  await poll("earned break credit", attendanceToday, (a) => a.earned_break_credit_seconds >= 60, { timeoutMs: 150_000, intervalMs: 5_000 });

  // Rest inside the break: idle is silent (a notification, never the idle popup).
  await desktop.goIdle(65);
  await poll("idle inside the break", () => desktop.status(), (s) => s.trackingStatus === "idle", { timeoutMs: 15_000 });
  await window.waitForTimeout(15_000);
  await expect(window.locator(".swal2-popup")).toHaveCount(0);
  await desktop.becomeActive();
  // Current behaviour: coming back from resting in a paid break still asks her
  // to confirm she is back (only Meeting Mode resumes silently). See main.ts
  // startIdleMonitor → showAutomaticIdleReturnReview.
  const back = swal(window);
  await expect(back.title).toHaveText("Confirm you are back", { timeout: 20_000 });
  await expect(back.popup.getByRole("button", { name: "Request manual time" })).toHaveCount(0);
  await back.click("Continue tracking");
  await expect(back.popup).toBeHidden();
  await poll("tracking active after the break rest", () => desktop.status(), (s) => s.trackingStatus === "active");
  await poll("rested break is paid", attendanceToday, (a) => a.paid_break_seconds > 0, { timeoutMs: 60_000, intervalMs: 5_000 });

  // Home shows what she saved, next to today's breaks.
  await nav(window, "Timer");
  const savedChip = window.locator('.k-break-times li[data-state="saved"]');
  await expect(savedChip).toContainText("Saved break", { timeout: 60_000 });

  // After the break, a normal idle period the saved minutes cover by themselves.
  await window.waitForTimeout(Math.max(0, msUntilClock(breakEnd)) + 5_000);
  await desktop.goIdle(65);
  const popup = swal(window);
  await expect(popup.title).toHaveText("Are you still working?", { timeout: 20_000 });
  await window.waitForTimeout(70_000);
  await desktop.becomeActive();
  await popup.click("Continue working");
  await expect(popup.popup).toBeHidden();

  // No claim and no approval: the later idle is covered from the saved minutes.
  const covered = await poll(
    "saved minutes cover the later idle",
    attendanceToday,
    (a) => a.approved_delayed_break_seconds > 0,
    { timeoutMs: 120_000, intervalMs: 5_000 },
  );
  expect(covered.approved_delayed_break_seconds).toBeLessThanOrEqual(covered.earned_break_credit_seconds);
  expect(covered.remaining_break_credit_seconds).toBe(
    covered.earned_break_credit_seconds - covered.approved_delayed_break_seconds,
  );
  const requests = listOf(await hr.get(`/time-adjustment-requests?employee_id=${dina().id}`));
  expect(requests.some((r) => r.request_type === "delayed_break")).toBe(false);

  // Requests shows a read-only summary; the old claim form is gone.
  await nav(window, "Requests");
  const card = window.locator(".k-break-bank");
  await expect(card).toContainText("Used on idle", { timeout: 60_000 });
  await expect(window.getByRole("button", { name: "Claim saved break time" })).toHaveCount(0);
  await poll(
    "desktop shows the used minutes",
    () => desktop.status(),
    (s) => (s.breakBank?.used_seconds ?? 0) > 0,
    { timeoutMs: 60_000, intervalMs: 5_000 },
  );

  // The Tea break stays in the profile: its window is over, and changing the
  // profile now would make the backend recompute the whole day with the new
  // breaks, erasing the break she already took (and the credit it earned).
});

test("08 · meeting mode: idle is silent during the meeting, and the meeting goes to review", async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const { window } = desktop;
  await nav(window, "Meeting");
  await window.getByPlaceholder("Client call, standup, workshop…").fill("Sprint planning");
  await window.getByPlaceholder("Briefly describe the meeting").fill("Planning next sprint with the team");
  await window.getByLabel("Expected duration (minutes)").fill("5");
  await window.getByRole("button", { name: "Start meeting" }).click();
  await expect(window.getByRole("button", { name: "End meeting" })).toBeVisible();
  await poll("meeting on the server", () => hr.get("/meetings"), (rows) =>
    listOf(rows).some((m) => m.employee_id === dina().id && m.title === "Sprint planning"),
  );

  await desktop.goIdle(65);
  await poll("idle recorded during the meeting", () => desktop.status(), (s) => s.trackingStatus === "idle", { timeoutMs: 15_000 });
  await window.waitForTimeout(10_000);
  await expect(window.locator(".swal2-popup")).toHaveCount(0);
  // Input during Meeting Mode ends the idle silently: no "confirm you are back".
  await desktop.becomeActive();
  await poll("meeting idle ends on input", () => desktop.status(), (s) => s.trackingStatus === "active", { timeoutMs: 15_000 });
  await expect(window.locator(".swal2-popup")).toHaveCount(0);

  await window.getByRole("button", { name: "End meeting" }).click();
  await expect(window.getByRole("button", { name: "Start meeting" })).toBeVisible({ timeout: 30_000 });
  const meetings = await poll("meeting ended and awaiting review", () => hr.get("/meetings"), (rows) =>
    listOf(rows).some((m) => m.employee_id === dina().id && m.title === "Sprint planning" && m.status === "pending"),
  );
  expect(listOf(meetings).find((m) => m.title === "Sprint planning").ended_at).toBeTruthy();

  // Her team lead sees it on the website.
  const web = await webPage(browser, "lead", "/meetings");
  await expect(web.page.getByText("Sprint planning").first()).toBeVisible({ timeout: 30_000 });
  await web.watch.assertClean();
  await web.close();
});

test("09 · manual pause stops the clock and resumes cleanly", async () => {
  const { window } = desktop;
  const session = await openSession();
  await nav(window, "Timer");
  await window.getByRole("button", { name: "Pause", exact: true }).click();
  await poll("paused", () => desktop.status(), (s) => s.trackingPaused === true);
  const pausedAt = (await desktop.status()).workedTodaySeconds;
  await window.waitForTimeout(6_000);
  expect((await desktop.status()).workedTodaySeconds - pausedAt).toBeLessThanOrEqual(1);

  await window.getByRole("button", { name: "Resume", exact: true }).click();
  await poll("resumed", () => desktop.status(), (s) => s.trackingPaused === false && s.trackingStatus === "active");
  await poll("pause events on the server", () => sessionEvents(session.id), (e) =>
    e.includes("manual_pause_started") && e.includes("manual_pause_ended"),
  );
});

test("10 · Request Centre: early leave, annual leave and shift reschedules", async () => {
  test.setTimeout(4 * 60_000);
  const { window } = desktop;
  await nav(window, "Requests");
  const status = await desktop.status();
  const leaveAt = clockMinus(status.requestPolicy.shift_end.slice(0, 5), 30);

  // Early leave: 30 minutes off the weekly 120.
  const early = window.locator("article", { has: window.getByRole("heading", { name: "Early Leave Permission" }) });
  await early.getByRole("button", { name: "Request" }).click();
  const earlyDialog = window.getByRole("dialog", { name: "Early Leave Permission" });
  await earlyDialog.locator('input[type="date"]').fill(companyToday());
  await earlyDialog.locator('input[type="time"]').fill(leaveAt);
  await earlyDialog.locator("textarea").fill("Doctor appointment this evening.");
  await earlyDialog.getByRole("button", { name: "Submit to HR" }).click();
  await poll("early_leave on the server", () => hr.get(`/time-adjustment-requests?employee_id=${dina().id}`), (rows) =>
    listOf(rows).some((r) => r.request_type === "early_leave" && r.status === "pending"),
  );
  await expect(window.getByText("90 of 120 weekly minutes remaining")).toBeVisible({ timeout: 30_000 });
  await earlyDialog.getByRole("button", { name: "Close request" }).click().catch(() => {});

  // Annual leave for one day next week.
  const leaveDay = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const annual = window.locator("article", { has: window.getByRole("heading", { name: "Annual Leave" }) });
  await annual.getByRole("button", { name: "Plan leave" }).click();
  const leaveDialog = window.getByRole("dialog", { name: "Annual Leave" });
  await leaveDialog.getByLabel("From date").fill(leaveDay);
  await leaveDialog.getByLabel("To date").fill(leaveDay);
  await leaveDialog.locator("textarea").fill("Family visit.");
  await leaveDialog.getByRole("button", { name: "Submit to HR" }).click();
  await poll("annual leave on the server", () => hr.get(`/leave-requests?employee_id=${dina().id}`), (rows) =>
    listOf(rows).some((r) => r.employee_id === dina().id && r.status === "pending"),
  );
  await leaveDialog.getByRole("button", { name: "Close request" }).click().catch(() => {});

  // Shift reschedules: request two days, cancel one.
  const card = window.locator("section.k-shift-reschedule");
  await card.scrollIntoViewIfNeeded();
  // 1.1.100: the page scrolls instead of squeezing its sections.
  expect((await card.boundingBox())!.height).toBeGreaterThan(200);
  for (const index of [1, 2]) {
    await card.getByLabel("Day").selectOption({ index });
    await card.getByLabel("New start time").fill("09:00");
    await card.locator("textarea").fill(`Dentist in the afternoon (${index}).`);
    await card.getByRole("button", { name: "Request shift reschedule" }).click();
    await expect(card.locator(".k-success")).toBeVisible();
  }
  await card.getByRole("button", { name: "Cancel" }).first().click();
  const reschedules = await poll("one pending and one cancelled reschedule", () => hr.get(`/shift-reschedules?employee_id=${dina().id}`), (rows) => {
    const mine = listOf(rows).filter((r) => r.employee_id === dina().id);
    return mine.some((r) => r.status === "pending") && mine.some((r) => r.status === "cancelled");
  });
  expect(listOf(reschedules).filter((r) => r.employee_id === dina().id)).toHaveLength(2);
});

test("11 · screen lock and sleep are recorded on the session", async () => {
  const session = await openSession();
  await desktop.powerEvent("lock-screen");
  await desktop.window.waitForTimeout(3_000);
  await desktop.powerEvent("unlock-screen");
  await desktop.powerEvent("suspend");
  await desktop.window.waitForTimeout(2_000);
  await desktop.powerEvent("resume");
  await poll("lock/sleep events on the server", () => sessionEvents(session.id), (e) =>
    ["screen_locked", "screen_unlocked", "system_suspended", "system_resumed"].every((name) => e.includes(name)),
  );
  await poll("tracking active after resume", () => desktop.status(), (s) => s.trackingStatus === "active");
});

test("12 · offline: work continues, events queue locally and replay once, in order", async () => {
  test.setTimeout(4 * 60_000);
  const { window } = desktop;
  const session = await openSession();
  const count = (events: string[], name: string) => events.filter((e) => e === name).length;
  const before = await sessionEvents(session.id);

  await setNetwork({ kind: "offline" });
  try {
    await poll("desktop notices it is offline", () => desktop.status(), (s) => s.connectionStatus === "offline", {
      timeoutMs: 60_000,
    });
    // A pause taken while offline must still reach the server later.
    await nav(window, "Timer");
    await window.getByRole("button", { name: "Pause", exact: true }).click();
    await poll("paused offline", () => desktop.status(), (s) => s.trackingPaused === true);
    await window.waitForTimeout(3_000);
    await window.getByRole("button", { name: "Resume", exact: true }).click();
    await poll("resumed offline", () => desktop.status(), (s) => s.trackingPaused === false);
    const worked = (await desktop.status()).workedTodaySeconds;
    await window.waitForTimeout(5_000);
    expect((await desktop.status()).workedTodaySeconds).toBeGreaterThan(worked);
    expect(count(await sessionEvents(session.id), "manual_pause_started")).toBe(count(before, "manual_pause_started"));
  } finally {
    await setNetwork({ kind: "online" });
  }

  await desktop.syncNow();
  const after = await poll("offline pause replayed", () => sessionEvents(session.id), (e) =>
    count(e, "manual_pause_started") === count(before, "manual_pause_started") + 1 &&
    count(e, "manual_pause_ended") === count(before, "manual_pause_ended") + 1,
    { timeoutMs: 90_000, intervalMs: 3_000 },
  );
  // Replayed exactly once, and the end never lands before its start.
  expect(after.lastIndexOf("manual_pause_started")).toBeLessThan(after.lastIndexOf("manual_pause_ended"));
  await poll("back online", () => desktop.status(), (s) => s.connectionStatus === "online");
});

test("13 · closing the window hides it and tracking continues", async () => {
  await desktop.window.getByRole("button", { name: "Close", exact: true }).click();
  await poll("window hidden", () => desktop.isWindowVisible(), (visible) => visible === false, { timeoutMs: 10_000 });
  expect((await desktop.dialogLog()).at(-1)?.title).toBe("Close Khaliduo");
  expect((await desktop.status()).trackingStatus).toBe("active");
  expect(await openSession()).toBeTruthy();
  await desktop.showWindow();
});

let firstSessionId: string;
test("14 · Quit ends the server session before the app exits", async () => {
  firstSessionId = (await openSession()).id;
  await desktop.quit();
  const sessions = await poll("session ended", sessionsToday, (rows) => Boolean(rows.find((s) => s.id === firstSessionId)?.ended_at));
  expect(sessions.find((s) => s.id === firstSessionId).status).not.toBe("active");
});

test("15 · relaunch: still signed in, asks before a new session, starts one", async () => {
  desktop = await launchDesktop(profile);
  const { window } = desktop;
  const popup = swal(window);
  await expect(popup.title).toHaveText("Start work tracking?", { timeout: 30_000 });
  await expect(window.getByRole("heading", { name: "Sign in to set up this computer" })).toHaveCount(0);
  await popup.click("Start work");
  const session = await poll("new open session", openSession, (s) => Boolean(s) && s.id !== firstSessionId);
  expect(session.id).not.toBe(firstSessionId);
});

test("16 · 'Dashboard' opens the employee portal already signed in", async ({ browser }) => {
  await desktop.window.getByRole("button", { name: "Dashboard", exact: true }).click();
  const urls = await poll("portal link opened", () => desktop.openedUrls(), (list) => list.some((u) => u.includes("handoff=")));
  const url = urls.find((u) => u.includes("handoff="))!;
  expect(url.startsWith("http://127.0.0.1:5175/employee")).toBe(true);

  const context = await browser.newContext();
  const page = await context.newPage();
  const watch = watchPage(page);
  await page.goto(url);
  await expect(page.getByText(dina().name).first()).toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/handoff=/);
  await watch.assertClean();
  await context.close();
});

test("17 · her team lead sees team A only, and no payroll", async ({ browser }) => {
  const lead = await asAdmin("lead");
  const requests = listOf(await lead.get(`/time-adjustment-requests?employee_id=${dina().id}`));
  expect(requests.length).toBeGreaterThan(0);
  expect([403, 404]).toContain(await lead.status("GET", `/employees/${seed().employees.other.id}`));
  expect(await lead.status("GET", `/payroll/sheet?month=${companyToday().slice(0, 7)}`)).toBe(403);

  const web = await webPage(browser, "lead", "/payroll");
  await expect(web.page.getByRole("heading", { name: "Access denied" })).toBeVisible({ timeout: 30_000 });
  await web.page.goto("/time-adjustments");
  await expect(web.page.getByText("Whiteboard session").first()).toBeVisible({ timeout: 30_000 });
  await expect(web.page.getByText(seed().employees.other.name)).toHaveCount(0);
  await web.watch.assertClean();
  await web.close();
});

test("18 · HR reviews everything Dina sent", async ({ browser }) => {
  // Idle explanation: approved on the website (saved breaks need no approval).
  const web = await webPage(browser, "hr", "/time-adjustments");
  for (const reason of ["Whiteboard session"]) {
    const row = web.page.getByRole("row").filter({ has: web.page.getByText(reason) });
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0, { timeout: 30_000 });
  }
  await web.watch.assertClean();
  await web.close();

  const time = listOf(await hr.get(`/time-adjustment-requests?employee_id=${dina().id}`));
  for (const type of ["idle_time"]) {
    expect(time.find((r) => r.request_type === type)?.status, type).toBe("approved");
  }
  // Early leave: rejected.
  const early = time.find((r) => r.request_type === "early_leave");
  await hr.patch(`/time-adjustment-requests/${early.id}`, { status: "rejected", admin_note: "Busy release evening." });

  // Annual leave: approved, and the balance drops by one day.
  const balanceBefore = await hr.get(`/leave-requests/balances/${dina().id}`);
  const leave = listOf(await hr.get(`/leave-requests?employee_id=${dina().id}`)).find((r) => r.status === "pending");
  await hr.patch(`/leave-requests/${leave.id}`, { status: "approved" });
  const balanceAfter = await hr.get(`/leave-requests/balances/${dina().id}`);
  expect(JSON.stringify(balanceAfter)).not.toEqual(JSON.stringify(balanceBefore));

  // Shift reschedule and meeting: approved.
  const reschedule = listOf(await hr.get(`/shift-reschedules?employee_id=${dina().id}`)).find(
    (r) => r.employee_id === dina().id && r.status === "pending",
  );
  await hr.patch(`/shift-reschedules/${reschedule.id}`, { status: "approved" });
  const meeting = listOf(await hr.get("/meetings")).find((m) => m.employee_id === dina().id && m.title === "Sprint planning");
  await hr.patch(`/meetings/${meeting.id}`, { status: "approved" });

  const after = listOf(await hr.get(`/time-adjustment-requests?employee_id=${dina().id}`));
  expect(after.find((r) => r.request_type === "early_leave").status).toBe("rejected");
});

test("19 · attendance adds the day up correctly", async ({ browser }) => {
  const day = await poll("approved idle explanation in attendance", attendanceToday, (a) => a.approved_manual_seconds >= 60);
  expect(day.financial_policy_active).toBe(true);
  expect.soft(day.approved_meeting_seconds, "approved meeting").toBeGreaterThan(0);
  expect.soft(day.earned_break_credit_seconds, "break credit earned in the Tea break").toBeGreaterThan(0);
  expect.soft(day.approved_delayed_break_seconds, "saved break covering later idle").toBeGreaterThan(0);
  expect.soft(day.paid_break_seconds, "rested part of the Tea break").toBeGreaterThan(0);
  expect.soft(day.calculation_sources.manual_pause_seconds, "manual pauses").toBeGreaterThan(0);
  // She started ~30 min after her shift: the paid late allowance caps at 15 min.
  expect(day.raw_late_seconds).toBeGreaterThan(900);
  expect(day.paid_late_allowance_seconds).toBe(900);
  expect(day.approved_early_leave_seconds).toBe(0);
  expect(day.total_payable_seconds).toBeGreaterThanOrEqual(
    day.normal_worked_seconds + day.approved_manual_seconds + day.paid_late_allowance_seconds,
  );

  const web = await webPage(browser, "hr", "/attendance");
  await expect(web.page.getByText(dina().name).first()).toBeVisible({ timeout: 30_000 });
  await web.watch.assertClean();
  await web.close();
});

test("20 · payroll picks up the day; HR adds a bonus, exports and approves the run", async ({ browser }) => {
  const settings = await hr.get("/payroll/settings");
  // The pay cycle (e.g. 26th → 25th) decides which month label today belongs to.
  const today = companyToday();
  const [y, m, d] = today.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const month = d >= Number(settings.cycle_start_day ?? 26) && Number(settings.cycle_start_day ?? 26) > 1 ? nextMonth : today.slice(0, 7);
  const sheet = await hr.get(`/payroll/sheet?month=${month}&employee_id=${dina().id}`);
  const entries = listOf(sheet.entries ?? sheet.rows ?? sheet);
  const entry = entries.find((e) => e.employee_id === dina().id);
  expect(entry, `payroll entry for ${month}`).toBeTruthy();
  expect(entry.worked_seconds).toBeGreaterThan(0);
  expect(entry.approved_manual_seconds).toBeGreaterThan(0);

  await hr.post(`/payroll/entries/${entry.id}/adjustments`, { adjustment_type: "bonus", amount: 500, reason: "E2E spot bonus" });
  const updated = await hr.get(`/payroll/entries/${entry.id}`);
  expect(Number(updated.total_bonuses ?? updated.entry?.total_bonuses)).toBeGreaterThanOrEqual(500);

  const csv = (await (await import("../fixtures/api.ts")).request<Response>("GET", `/payroll/export?month=${month}&format=csv`, {
    token: hr.session.accessToken,
    raw: true,
  })) as Response;
  expect(csv.status).toBe(200);
  expect(await csv.text()).toContain(dina().name);

  // The run cannot be approved while any row is unreviewed; review them all, then approve.
  const runId = sheet.run?.id ?? sheet.payroll_run_id ?? entry.payroll_run_id;
  expect(await hr.status("PATCH", `/payroll/runs/${runId}/status`, { status: "approved", reason: "E2E review" })).toBe(409);
  const fullSheet = await hr.get(`/payroll/sheet?month=${month}`);
  for (const row of listOf(fullSheet.entries ?? fullSheet.rows ?? fullSheet)) {
    await hr.patch(`/payroll/entries/${row.id}`, { status: "approved" });
  }
  await hr.patch(`/payroll/runs/${runId}/status`, { status: "approved", reason: "E2E review" });

  const web = await webPage(browser, "hr", "/payroll");
  await expect(web.page.getByText(dina().name).first()).toBeVisible({ timeout: 45_000 });
  await web.watch.assertClean();
  await web.close();
});

test("21 · Dina signs out: session ended, identity wiped, back to sign-in", async () => {
  const { window } = desktop;
  const sessionId = (await openSession()).id;
  await nav(window, "Settings");
  await window.getByRole("button", { name: "Sign out from this device" }).click();
  const popup = swal(window);
  await expect(popup.title).toHaveText("Sign out from this computer?");
  await popup.click("Sign out");
  await expect(window.getByRole("heading", { name: "Sign in to set up this computer" })).toBeVisible({ timeout: 30_000 });
  expect((await desktop.status()).enrolled).toBe(false);
  const identity = fs.readFileSync(path.join(profile.userData, "identity.json"), "utf-8");
  expect(identity).not.toContain("encryptedDeviceToken");
  await poll("session ended on sign-out", sessionsToday, (rows) => Boolean(rows.find((s) => s.id === sessionId)?.ended_at));
  expect(await openSession()).toBeUndefined();
});

test("22 · HR archives a leaver: off the lists, locked out, and restorable", async ({ browser }) => {
  const adel = seed().employees.archive;
  await hr.post(`/people/employee/${adel.id}/archive`, { reason: "resigned", last_working_day: companyToday() });

  const web = await webPage(browser, "hr", "/archived-employees");
  await expect(web.page.getByText(adel.name).first()).toBeVisible({ timeout: 30_000 });
  await web.watch.assertClean();
  await web.close();

  // On his own (fresh) computer, the desktop app refuses to link an archived employee…
  const adelDesktop = await launchDesktop(newDesktopProfile("adel"));
  try {
    await signIn(adelDesktop.window, adel.email, seed().employeePassword);
    await expect(adelDesktop.window.locator(".k-error")).toBeVisible({ timeout: 20_000 });
    expect((await adelDesktop.status()).enrolled).toBe(false);

    // …and links him again once HR restores him.
    await hr.post(`/people/employee/${adel.id}/restore`);
    await signIn(adelDesktop.window, adel.email, seed().employeePassword);
    await poll("restored employee can sign in", () => adelDesktop.status(), (s) => s.enrolled === true);
  } finally {
    adelDesktop.kill();
  }

  // A computer stays linked to its employee: Dina's (signed-out) computer
  // refuses another employee ("already linked to another employee", 409).
  await signIn(desktop.window, adel.email, seed().employeePassword);
  await expect(desktop.window.locator(".k-error")).toBeVisible({ timeout: 20_000 });
  expect((await desktop.status()).enrolled).toBe(false);
});
