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
