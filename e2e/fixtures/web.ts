import { expect, type Page } from "@playwright/test";
import { adminLogin, seed, type AdminKey } from "./api.ts";

/**
 * Signs `page` in as an admin without the login form: logs in through the API
 * (with its own fake client IP, clear of the login rate limit) and stores the
 * session exactly where src/lib/auth.tsx keeps a "remember me" session.
 */
export async function signInAs(page: Page, key: AdminKey) {
  const session = await adminLogin(key);
  await page.addInitScript((payload) => {
    if (!window.localStorage.getItem("khaliduo.auth")) {
      window.localStorage.setItem("khaliduo.auth", JSON.stringify(payload));
    }
  }, session);
  return session;
}

/** Signs in through the real login form. Uses the per-IP login budget; keep rare. */
export async function signInWithForm(page: Page, key: AdminKey, { remember = true } = {}) {
  await fillLoginForm(page, seed().admins[key].email, seed().adminPassword);
  // The workspace login uses a native checkbox (ticked by default).
  await page.getByRole("checkbox", { name: /Remember me/ }).setChecked(remember);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

/**
 * The login page is server-rendered: typing before React hydrates is wiped by
 * hydration. Wait for the page to settle and re-type until the values stick.
 */
export async function fillLoginForm(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const emailInput = page.getByLabel("Email");
  const passwordInput = page.getByLabel("Password", { exact: true });
  await expect(async () => {
    await emailInput.fill(email);
    await passwordInput.fill(password);
    await page.waitForTimeout(300);
    await expect(emailInput).toHaveValue(email, { timeout: 500 });
    await expect(passwordInput).toHaveValue(password, { timeout: 500 });
  }).toPass({ timeout: 20_000 });
}

/** Fails on uncaught page errors or text that betrays a broken formatter. */
export function watchPage(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return {
    errors,
    async assertClean() {
      await expect(page.locator("body")).not.toContainText(/\bNaN\b|Invalid Date|undefined undefined/);
      expect(errors, "uncaught page errors").toEqual([]);
    },
  };
}
