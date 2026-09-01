import { spawn } from "node:child_process";

import {
  nextCrashRecoveryArgument,
  shouldRestartAfterCrash,
} from "./services/crashRecovery.js";

const executablePath = process.argv[2];
const parentPid = Number.parseInt(process.argv[3] ?? "", 10);
let recoveryAttempt = Number.parseInt(process.argv[4] ?? "0", 10) || 0;
let stopping = false;
let recoveryStarted = false;

function exitCleanly() {
  stopping = true;
  process.exit(0);
}

function recover() {
  if (stopping || recoveryStarted) return;
  recoveryStarted = true;
  if (!executablePath || !shouldRestartAfterCrash(recoveryAttempt)) {
    process.exit(0);
    return;
  }

  setTimeout(() => {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    try {
      const child = spawn(
        executablePath,
        [nextCrashRecoveryArgument(recoveryAttempt)],
        {
          detached: true,
          env: environment,
          stdio: "ignore",
          windowsHide: true,
        },
      );
      child.unref();
    } finally {
      process.exit(0);
    }
  }, 2_000);
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  const type = (message as { type?: unknown }).type;
  if (type === "stop") {
    exitCleanly();
  } else if (type === "stable") {
    recoveryAttempt = 0;
  }
});
process.on("disconnect", recover);
process.on("SIGTERM", exitCleanly);

const parentProbe = setInterval(() => {
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    recover();
    return;
  }
  try {
    process.kill(parentPid, 0);
  } catch {
    recover();
  }
}, 5_000);
parentProbe.unref();
