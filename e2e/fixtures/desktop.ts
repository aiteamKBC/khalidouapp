import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { DEAD_PORT, DESKTOP_API_URL, DESKTOP_DIR, PROXY_PORT, WEB_URL, assertIsolated } from "../lib/env.ts";

const ELECTRON_EXE = path.join(DESKTOP_DIR, "node_modules", "electron", "dist", "electron.exe");
const MAIN_JS = path.join(DESKTOP_DIR, "dist-electron-khaliduo", "main.js");

/** A throwaway Windows profile for one simulated computer (kept across relaunches). */
export function newDesktopProfile(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `khaliduo-e2e-${name}-`));
  const dirs = {
    root,
    userData: path.join(root, "userData"),
    appData: path.join(root, "AppData", "Roaming"),
    localAppData: path.join(root, "AppData", "Local"),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  return dirs;
}
export type DesktopProfile = ReturnType<typeof newDesktopProfile>;

export type Desktop = Awaited<ReturnType<typeof launchDesktop>>;

/** Everything `_electron.launch` needs to start the app on `profile`. */
export function desktopLaunchOptions(profile: DesktopProfile, extraEnv: Record<string, string> = {}) {
  if (!fs.existsSync(MAIN_JS)) {
    throw new Error("Desktop app is not built. Run `npm run build:desktop` in e2e/ first.");
  }
  const env: Record<string, string> = {
    SYSTEMROOT: process.env.SYSTEMROOT ?? "C:\\Windows",
    PATH: process.env.PATH ?? "",
    TEMP: process.env.TEMP ?? os.tmpdir(),
    TMP: process.env.TMP ?? os.tmpdir(),
    USERPROFILE: profile.root,
    APPDATA: profile.appData,
    LOCALAPPDATA: profile.localAppData,
    KHALIDUO_E2E_USER_DATA_DIR: profile.userData,
    // Every key in frontend/desktop-agent/.env is set here: dotenv never
    // overrides a variable that already exists, so the dev .env cannot leak in.
    VITE_API_BASE_URL: DESKTOP_API_URL,
    KHALIDUO_EMPLOYEE_PORTAL_URL: `${WEB_URL}/employee`,
    KHALIDUO_UPDATE_URL: `http://127.0.0.1:${DEAD_PORT}`,
    UPDATE_CHECK_INTERVAL_MINUTES: "1440",
    HEARTBEAT_INTERVAL_SECONDS: "10",
    CONFIG_REFRESH_INTERVAL_MINUTES: "1",
    LOG_LEVEL: "info",
    ...extraEnv,
  };
  assertIsolated({ VITE_API_BASE_URL: env.VITE_API_BASE_URL, KHALIDUO_EMPLOYEE_PORTAL_URL: env.KHALIDUO_EMPLOYEE_PORTAL_URL });
  return { executablePath: ELECTRON_EXE, args: [DESKTOP_DIR], cwd: DESKTOP_DIR, env, timeout: 60_000 };
}

export async function launchDesktop(profile: DesktopProfile, extraEnv: Record<string, string> = {}) {
  const app = await _electron.launch(desktopLaunchOptions(profile, extraEnv));
  // Install the native seams before the app's first idle poll (250 ms).
  await installSeams(app);
  const window = await app.firstWindow({ timeout: 30_000 });
  const pageErrors: string[] = [];
  const consoleLog: string[] = [];
  window.on("pageerror", (error) => pageErrors.push(error.message));
  window.on("console", (message) => consoleLog.push(`${new Date().toISOString()} ${message.type()}: ${message.text()}`));
  await window.waitForLoadState("domcontentloaded");
  await expect(window.locator("#root")).not.toBeEmpty({ timeout: 20_000 });
  // Diagnostics: every idle/tracking alert the main process raises, with the
  // renderer clock, lands in consoleLog (attached to failing tests).
  // Re-registered on every load: the renderer reloads after sign-in.
  const logAlerts = () =>
    window
      .evaluate(() =>
        (window as any).khaliduo.onIdleAlert?.((alert: unknown) => console.log(`[e2e] idle-alert ${JSON.stringify(alert)}`)),
      )
      .catch(() => {});
  window.on("load", () => void logAlerts());
  await logAlerts();

  const desktop = {
    app,
    window,
    profile,
    pageErrors,
    consoleLog,
    /** Runtime status straight from the main process (window.khaliduo bridge). */
    status: () => window.evaluate(() => (window as any).khaliduo.getAgentStatus()) as Promise<any>,
    syncNow: () => window.evaluate(() => (window as any).khaliduo.syncNow()),
    /** Simulate the user walking away `alreadyIdleSeconds` ago; idle keeps growing. */
    goIdle: (alreadyIdleSeconds: number) =>
      app.evaluate((_electron, seconds) => {
        (globalThis as any).__e2eIdleSince = Date.now() - seconds * 1000;
      }, alreadyIdleSeconds),
    /** Simulate keyboard/mouse input: OS idle time drops to zero and stays there. */
    becomeActive: () =>
      app.evaluate(() => {
        (globalThis as any).__e2eIdleSince = null;
      }),
    powerEvent: (name: "lock-screen" | "unlock-screen" | "suspend" | "resume") =>
      app.evaluate(({ powerMonitor }, event) => powerMonitor.emit(event), name),
    /** Answer the next native message box with button `index`. */
    answerNextDialog: (index: number) =>
      app.evaluate((_electron, response) => {
        (globalThis as any).__e2eDialogAnswers.push(response);
      }, index),
    openedUrls: () => app.evaluate(() => [...(globalThis as any).__e2eOpenedUrls] as string[]),
    dialogLog: () => app.evaluate(() => [...(globalThis as any).__e2eDialogLog] as any[]),
    isWindowVisible: () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w: { isVisible(): boolean }) => w.isVisible())),
    showWindow: () =>
      app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w?.show();
        w?.focus();
      }),
    /** Quit the way the tray's "Quit Khaliduo" does, then wait for the process to exit. */
    quit: async (timeoutMs = 25_000) => {
      const child = app.process();
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
      await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("desktop did not quit in time")), timeoutMs))]);
    },
    /** Hard stop for teardown (the app's before-quit handler can defer a graceful close). */
    kill: () => killTree(app),
  };
  return desktop;
}

