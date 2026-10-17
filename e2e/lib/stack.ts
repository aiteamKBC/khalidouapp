import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  API_PORT,
  PROXY_PORT,
  API_URL,
  BACKEND_DIR,
  DASHBOARD_DIR,
  E2E_DIR,
  PIDS_FILE,
  PYTHON,
  RUNTIME_DIR,
  SECRETS_FILE,
  SEED_FILE,
  WEB_PORT,
  WEB_URL,
  assertIsolated,
  backendEnv,
  readJson,
  type Secrets,
} from "./env.ts";

const COMPOSE_FILE = path.join(E2E_DIR, "docker-compose.e2e.yml");
const LOG_DIR = path.join(RUNTIME_DIR, "logs");

function log(message: string) {
  console.log(`[e2e] ${message}`);
}

export function freshRuntimeDir() {
  fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
  for (const dir of [RUNTIME_DIR, LOG_DIR, path.join(RUNTIME_DIR, "screenshots"), path.join(RUNTIME_DIR, "no-updates")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function createSecrets(): Secrets {
  const secret = () => crypto.randomBytes(32).toString("hex");
  const secrets = { jwt: secret(), device: secret(), salary: secret() };
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets));
  return secrets;
}

export function loadSecrets(): Secrets {
  return readJson<Secrets>(SECRETS_FILE);
}

export function startDatabase() {
  try {
    execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore" });
  } catch {
    throw new Error("Docker is not running. Start Docker Desktop, then rerun the E2E suite.");
  }
  log("starting throwaway Postgres (docker compose, tmpfs)");
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", "--wait", "--force-recreate"], {
    stdio: "inherit",
  });
}

export function stopDatabase() {
  try {
    execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "down", "-v", "--remove-orphans"], {
      stdio: "inherit",
    });
  } catch {
    /* already gone */
  }
}

function runPython(args: string[], secrets: Secrets, extraEnv: NodeJS.ProcessEnv = {}) {
  execFileSync(PYTHON, args, {
    // cwd is RUNTIME_DIR, never backend/: pydantic-settings reads ".env" from
    // the working directory, and backend/.env is production.
    cwd: RUNTIME_DIR,
    env: { ...backendEnv(secrets), ...extraEnv },
    stdio: "inherit",
  });
}

export function migrate(secrets: Secrets) {
  log("alembic upgrade head");
  // backend/alembic.ini resolves script_location against the working directory,
  // so run a copy with absolute paths from RUNTIME_DIR.
  const ini = fs
    .readFileSync(path.join(BACKEND_DIR, "alembic.ini"), "utf-8")
    .replace(/^script_location = .*$/m, `script_location = ${path.join(BACKEND_DIR, "alembic")}`)
    .replace(/^prepend_sys_path = .*$/m, `prepend_sys_path = ${BACKEND_DIR}`);
  const iniPath = path.join(RUNTIME_DIR, "alembic.ini");
  fs.writeFileSync(iniPath, ini);
  runPython(["-m", "alembic", "-c", iniPath, "upgrade", "head"], secrets);
}

export function seed(secrets: Secrets) {
  log("seeding test company, admins, teams and employees");
  runPython([path.join(E2E_DIR, "seed", "seed_e2e.py")], secrets, { E2E_SEED_OUT: SEED_FILE });
}

function spawnLogged(name: string, command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess {
  const out = fs.openSync(path.join(LOG_DIR, `${name}.log`), "a");
  // Detached + unref: the servers outlive the launcher (lib/up.ts) and are
  // stopped explicitly by pid in killRecorded().
  const child = spawn(command, args, { ...options, stdio: ["ignore", out, out], windowsHide: true, detached: true });
  child.unref();
  const pids = fs.existsSync(PIDS_FILE) ? readJson<Record<string, number>>(PIDS_FILE) : {};
  pids[name] = child.pid!;
  fs.writeFileSync(PIDS_FILE, JSON.stringify(pids));
  return child;
}

export async function waitForUrl(url: string, timeoutMs: number, name: string) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not come up at ${url} within ${timeoutMs} ms (${lastError}). See e2e/.runtime/logs/${name}.log`);
}

export async function startBackend(secrets: Secrets) {
  log(`starting backend on ${API_URL}`);
  spawnLogged(
    "backend",
    PYTHON,
    ["-m", "uvicorn", "app.main:app", "--app-dir", BACKEND_DIR, "--host", "127.0.0.1", "--port", String(API_PORT)],
    { cwd: RUNTIME_DIR, env: backendEnv(secrets) },
  );
  await waitForUrl(`${API_URL}/health`, 60_000, "backend");
}

export async function startProxy() {
  log(`starting switchable desktop proxy on :${PROXY_PORT}`);
  spawnLogged(
    "proxy",
    process.execPath,
    [path.join(E2E_DIR, "lib", "proxy-server.ts"), String(PROXY_PORT), String(API_PORT)],
    { cwd: E2E_DIR, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT } },
  );
  await waitForUrl(`http://127.0.0.1:${PROXY_PORT}/__e2e/status`, 15_000, "proxy");
}

export async function startWebsite() {
  log(`starting website on ${WEB_URL}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Existing variables win over the dashboard's .env files in Vite.
    VITE_API_BASE_URL: API_URL,
    BROWSER: "none",
  };
  assertIsolated({ VITE_API_BASE_URL: env.VITE_API_BASE_URL });
  spawnLogged(
    "website",
    process.execPath,
    [path.join(DASHBOARD_DIR, "node_modules", "vite", "bin", "vite.js"), "dev", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"],
    { cwd: DASHBOARD_DIR, env },
  );
  await waitForUrl(`${WEB_URL}/login`, 120_000, "website");
}

/**
 * Stops leftovers of an interrupted run whose pid file is gone: anything
 * listening on a test port whose command line belongs to this repo.
 */
export function killStrayServers() {
  const script = `
    foreach ($port in ${API_PORT}, ${PROXY_PORT}, ${WEB_PORT}) {
      Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)"
        if ($proc.CommandLine -match 'khalidouapp') { taskkill /PID $_.OwningProcess /T /F | Out-Null; "stopped stray $port ($($_.OwningProcess))" }
      }
    }`;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf-8" }).trim();
    if (out) log(out);
  } catch {
    /* nothing to stop */
  }
}

export function killRecorded() {
  if (!fs.existsSync(PIDS_FILE)) return;
  const pids = readJson<Record<string, number>>(PIDS_FILE);
  for (const [name, pid] of Object.entries(pids)) {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      log(`stopped ${name} (pid ${pid})`);
    } catch {
      /* already exited */
    }
  }
  fs.rmSync(PIDS_FILE, { force: true });
}
