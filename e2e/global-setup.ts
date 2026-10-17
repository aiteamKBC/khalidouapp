import fs from "node:fs";
import { SEED_FILE } from "./lib/env.ts";
import {
  createSecrets,
  freshRuntimeDir,
  killRecorded,
  killStrayServers,
  migrate,
  seed,
  startBackend,
  startDatabase,
  startProxy,
  startWebsite,
} from "./lib/stack.ts";

export default async function globalSetup() {
  // E2E_REUSE_STACK=1: iterate against a stack already started with `node lib/up.ts`.
  if (process.env.E2E_REUSE_STACK === "1") {
    if (!fs.existsSync(SEED_FILE)) throw new Error("E2E_REUSE_STACK=1 but no stack is up (run node lib/up.ts).");
    return;
  }
  // A previous run that crashed can leave servers holding the test ports.
  killRecorded();
  killStrayServers();
  freshRuntimeDir();
  const secrets = createSecrets();
  startDatabase();
  migrate(secrets);
  seed(secrets);
  await startBackend(secrets);
  await startProxy();
  await startWebsite();
}
