// Boot, bridge and sign-in checks (ported from frontend/desktop-agent/e2e/smoke.mjs),
// now against the real E2E backend instead of a dead port.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { seed } from "../fixtures/api.ts";
import { launchDesktop, newDesktopProfile, signIn, type Desktop } from "../fixtures/desktop.ts";

let desktop: Desktop;

test.beforeAll(async () => {
  desktop = await launchDesktop(newDesktopProfile("smoke"));
});
test.afterAll(() => desktop?.kill());

test("renderer boots on the sign-in screen with a locked-down bridge", async () => {
  const { window } = desktop;
  await expect(window.getByRole("heading", { name: "Sign in to set up this computer" })).toBeVisible();

  const bridge = await window.evaluate(() => ({
    api: typeof (window as any).khaliduo,
    require: typeof (window as any).require,
    process: typeof (window as any).process,
  }));
  expect(bridge).toEqual({ api: "object", require: "undefined", process: "undefined" });

  const status = await desktop.status();
  expect(status.enrolled).toBe(false);
  // The profile is isolated: it lives in the throwaway folder, not %APPDATA%.
  expect(fs.existsSync(path.join(desktop.profile.userData, "identity.json"))).toBe(true);
});

test("wrong password shows an error and leaves the device un-enrolled", async () => {
  const { window } = desktop;
  await signIn(window, seed().employees.other.email, "definitely-wrong-password");
  await expect(window.locator(".k-error")).toBeVisible();
  expect((await desktop.status()).enrolled).toBe(false);
  await expect(window.locator("body")).not.toContainText(/\bNaN\b|Invalid Date/);
  expect(desktop.pageErrors).toEqual([]);
});
