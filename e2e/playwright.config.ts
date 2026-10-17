import { defineConfig } from "@playwright/test";
import { WEB_URL } from "./lib/env.ts";

export default defineConfig({
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  // One worker: the specs share one database and one clock, and the desktop app
  // holds a single-instance lock per profile. Determinism beats speed here.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "desktop", testDir: "./desktop" },
    { name: "web", testDir: "./web" },
    // The full workday runs as one ordered, serial file with a long budget.
    { name: "journey", testDir: "./journey", timeout: 30 * 60_000 },
  ],
});
