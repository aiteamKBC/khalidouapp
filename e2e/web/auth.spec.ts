// Admin sign-in lifecycle on the website: remember-me storage, logout, silent
// token refresh, wrong passwords, the login rate limit, and password change.
import { expect, test } from "@playwright/test";
import { adminLogin, request, seed } from "../fixtures/api.ts";
import { fillLoginForm, signInAs, signInWithForm, watchPage } from "../fixtures/web.ts";

const storedAuth = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({
    local: window.localStorage.getItem("khaliduo.auth"),
    session: window.sessionStorage.getItem("khaliduo.auth"),
  }));

test("remember me keeps the session in localStorage; logout clears it", async ({ page }) => {
  const watch = watchPage(page);
  await signInWithForm(page, "super", { remember: true });
  let auth = await storedAuth(page);
  expect(auth.local).toContain("accessToken");
  expect(auth.session).toBeNull();

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  auth = await storedAuth(page);
  expect(auth.local).toBeNull();
  expect(auth.session).toBeNull();
  await watch.assertClean();
});

test("without remember me the session lives only in this tab", async ({ page }) => {
  await signInWithForm(page, "hr", { remember: false });
  const auth = await storedAuth(page);
  expect(auth.local).toBeNull();
  expect(auth.session).toContain("accessToken");
});

test("a wrong password shows an error and stays on the login page", async ({ page }) => {
  await fillLoginForm(page, seed().admins.hr.email, "not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/invalid|incorrect/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/login/);
});

test("an expired access token is refreshed silently with the refresh token", async ({ page }) => {
  const session = await signInAs(page, "super");
  await page.goto("/dashboard");
  await expect(page.locator("main").first()).toBeVisible();
  // Break only the access token; the refresh token is still valid.
  await page.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem("khaliduo.auth")!);
    raw.accessToken = `${raw.accessToken.slice(0, -6)}broken`;
    window.localStorage.setItem("khaliduo.auth", JSON.stringify(raw));
  });
  await page.goto("/employees");
  await expect(page.getByText(seed().employees.day.name).first()).toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/login/);
  const stored = JSON.parse((await storedAuth(page)).local!);
  expect(stored.accessToken).not.toContain("broken");
  expect(stored.accessToken).not.toBe(session.accessToken);
});

test("the login endpoint rate-limits a single client after 10 attempts a minute", async () => {
  const ip = `10.250.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const response = (await request<Response>("POST", "/auth/login", {
      body: { email: seed().admins.hr.email, password: "wrong-password" },
      headers: { "x-forwarded-for": ip },
      raw: true,
    })) as Response;
    statuses.push(response.status);
  }
  expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
  expect(statuses[10]).toBe(429);
});

test("change password: the old one stops working, the new one works", async () => {
  const oldPassword = seed().adminPassword;
  const newPassword = "E2e-Changed-Password-9";
  const { accessToken } = await adminLogin("custom");
  await request("POST", "/auth/change-password", {
    token: accessToken,
    body: { current_password: oldPassword, new_password: newPassword },
  });
  try {
    const refused = (await request<Response>("POST", "/auth/login", {
      body: { email: seed().admins.custom.email, password: oldPassword },
      headers: { "x-forwarded-for": "10.251.0.1" },
      raw: true,
    })) as Response;
    expect(refused.status).toBe(401);
    const accepted = await request("POST", "/auth/login", {
      body: { email: seed().admins.custom.email, password: newPassword },
      headers: { "x-forwarded-for": "10.251.0.2" },
    });
    expect(accepted.access_token).toBeTruthy();
  } finally {
    // Put it back for the other specs.
    const relogin = await request("POST", "/auth/login", {
      body: { email: seed().admins.custom.email, password: newPassword },
      headers: { "x-forwarded-for": "10.251.0.3" },
    });
    await request("POST", "/auth/change-password", {
      token: relogin.access_token,
      body: { current_password: newPassword, new_password: oldPassword },
    });
  }
});
