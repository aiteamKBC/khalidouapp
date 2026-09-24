// Default idle detection threshold. Kept in sync with the backend policy
// default (backend TrackingSettings.idle_threshold_minutes / config
// DEFAULT_IDLE_THRESHOLD_MINUTES). The backend now reports the company's
// configured value at enrollment; this constant is the shared fallback used
// offline and before the first config sync.
export const IDLE_THRESHOLD_MINUTES = 15;
export const IDLE_THRESHOLD_SECONDS = IDLE_THRESHOLD_MINUTES * 60;
export const BREAK_IDLE_THRESHOLD_MINUTES = 15;
export const BREAK_IDLE_THRESHOLD_SECONDS =
  BREAK_IDLE_THRESHOLD_MINUTES * 60;
export const IDLE_RETURN_VERIFICATION_SECONDS = 3 * 60;
export const IDLE_RETURN_VERIFICATION_MS =
  IDLE_RETURN_VERIFICATION_SECONDS * 1_000;
// The input probe reports once per second, so the Enter/click that confirmed a
// return can still be unreported when tracking resumes. Without this window the
// next 250ms tick sees the old inactivity and opens a second idle popup. It is
// deliberately short: if no trusted input arrives, idle starts again as normal.
export const IDLE_RESUME_GRACE_MS = 5_000;

export function withinIdleResumeGrace(
  resumedAt: number | null,
  now: number,
): boolean {
  return (
    resumedAt !== null && now >= resumedAt && now - resumedAt < IDLE_RESUME_GRACE_MS
  );
}

function configuredIdleThresholdSeconds(thresholdMinutes = IDLE_THRESHOLD_MINUTES) {
  const minutes = Number.isFinite(thresholdMinutes)
    ? Math.max(1, Math.floor(thresholdMinutes))
    : IDLE_THRESHOLD_MINUTES;
  return minutes * 60;
}

export function idleThresholdSeconds(
  insideScheduledBreak = false,
  thresholdMinutes = IDLE_THRESHOLD_MINUTES,
): number {
  // Breaks use the same company policy. Keep the positional flag for existing
  // callers because it also documents why a quiet idle transition is occurring.
  void insideScheduledBreak;
  return configuredIdleThresholdSeconds(thresholdMinutes);
}

export function hasReachedIdleThreshold(
  systemIdleSeconds: number,
  insideScheduledBreak = false,
  thresholdMinutes = IDLE_THRESHOLD_MINUTES,
): boolean {
  return (
    systemIdleSeconds >=
    idleThresholdSeconds(insideScheduledBreak, thresholdMinutes)
  );
}

export function idleDurationAfterThreshold(
  systemIdleSeconds: number,
  insideScheduledBreak = false,
  thresholdMinutes = IDLE_THRESHOLD_MINUTES,
): number {
  return Math.max(
    0,
    Math.floor(systemIdleSeconds) -
      idleThresholdSeconds(insideScheduledBreak, thresholdMinutes),
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
