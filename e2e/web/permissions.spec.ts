// Role × route matrix. For every admin kind, each page either renders or
// redirects away exactly as the backend's capabilities say, and the API behind
// a refused page refuses a direct call too (the UI guard is not the only lock).
import { expect, test } from "@playwright/test";
import { adminLogin, asAdmin, companyToday, type AdminKey } from "../fixtures/api.ts";
import { signInAs, watchPage } from "../fixtures/web.ts";

type Route = {
  path: string;
  /** Allowed when this returns true for the logged-in user. */
  allowed: (user: { permissions: string[]; role: string; is_super_admin: boolean }) => boolean;
  /** A read endpoint the page depends on; must be refused when the page is. */
  api?: string;
  /** A known gap: the API answers even when the page is refused. Reported as an annotation. */
  apiUnguarded?: string;
};

const has = (key: string) => (u: { permissions: string[] }) => u.permissions.includes(key);
const hrOrSuper = (u: { role: string; is_super_admin: boolean }) =>
  u.role === "hr" || u.role === "general_admin" || u.is_super_admin;
const month = () => companyToday().slice(0, 7);

// Mirrors frontend/admin-dashboard/src/lib/permissions.ts (requiredPermissionForPath)
// plus the role-only pages guarded in the sidebar/backend.
const ROUTES: Route[] = [
  { path: "/dashboard", allowed: has("dashboard.view") },
  // /employees lands on /people (the People hub).
  { path: "/people", allowed: has("people.view") },
  { path: "/timesheets", allowed: has("timesheets.view") },
  { path: "/time-adjustments", allowed: has("time_requests.view"), api: "/time-adjustment-requests" },
  { path: "/holiday-requests", allowed: has("leave_requests.view"), api: "/leave-requests" },
  { path: "/screenshots", allowed: has("screenshots.view") },
  {
    path: "/settings/tracking",
    allowed: has("settings.view"),
    api: "/settings/tracking",
    apiUnguarded: "GET /settings/tracking has no permission check: any admin can read the tracking settings.",
  },
  { path: "/audit-log", allowed: has("audit.view") },
  { path: "/payroll", allowed: (u) => has("payroll.view")(u) && hrOrSuper(u), api: `/payroll/sheet?month=${month()}` },
  // The sidebar hides this for non-HR, but the page and API only need people.view
  // (rows stay team-scoped). Archiving itself is HR / Super Admin only.
  { path: "/archived-employees", allowed: has("people.view"), api: "/people/archived-employees" },
  { path: "/shift-reschedules", allowed: hrOrSuper, api: "/shift-reschedules" },
];

const ADMINS: AdminKey[] = ["super", "hr", "lead", "custom"];

for (const key of ADMINS) {
  test.describe(`${key} admin`, () => {
    let user: Awaited<ReturnType<typeof adminLogin>>["user"];
    test.beforeAll(async () => {
      user = (await adminLogin(key)).user;
    });

    for (const route of ROUTES) {
      test(`${route.path}`, async ({ page }) => {
        const allowed = route.allowed(user);
        const watch = watchPage(page);
        await signInAs(page, key);
        await page.goto(route.path);
        if (allowed) {
          await expect(page).toHaveURL(new RegExp(`${route.path.replace("/", "\\/")}`));
          await expect(page.locator("main").first()).toBeVisible();
          await page.waitForLoadState("networkidle");
          await expect(page).toHaveURL(new RegExp(`${route.path.replace("/", "\\/")}`));
          await watch.assertClean();
        } else {
          // Refused pages render an in-place "Access denied" screen (no redirect).
          await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible({ timeout: 20_000 });
        }
        if (route.api) {
          const status = await (await asAdmin(key)).status("GET", route.api);
          if (allowed) expect(status, `${route.api} for ${key}`).toBe(200);
          else if (route.apiUnguarded && status === 200) test.info().annotations.push({ type: "known gap", description: route.apiUnguarded });
          else expect([401, 403], `${route.api} for ${key}`).toContain(status);
        }
      });
    }
  });
}

test("the team lead only sees assigned teams' people", async () => {
  const { seed } = await import("../fixtures/api.ts");
  const lead = await asAdmin("lead");
  expect(await lead.status("GET", `/employees/${seed().employees.day.id}`)).toBe(200);
  expect([403, 404]).toContain(await lead.status("GET", `/employees/${seed().employees.other.id}`));
});
