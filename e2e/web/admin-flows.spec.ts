// Website admin workflows that do not need the desktop app: people, leave
// balances, emergency shift changes, attendance corrections, settings + audit.
import { expect, test } from "@playwright/test";
import { asAdmin, companyToday, employeeLogin, seed, type AdminApi } from "../fixtures/api.ts";
import { signInAs, watchPage } from "../fixtures/web.ts";

const listOf = (rows: any): any[] => (Array.isArray(rows) ? rows : (rows?.items ?? rows?.results ?? []));
const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const minutesOf = (hhmm: string) => hhmm.slice(0, 5).split(":").map(Number).reduce((h, m) => h * 60 + m);
const clockOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

let hr: AdminApi;
test.beforeAll(async () => {
  hr = await asAdmin("hr");
});

test("HR creates an employee, sets a password and work profile, and it shows everywhere", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const email = `new-${stamp}@e2e.example.com`;
  const created = await hr.post("/employees", { name: `Nour New ${stamp}`, email, employee_code: `E2E-N-${stamp}`, job_title: "Analyst" });
  const id = created.id ?? created.employee?.id;
  await hr.patch(`/employees/${id}/password`, { password: "E2e-New-Employee-1" });
  await hr.patch(`/employees/${id}/work-profile`, {
    shift_start: "09:00",
    shift_end: "17:00",
    working_days: [0, 1, 2, 3, 6],
    salary_amount: 15000,
    salary_currency: "EGP",
  });
  const profile = await hr.get(`/employees/${id}/work-profile`);
  expect(profile.shift_start.slice(0, 5)).toBe("09:00");
  const history = listOf(await hr.get(`/employees/${id}/change-history`));
  expect(history.length).toBeGreaterThan(0);

  // The new employee can log in to the portal.
  const login = await fetch(`http://127.0.0.1:8010/api/v1/employee-auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.252.0.1" },
    body: JSON.stringify({ email, password: "E2e-New-Employee-1" }),
  });
  expect(login.status).toBe(200);

  const watch = watchPage(page);
  await signInAs(page, "hr");
  await page.goto(`/employees/${id}`);
  await expect(page.getByText(`Nour New ${stamp}`).first()).toBeVisible({ timeout: 30_000 });
  await watch.assertClean();
});

test("leave balances: HR can edit, a team lead cannot", async () => {
  const lamia = seed().employees.late.id;
  await hr.put(`/leave-requests/balances/${lamia}`, { remaining_days: 12.5 });
  const balance = await hr.get(`/leave-requests/balances/${lamia}`);
  expect(JSON.stringify(balance)).toContain("12.5");

  const lead = await asAdmin("lead");
  expect([403]).toContain(await lead.status("PUT", `/leave-requests/balances/${lamia}`, { remaining_days: 30 }));
});

test("HR files a manual leave and it appears on Holiday requests", async ({ page }) => {
  const lamia = seed().employees.late;
  const day = addDays(companyToday(), 14);
  const row = await hr.post("/leave-requests/manual", {
    employee_id: lamia.id,
    leave_type: "annual",
    start_date: day,
    end_date: day,
    reason: "Recorded by HR (E2E)",
  });
  expect(row.id ?? row.leave_request?.id).toBeTruthy();

  const watch = watchPage(page);
  await signInAs(page, "hr");
  await page.goto("/holiday-requests");
  await expect(page.getByText(lamia.name).first()).toBeVisible({ timeout: 30_000 });
  await watch.assertClean();
});

test("emergency shift reschedule by HR is applied without employee notice", async () => {
  const lamia = seed().employees.late;
  const profile = await hr.get(`/employees/${lamia.id}/work-profile`);
  const length = minutesOf(profile.shift_end) - minutesOf(profile.shift_start);
  const workDate = addDays(companyToday(), 1);
  const created = await hr.post("/shift-reschedules/emergency", {
    employee_id: lamia.id,
    work_date: workDate,
    requested_start: "08:00",
    requested_end: clockOf(8 * 60 + length),
    reason: "Covering the early support rota (E2E)",
  });
  expect(created.status ?? created.request?.status).toBe("approved");
  const day = await hr.get(`/shift-reschedules/day?employee_id=${lamia.id}&date=${workDate}`);
  expect(JSON.stringify(day)).toContain("08:00");

  const lead = await asAdmin("lead");
  expect(await lead.status("POST", "/shift-reschedules/emergency", {
    employee_id: lamia.id,
    work_date: addDays(workDate, 1),
    requested_start: "08:00",
    requested_end: clockOf(8 * 60 + length),
    reason: "Not allowed",
  })).toBe(403);
});

test("attendance correction adds payable minutes and can be removed", async () => {
  const lamia = seed().employees.late.id;
  const date = companyToday();
  const base = await hr.get(`/attendance/employee/${lamia}/${date}`);
  await hr.patch(`/attendance/employee/${lamia}/${date}/correction`, { payable_minutes_delta: 30, reason: "Forgot to start tracking (E2E)" });
  const corrected = await hr.get(`/attendance/employee/${lamia}/${date}`);
  expect(corrected.attendance_correction).toBeTruthy();
  // Her day may still be running, so allow a few seconds of live drift.
  expect(Math.abs(corrected.total_payable_seconds - (base.total_payable_seconds + 30 * 60))).toBeLessThanOrEqual(10);

  await hr.delete(`/attendance/employee/${lamia}/${date}/correction`);
  const restored = await hr.get(`/attendance/employee/${lamia}/${date}`);
  expect(restored.attendance_correction).toBeNull();
  expect(Math.abs(restored.total_payable_seconds - base.total_payable_seconds)).toBeLessThanOrEqual(20);
});

test("tracking settings change is audited; HR cannot change company settings", async ({ page }) => {
  const superAdmin = await asAdmin("super");
  const before = await superAdmin.get("/settings/tracking");
  await superAdmin.patch("/settings/tracking", { screenshot_retention_days: 45 });
  try {
    expect((await superAdmin.get("/settings/tracking")).screenshot_retention_days).toBe(45);
    const audit = JSON.stringify(await superAdmin.get("/audit-log?page_size=20").catch(() => superAdmin.get("/audit")));
    expect(audit).toMatch(/setting/i);
  } finally {
    await superAdmin.patch("/settings/tracking", { screenshot_retention_days: before.screenshot_retention_days });
  }
  const watch = watchPage(page);
  await signInAs(page, "super");
  await page.goto("/audit-log");
  await expect(page.locator("main").first()).toBeVisible();
  await watch.assertClean();
});

test("an archived employee cannot use the employee portal until restored", async () => {
  const omar = seed().employees.other;
  await hr.post(`/people/employee/${omar.id}/archive`, { reason: "fired", last_working_day: companyToday() });
  try {
    const archived = listOf(await hr.get("/people/archived-employees"));
    expect(archived.some((row) => (row.id ?? row.employee_id) === omar.id)).toBe(true);
    await expect(employeeLogin("other")).rejects.toThrow(/HTTP (401|403)/);
  } finally {
    await hr.post(`/people/employee/${omar.id}/restore`);
  }
  expect(await employeeLogin("other")).toBeTruthy();
});

test("saved breaks switch: HR, General Admin and Super Admin use it, a team lead cannot; off/on never rolls today back", async ({ page }) => {
  const lead = await asAdmin("lead");
  expect(await lead.status("GET", "/payroll/financial-policy")).toBe(403);
  expect(await lead.status("PUT", "/payroll/financial-policy", { enabled: false })).toBe(403);
  for (const key of ["super", "custom"] as const) {
    const admin = await asAdmin(key);
    expect((await admin.get("/payroll/financial-policy")).enabled, key).toBe(true);
  }
  const startedOn = (await hr.get("/payroll/financial-policy")).active_since;
  expect(startedOn).toMatch(/-01-01$/);

  // HR switches it off and back on from the Breaks page.
  const watch = watchPage(page);
  await signInAs(page, "hr");
  await page.goto("/breaks");
  const card = page.locator("main");
  const toggle = page.getByRole("switch", { name: "Saved breaks" });
  await expect(toggle).toBeChecked({ timeout: 30_000 });
  await expect(card).toContainText("On since");

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  const off = await hr.get("/payroll/financial-policy");
  expect(off.enabled).toBe(false);
  // Off applies from tomorrow: today is still the last covered day.
  expect(off.periods[0].ends_on).toBe(companyToday());
  await expect(card).toContainText("Last day covered");

  await toggle.click();
  await expect(toggle).toBeChecked();
  const on = await hr.get("/payroll/financial-policy");
  // Back on the same day: the same period simply continues, no gap.
  expect(on.enabled).toBe(true);
  expect(on.active_since).toBe(startedOn);
  expect(on.periods).toHaveLength(1);
  await watch.assertClean();

  const audit = JSON.stringify(await hr.get("/audit-log?page_size=20").catch(() => hr.get("/audit")));
  expect(audit).toMatch(/financial_policy/);
});

test("a team lead does not see the saved breaks switch", async ({ page }) => {
  const watch = watchPage(page);
  await signInAs(page, "lead");
  await page.goto("/breaks");
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByText("Work Schedule & Attendance")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("switch", { name: "Saved breaks" })).toHaveCount(0);
  await watch.assertClean();
});
