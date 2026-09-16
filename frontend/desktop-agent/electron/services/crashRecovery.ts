export const MAX_CRASH_RECOVERY_ATTEMPTS = 3;
export const CRASH_RECOVERY_STABLE_MS = 5 * 60_000;

const RECOVERY_ARGUMENT_PREFIX = "--crash-recovery-attempt=";

export function crashRecoveryAttempt(argv: string[]): number {
  const raw = argv.find((value) => value.startsWith(RECOVERY_ARGUMENT_PREFIX));
  if (!raw) return 0;
  const parsed = Number.parseInt(raw.slice(RECOVERY_ARGUMENT_PREFIX.length), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function isCrashRecoveryLaunch(argv: string[]): boolean {
  return argv.some((value) => value.startsWith(RECOVERY_ARGUMENT_PREFIX));
}

export function shouldRestartAfterCrash(attempt: number): boolean {
  return attempt < MAX_CRASH_RECOVERY_ATTEMPTS;
}

export function nextCrashRecoveryArgument(attempt: number): string {
  return `${RECOVERY_ARGUMENT_PREFIX}${Math.max(0, attempt) + 1}`;
}

/**
 * After a watchdog relaunch, decide whether to continue into normal startup (so
 * the server is consulted and the interrupted session is recovered) or exit.
 *
 * The previous gate required an OPEN LOCAL-ONLY session and exited otherwise —
 * but a normal online session has no such row (its local row is marked synced),
 * so online tracking never recovered after a crash. Continue whenever the device
 * is still enrolled and the employee had not explicitly stopped tracking; normal
 * startup then reconciles both online and local-only interrupted work with the
 * server. Only a not-enrolled device (e.g. after logout) or an explicit stop has
 * genuinely nothing to recover.
 */
export function crashRecoveryShouldContinue(input: {
  enrolled: boolean;
  hasDeviceId: boolean;
  trackingStoppedByUser: boolean;
}): boolean {
  if (!input.enrolled || !input.hasDeviceId) return false;
  if (input.trackingStoppedByUser) return false;
  return true;
}
