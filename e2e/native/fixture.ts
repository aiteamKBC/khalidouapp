import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test as base, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import ts from "typescript";
import { DESKTOP_DIR } from "../lib/env.ts";

type Harness = {
  app: ElectronApplication; page: Page;
  control: (command: string, value?: unknown) => Promise<any>;
  status: () => Promise<any>;
  advance: (seconds: number, idle?: boolean) => Promise<void>;
  nav: (name: string) => Promise<void>;
};

export const test = base.extend<{ desktop: Harness }>({
  desktop: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath("profile");
    fs.mkdirSync(profile, { recursive: true });
    const generated = path.join(DESKTOP_DIR, ".tmp", "runner");
    fs.mkdirSync(generated, { recursive: true });
    // Reuse the existing main-process source loader. Only erase TS and change
    // its one runtime import to the built service; no production test hooks.
    const helper = fs.readFileSync(path.join(DESKTOP_DIR, "tests/support/mainHarness.ts"), "utf8")
      .replace('../../electron/services/timedBreak.ts', '../../dist-electron-khaliduo/services/timedBreak.js');
    fs.writeFileSync(path.join(generated, "mainHarness.mjs"), ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
    const entry = path.join(generated, "entry.mjs");
    const runtime = pathToFileURL(path.join(DESKTOP_DIR, "e2e/support/native-runtime.mjs")).href;
    fs.writeFileSync(entry, `import { boot } from ${JSON.stringify(runtime)}; void boot(${JSON.stringify(profile)}).catch(error => { console.error(error); process.exit(1); });`);
    const env = { SYSTEMROOT: process.env.SYSTEMROOT ?? "C:\\Windows", PATH: process.env.PATH ?? "", TEMP: process.env.TEMP ?? profile, TMP: process.env.TMP ?? profile,
      APPDATA: path.join(profile, "roaming"), LOCALAPPDATA: path.join(profile, "local"), USERPROFILE: profile,
      VITE_API_BASE_URL: "http://127.0.0.1:59998/api/v1", KHALIDUO_UPDATE_URL: "http://127.0.0.1:59999" };
    const app = await _electron.launch({ executablePath: path.join(DESKTOP_DIR, "node_modules/electron/dist/electron.exe"), args: [entry], cwd: DESKTOP_DIR, env, timeout: 30_000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(8_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    app.on('window', window => window.on('pageerror', error => errors.push(error.message)));
    await page.locator(".tracker-frame").waitFor();
    await page.clock.setFixedTime(new Date('2026-10-27T09:00:00Z'));
    const control = (command: string, value?: unknown) => app.evaluate(async (_, input) => (globalThis as any).desktopTest.control(input.command, input.value), { command, value });
    const desktop: Harness = { app, page, control,
      status: () => page.evaluate(() => (window as any).khaliduo.getAgentStatus()),
      advance: async (seconds, idle = false) => { const state = await control("advance", { seconds, idle }); await page.clock.setFixedTime(new Date(state.now)); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); },
      nav: async name => {
        if (["Requests", "Meetings"].includes(name)) {
          await page.getByLabel("Account and more sections", { exact: true }).click();
          await page.locator(".v216-account-panel").getByRole("button", { name, exact: true }).click();
        } else await page.getByRole("navigation", { name: /^(Tracker sections|Workspace dock)$/ }).filter({ visible: true }).first().getByRole("button", { name, exact: true }).click();
      },
    };
    try { await use(desktop); }
    finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await page.screenshot({ path: testInfo.outputPath("failure.png") }).catch(() => {});
        await testInfo.attach("native-state", { body: JSON.stringify(await control("inspect").catch(() => ({})), null, 2), contentType: "application/json" });
      }
      const nativeErrors = await control('inspect').then(state => state.errors);
      await app.evaluate(() => (globalThis as any).desktopTest.cleanup()).catch(() => {});
      await app.close().catch(() => {});
      expect(errors, "uncaught renderer errors").toEqual([]);
      expect(nativeErrors, "native tracking errors").toEqual([]);
    }
  },
});
export { expect };
