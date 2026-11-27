import path from "node:path";
import { execFileSync } from "node:child_process";
import { E2E_DIR, PYTHON, RUNTIME_DIR, backendEnv } from "./env.ts";
import { loadSecrets } from "./stack.ts";

execFileSync(PYTHON, [path.join(E2E_DIR, "tools/postgres_contracts.py")], {
  cwd: RUNTIME_DIR,
  env: { ...backendEnv(loadSecrets()), KHALIDUO_PG_REPORT: process.env.KHALIDUO_PG_REPORT },
  stdio: "inherit", windowsHide: true,
});
