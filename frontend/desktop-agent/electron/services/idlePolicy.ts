export const IDLE_THRESHOLD_MINUTES = 10;
export const IDLE_THRESHOLD_SECONDS = IDLE_THRESHOLD_MINUTES * 60;
export const BREAK_IDLE_THRESHOLD_MINUTES = 3;
export const BREAK_IDLE_THRESHOLD_SECONDS =
  BREAK_IDLE_THRESHOLD_MINUTES * 60;
export const IDLE_RETURN_VERIFICATION_SECONDS = 3 * 60;
export const IDLE_RETURN_VERIFICATION_MS =
  IDLE_RETURN_VERIFICATION_SECONDS * 1_000;

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

export function idleReturnInputDetected(options: {
  latestRealInputAt: number | null;
  lastHandledRealInputAt: number;
  systemIdleSeconds: number;
  previousSystemIdleSeconds: number | null;
}): boolean {
  const freshRealInput =
    options.latestRealInputAt !== null &&
    options.latestRealInputAt > options.lastHandledRealInputAt;

  // The low-level probe can keep reporting while one of its Windows hooks is
  // no longer delivering events. A stale keyboard timestamp must not suppress
  // the operating-system idle-clock fallback for a later physical mouse move.
  // This path only opens the return review; it never credits time by itself.
  return (
    freshRealInput ||
    inputResumedAfterIdle(
      options.systemIdleSeconds,
      options.previousSystemIdleSeconds,
    )
  );
}

export function automaticIdleReturnAction(options: {
  trackingStatus: string;
  immediateInputDetected: boolean;
  confirmationAccepted: boolean;
  sustainedInputConfirmed: boolean;
}): "wait" | "review" | "verify" | "resume" {
  if (options.trackingStatus !== "idle") {
    return "wait";
  }
  if (options.confirmationAccepted || options.sustainedInputConfirmed) {
    return "resume";
  }
  return options.immediateInputDetected ? "review" : "wait";
}

export function idleReturnVerificationExpired(
  startedAt: number,
  now: number,
) {
  return now - startedAt >= IDLE_RETURN_VERIFICATION_MS;
}

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function reclassifyVerifiedReturnCounters(options: {
  activeSeconds: number;
  idleSeconds: number;
  eligibleIdleSeconds: number;
  idleSecondsAtVerificationStart: number;
  eligibleIdleSecondsAtVerificationStart: number;
  verifiedSeconds: number;
}) {
  const verifiedSeconds = nonNegativeInteger(options.verifiedSeconds);
  const activeSeconds = nonNegativeInteger(options.activeSeconds);
  const idleSeconds = nonNegativeInteger(options.idleSeconds);
  const eligibleIdleSeconds = nonNegativeInteger(
    options.eligibleIdleSeconds,
  );
  const idleDelta = Math.max(
    0,
    idleSeconds -
      nonNegativeInteger(options.idleSecondsAtVerificationStart),
  );
  const eligibleIdleDelta = Math.max(
    0,
    eligibleIdleSeconds -
      nonNegativeInteger(options.eligibleIdleSecondsAtVerificationStart),
  );
  return {
    activeSeconds: activeSeconds + verifiedSeconds,
    idleSeconds: idleSeconds - Math.min(idleDelta, verifiedSeconds),
    eligibleIdleSeconds:
      eligibleIdleSeconds -
      Math.min(eligibleIdleDelta, verifiedSeconds),
  };
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
