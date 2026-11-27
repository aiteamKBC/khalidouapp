import path from "node:path";
import { execFileSync } from "node:child_process";
import { E2E_DIR, PYTHON, RUNTIME_DIR, backendEnv } from "./env.ts";
import { loadSecrets } from "./stack.ts";

const fixture = path.join(RUNTIME_DIR, "load-fixture.json");
const env = { ...backendEnv(loadSecrets()), KHALIDUO_LOAD_FIXTURE: fixture, KHALIDUO_LOAD_USERS: "20" };
execFileSync(PYTHON, [path.join(E2E_DIR, "seed/seed_load.py")], { cwd: RUNTIME_DIR, env, stdio: "inherit", windowsHide: true });
execFileSync(path.join(E2E_DIR, ".tools", process.platform === "win32" ? "k6.exe" : "k6"), [
  "run", "--summary-export", process.env.KHALIDUO_K6_REPORT || path.join(RUNTIME_DIR, "k6-summary.json"),
  path.join(E2E_DIR, "load/tracking.js"),
], {
  cwd: E2E_DIR,
  env: { ...process.env, KHALIDUO_LOAD_FIXTURE: fixture },
  stdio: "inherit", windowsHide: true,
});
