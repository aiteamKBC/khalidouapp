import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  API_PORT,
  DB_PORT,
  PROXY_PORT,
  API_URL,
  BACKEND_DIR,
  REPO_DIR,
  DASHBOARD_DIR,
  E2E_DIR,
  PIDS_FILE,
  PYTHON,
  RUNTIME_DIR,
  SECRETS_FILE,
  SEED_FILE,
  WEB_PORT,
  WEB_URL,
  TOXIPROXY_API_PORT,
  TOXIPROXY_PORT,
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
  const resolved = path.resolve(RUNTIME_DIR);
  if (resolved !== path.join(path.resolve(E2E_DIR), ".runtime")) throw new Error("Invalid test runtime directory");
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
  if (process.env.E2E_DATABASE_PROVIDER === "native" || (process.platform === "win32" && process.env.E2E_DATABASE_PROVIDER !== "docker")) {
    const bin = path.join(E2E_DIR, ".tools", "postgres", "bin");
    const suffix = process.platform === "win32" ? ".exe" : "";
    const run = (name: string, args: string[]) => {
      // On Windows the postmaster inherits pipe handles from pg_ctl. Capturing
      // stdout with execFileSync then waits forever after pg_ctl itself exits.
      const output = fs.openSync(path.join(LOG_DIR, "postgres-tools.log"), "a");
      try { return execFileSync(path.join(bin, name + suffix), args, { windowsHide: true, stdio: ["ignore", output, output] }); }
      finally { fs.closeSync(output); }
    };
    if (!fs.existsSync(path.join(bin, "initdb" + suffix))) throw new Error("Run e2e/tools/setup.py --only postgres first");
    const data = path.join(RUNTIME_DIR, "postgres");
    run("initdb", ["-D", data, "-U", "khaliduo_e2e", "-A", "trust", "-E", "UTF8", "--no-locale"]);
    fs.writeFileSync(path.join(RUNTIME_DIR, "database-provider.json"), JSON.stringify({ provider: "native" }));
    run("pg_ctl", ["-D", data, "-l", path.join(LOG_DIR, "postgres.log"), "-o", `-h 127.0.0.1 -p ${DB_PORT} -c shared_buffers=16MB -c max_connections=30`, "-w", "start"]);
    // The reduced portable distribution has no createdb/psql client tools.
    execFileSync(PYTHON, ["-c", `import psycopg\nwith psycopg.connect(host='127.0.0.1', port=${DB_PORT}, user='khaliduo_e2e', dbname='postgres', autocommit=True) as conn:\n    conn.execute('CREATE DATABASE khaliduo_e2e')`], { cwd: RUNTIME_DIR, windowsHide: true, stdio: "inherit" });
    log("isolated portable PostgreSQL started on loopback only");
    return;
  }
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
  const marker = path.join(RUNTIME_DIR, "database-provider.json");
  if (fs.existsSync(marker) && readJson<{provider: string}>(marker).provider === "native") {
    const executable = path.join(E2E_DIR, ".tools", "postgres", "bin", process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
    try { execFileSync(executable, ["-D", path.join(RUNTIME_DIR, "postgres"), "status"], { windowsHide: true, stdio: "ignore" }); }
    catch { fs.rmSync(marker); return; }
    execFileSync(executable, ["-D", path.join(RUNTIME_DIR, "postgres"), "-m", "fast", "-w", "stop"], { windowsHide: true, stdio: "pipe" });
    fs.rmSync(marker);
    return;
  }
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
    [path.join(E2E_DIR, "lib", "proxy-server.ts"), String(PROXY_PORT), String(TOXIPROXY_PORT)],
    { cwd: E2E_DIR, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT } },
  );
  await waitForUrl(`http://127.0.0.1:${PROXY_PORT}/__e2e/status`, 15_000, "proxy");
}

export async function startToxiproxy() {
  const executable = path.join(E2E_DIR, ".tools", process.platform === "win32" ? "toxiproxy-server.exe" : "toxiproxy-server");
  if (!fs.existsSync(executable)) throw new Error("Run e2e/tools/setup.py --only toxiproxy first");
  spawnLogged("toxiproxy", executable, ["-host", "127.0.0.1", "-port", String(TOXIPROXY_API_PORT)], {
    cwd: E2E_DIR, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
  });
  await waitForUrl(`http://127.0.0.1:${TOXIPROXY_API_PORT}/version`, 15_000, "toxiproxy");
  const response = await fetch(`http://127.0.0.1:${TOXIPROXY_API_PORT}/proxies`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "khaliduo-e2e", listen: `127.0.0.1:${TOXIPROXY_PORT}`, upstream: `127.0.0.1:${API_PORT}`, enabled: true }),
  });
  if (!response.ok) throw new Error(`Toxiproxy setup failed: ${response.status}`);
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
  if (process.platform !== "win32") return;
  const rootLiteral = `'${REPO_DIR.replaceAll("'", "''")}'`;
  const script = `
    foreach ($port in ${API_PORT}, ${PROXY_PORT}, ${WEB_PORT}, ${TOXIPROXY_API_PORT}, ${TOXIPROXY_PORT}) {
      Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)"
        if ($proc.CommandLine -and $proc.CommandLine.IndexOf(${rootLiteral}, [StringComparison]::OrdinalIgnoreCase) -ge 0) { taskkill /PID $_.OwningProcess /T /F | Out-Null; "stopped stray $port ($($_.OwningProcess))" }
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
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid recorded PID");
      // A crashed run's PID can be reused by an unrelated app. Verify ownership
      // from the OS command line before stopping anything recorded on disk.
      const command = process.platform === "win32"
        ? execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`], { encoding: "utf8", windowsHide: true })
        : fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!command.toLowerCase().includes(REPO_DIR.toLowerCase())) throw new Error("Recorded PID is no longer owned by this test stack");
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else process.kill(-pid, "SIGTERM");
      log(`stopped ${name} (pid ${pid})`);
    } catch {
      /* already exited */
    }
  }
  fs.rmSync(PIDS_FILE, { force: true });
}
