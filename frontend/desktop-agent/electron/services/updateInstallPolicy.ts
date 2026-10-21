export const UPDATE_INSTALL_RECOVERY_MS = 30_000;

export function shouldClearInstallRecoveryOnBeforeQuit(
  isInstallingUpdate: boolean,
) {
  return !isInstallingUpdate;
}

// No download progress for this long means the download is stuck. Without this
// the status stayed "downloading" forever and every later check short-circuited
// on it, so the device never updated until Khaliduo was restarted.
export const UPDATE_DOWNLOAD_STALL_MS = 10 * 60_000;

// While the server says this build is no longer supported, look for the update
// far more often than the normal 15-minute schedule.
export const REQUIRED_UPDATE_CHECK_INTERVAL_MINUTES = 2;

// Silent installs that failed this many times switch to the visible installer,
// which can show the employee why it cannot finish (and offers Retry) instead of
// quitting without a word.
export const SILENT_INSTALL_ATTEMPTS = 2;

export function updateDownloadStalled(options: {
  status: string;
  lastProgressAt: number | null;
  now: number;
}) {
  if (options.status !== "available" && options.status !== "downloading") {
    return false;
  }
  if (options.lastProgressAt === null) return false;
  return options.now - options.lastProgressAt >= UPDATE_DOWNLOAD_STALL_MS;
}

function versionParts(version: string) {
  return version
    .trim()
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

/** Negative when `left` is older than `right`, 0 when equal, positive when newer. */
export function compareVersions(left: string, right: string) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export type UpdateInstallAttempt = {
  version: string;
  failedAttempts: number;
  attemptedAt: string;
};

/**
 * Read at startup: the app is running again after an install was started, so
 * either the new version is running (it worked) or the old one is (it failed).
 */
export function installAttemptOutcome(
  attempt: UpdateInstallAttempt,
  runningVersion: string,
): "installed" | "failed" {
  return compareVersions(runningVersion, attempt.version) >= 0
    ? "installed"
    : "failed";
}

export function silentInstallAllowed(
  attempt: UpdateInstallAttempt | null,
  version: string | null,
) {
  if (!attempt || !version || attempt.version !== version) return true;
  return attempt.failedAttempts < SILENT_INSTALL_ATTEMPTS;
}
