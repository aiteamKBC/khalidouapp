export const IDLE_THRESHOLD_MINUTES = 10;
export const IDLE_THRESHOLD_SECONDS = IDLE_THRESHOLD_MINUTES * 60;
export const BREAK_IDLE_THRESHOLD_MINUTES = 3;
export const BREAK_IDLE_THRESHOLD_SECONDS =
  BREAK_IDLE_THRESHOLD_MINUTES * 60;

export function idleThresholdSeconds(insideScheduledBreak = false): number {
  return insideScheduledBreak
    ? BREAK_IDLE_THRESHOLD_SECONDS
    : IDLE_THRESHOLD_SECONDS;
}

export function hasReachedIdleThreshold(
  systemIdleSeconds: number,
  insideScheduledBreak = false,
): boolean {
  return systemIdleSeconds >= idleThresholdSeconds(insideScheduledBreak);
}

export function idleDurationAfterThreshold(
  systemIdleSeconds: number,
  insideScheduledBreak = false,
): number {
  return Math.max(
    0,
    Math.floor(systemIdleSeconds) - idleThresholdSeconds(insideScheduledBreak),
  );
}

export function inputResumedAfterIdle(
  systemIdleSeconds: number,
  previousSystemIdleSeconds: number | null,
): boolean {
  return (
    systemIdleSeconds <= 1 ||
    (previousSystemIdleSeconds !== null &&
      systemIdleSeconds < previousSystemIdleSeconds)
  );
}

export function shouldWaitForInputBeforeRestart(
  trackingStatus: string,
  serverSessionEnded: boolean,
): trackingStatus is "idle" | "locked" | "sleeping" {
  return (
    serverSessionEnded &&
    ["idle", "locked", "sleeping"].includes(trackingStatus)
  );
}
