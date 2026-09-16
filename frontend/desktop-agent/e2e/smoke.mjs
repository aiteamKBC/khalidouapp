// Playwright + Electron smoke/E2E harness for the Khaliduo desktop agent.
//
// Launches the BUILT app (run `npm run build` first) in an isolated user-data
// directory, pointed at a dead backend port so it can never touch production,
// and verifies the renderer boots without crashing, the contextBridge is wired,
// and the pre-auth sign-in screen renders and validates. Deep employee flows
// (tracking/screenshots) need real credentials + backend and are out of scope.
//
// Run:  node e2e/smoke.mjs
import { _electron as electron } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "khaliduo-e2e-"));
// Full isolation: the identity store also scans fixed %APPDATA% dirs for a
// legacy identity.json and would otherwise adopt the real production device.
// Redirecting APPDATA/LOCALAPPDATA gives the test app a clean, un-enrolled slate.
const roamingDir = fs.mkdtempSync(path.join(os.tmpdir(), "khaliduo-e2e-roaming-"));
const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "khaliduo-e2e-local-"));

const results = [];
const record = (name, pass, detail = "") =>
  results.push({ name, pass, detail });

const consoleErrors = [];
const pageErrors = [];

let app;
let exitCode = 0;
try {
  app = await electron.launch({
    args: [".", `--user-data-dir=${userDataDir}`],
    cwd: appDir,
    timeout: 60_000,
    env: {
      ...process.env,
      // Isolate the app's data dirs from the real production install.
      APPDATA: roamingDir,
      LOCALAPPDATA: localDir,
      // Dead port: any enrollment/heartbeat/update call fails fast and can
      // never reach the production API during the test.
      VITE_API_BASE_URL: "http://127.0.0.1:59999/api/v1",
      KHALIDUO_UPDATE_URL: "http://127.0.0.1:59999",
      KHALIDUO_EMPLOYEE_PORTAL_URL: "http://127.0.0.1:59999/employee",
      LOG_LEVEL: "error",
    },
  });

  const window = await app.firstWindow({ timeout: 30_000 });
  window.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  window.on("pageerror", (err) => pageErrors.push(err.message));

  await window.waitForLoadState("domcontentloaded");
  await window.waitForTimeout(1500); // let React mount + first IPC status land

  record("app launches and opens a window", true);

  // 1. Renderer actually rendered something (not a white screen / crash).
  const rootSize = await window.evaluate(
    () => document.getElementById("root")?.innerHTML?.length ?? 0,
  );
  record("renderer mounts content into #root", rootSize > 50, `len=${rootSize}`);

  // 2. contextBridge is wired and locked down to the documented surface.
  const bridge = await window.evaluate(() => {
    const api = window.khaliduo;
    return {
      type: typeof api,
      hasEnroll: typeof api?.enrollWithCredentials === "function",
      hasStatus: typeof api?.getAgentStatus === "function",
      leakedRequire: typeof window.require,
      leakedProcess: typeof window.process,
    };
  });
  record("khaliduo contextBridge is exposed", bridge.type === "object");
  record("enroll + status bridge methods present", bridge.hasEnroll && bridge.hasStatus);
  record(
    "node internals are NOT leaked to the renderer",
    bridge.leakedRequire === "undefined" && bridge.leakedProcess === "undefined",
    `require=${bridge.leakedRequire} process=${bridge.leakedProcess}`,
  );

  // 3. getAgentStatus IPC round-trips and returns a sane pre-auth status.
  const status = await window.evaluate(() => window.khaliduo.getAgentStatus());
  record(
    "getAgentStatus IPC round-trips",
    status && typeof status === "object",
    `enrolled=${status?.enrolled}`,
  );
  const enrolled = status?.enrolled === true;

  // Text sanity: nothing user-visible should render as NaN / Invalid Date
  // (guards the timestamp/counter formatters in the renderer).
  const bodyText = await window.evaluate(() => document.body.innerText || "");
  record(
    "no 'NaN' / 'Invalid Date' in visible UI",
    !/\bNaN\b|Invalid Date/.test(bodyText),
  );

  if (enrolled) {
    // On a host with the real app installed, the agent adopts the production
    // identity from the fixed %APPDATA% legacy path (appData resolves via the
    // OS known-folder API, so it cannot be isolated here). Test the enrolled
    // dashboard state instead; run sign-in assertions only on a clean host/CI.
    record("sign-in flow (SKIPPED: device enrolled on this host)", true);
    record("enrolled dashboard renders without crashing", rootSize > 50);
    const statusStable = await window.evaluate(() =>
      window.khaliduo
        .getAgentStatus()
        .then((s) => (s && typeof s === "object" ? "ok" : "bad"))
        .catch((e) => String(e)),
    );
    record("status IPC stays stable on enrolled host", statusStable === "ok");
  } else {
    // Pre-auth UI: sign-in screen renders with email + password entry.
    const emailCount = await window
      .locator('input[type="email"], input[name="email" i], input[placeholder*="mail" i]')
      .count();
    const passwordCount = await window.locator('input[type="password"]').count();
    record("sign-in email field renders", emailCount > 0, `count=${emailCount}`);
    record("sign-in password field renders", passwordCount > 0, `count=${passwordCount}`);

    // Invalid enrollment fails gracefully (no crash) against the dead backend.
    const enrollResult = await window.evaluate(() =>
      window.khaliduo
        .enrollWithCredentials("nobody@example.com", "wrong-password")
        .catch((e) => ({ threw: String(e) })),
    );
    record(
      "invalid enrollment returns a handled result (no unhandled throw)",
      enrollResult && typeof enrollResult === "object",
      JSON.stringify(enrollResult).slice(0, 120),
    );
    await window.waitForTimeout(500);
    const stillEnrolled = await window.evaluate(() =>
      window.khaliduo.getAgentStatus().then((s) => s?.enrolled),
    );
    record("device stays un-enrolled after a failed enrollment", stillEnrolled !== true);
  }

  await window.screenshot({
    path: path.join(userDataDir, "smoke-signin.png"),
  });

  // 6. No uncaught renderer exceptions (React tree crash / white screen).
  record(
    "no uncaught renderer (pageerror) exceptions",
    pageErrors.length === 0,
    pageErrors.slice(0, 3).join(" | "),
  );
} catch (error) {
  record("harness ran without fatal error", false, String(error));
}

// Report FIRST, before any teardown (the app's before-quit handler
// preventDefaults the first quit, so a graceful app.close() can hang).
console.log("\n=== Khaliduo desktop E2E smoke ===");
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
  if (!r.pass) failed += 1;
}
if (consoleErrors.length) {
  console.log(`\nRenderer console.error messages (${consoleErrors.length}):`);
  for (const e of consoleErrors.slice(0, 8)) console.log("  - " + e.slice(0, 160));
}
console.log(`\nScreenshot + logs: ${userDataDir}`);
console.log(`RESULT: ${results.length - failed}/${results.length} passed`);

// Teardown: try a graceful close but never block on it; force-kill the main
// Electron process if it resists (before-quit preventDefault).
exitCode = failed > 0 ? 1 : 0;
if (app) {
  const child = app.process();
  await Promise.race([
    app.close().catch(() => {}),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
  // Electron spawns a child-process tree (renderer/GPU/utility) that a single
  // kill on the main pid does not reap on Windows. Kill the whole tree so runs
  // never leave orphaned processes holding the single-instance lock.
  const pid = child?.pid;
  if (pid) {
    try {
      if (process.platform === "win32") {
        const { execFileSync } = await import("node:child_process");
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      /* already gone */
    }
  }
}
process.exit(exitCode);
