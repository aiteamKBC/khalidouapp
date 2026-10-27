import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./native",
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "native-report", open: "never" }]],
  outputDir: "native-results",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure", actionTimeout: 8_000 },
});