async function installSeams(app: ElectronApplication) {
  await app.evaluate(({ powerMonitor, dialog, shell }) => {
    const g = globalThis as any;
    if (g.__e2eSeams) return;
    g.__e2eSeams = true;
    // OS idle clock (used when the native input probe is absent, as in a dev build).
    g.__e2eIdleSince = null;
    powerMonitor.getSystemIdleTime = () =>
      g.__e2eIdleSince == null ? 0 : Math.max(0, Math.floor((Date.now() - g.__e2eIdleSince) / 1000));
    // Native, blocking message boxes cannot be clicked by Playwright; answer them.
    g.__e2eDialogAnswers = [] as number[];
    g.__e2eDialogLog = [] as unknown[];
    const answer = (...args: any[]) => {
      const options = args.find((a) => a && typeof a === "object" && "buttons" in a) ?? args[args.length - 1];
      g.__e2eDialogLog.push({ title: options?.title, message: options?.message, buttons: options?.buttons });
      const response = g.__e2eDialogAnswers.length ? g.__e2eDialogAnswers.shift() : (options?.cancelId ?? 0);
      return { response, checkboxChecked: false };
    };
    dialog.showMessageBox = (async (...args: any[]) => answer(...args)) as any;
    dialog.showMessageBoxSync = ((...args: any[]) => answer(...args).response) as any;
    // Links the app opens in the system browser are recorded, not opened; the
    // test replays them in its own browser (e.g. the employee-portal handoff).
    g.__e2eOpenedUrls = [] as string[];
    shell.openExternal = (async (url: string) => {
      g.__e2eOpenedUrls.push(url);
    }) as any;
  });
}

export function killTree(app: ElectronApplication) {
  const pid = app.process()?.pid;
  if (!pid) return;
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------- UI helpers

export async function signIn(window: Page, email: string, password: string) {
  await window.locator('input[type="email"]').fill(email);
  await window.locator('input[type="password"]').fill(password);
  await window.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** The SweetAlert2 popup currently on screen. */
export function swal(window: Page) {
  const popup = window.locator(".swal2-popup.swal2-show, .swal2-popup:visible").first();
  return {
    popup,
    title: popup.locator(".swal2-title"),
    click: (name: string | RegExp) => popup.getByRole("button", { name }).click(),
  };
}

export async function nav(window: Page, view: "Timer" | "Tracker" | "Tasks" | "Requests" | "Meeting" | "Meetings" | "Settings" | "Shots" | "Shift" | "Insights") {
  // A request dialog stays open after submitting and covers the header; close it first.
  const openDialog = window.locator(".k-request-form-shell");
  if (await openDialog.count()) {
    await openDialog.getByRole("button", { name: "Close request" }).first().click();
    await expect(openDialog).toHaveCount(0);
  }
  const name = view === 'Timer' ? 'Tracker' : view === 'Meeting' ? 'Meetings' : view;
  if (name === 'Requests' || name === 'Meetings') {
    await window.getByLabel('Account and more sections', { exact: true }).click();
    await window.locator('.v216-account-panel').getByRole('button', { name, exact: true }).click();
  } else {
    await window.getByRole('navigation', { name: /^(Tracker sections|Workspace dock)$/ }).filter({ visible: true }).first().getByRole('button', { name, exact: true }).click();
  }
}

// ---------------------------------------------------------------- network switch

export async function setNetwork(mode: { kind: "online" } | { kind: "offline" } | { kind: "status"; status: number; pathPrefix: string }) {
  const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/__e2e/mode`, { method: "POST", body: JSON.stringify(mode) });
  return response.json();
}
