const DEFAULT_IDLE_THRESHOLD_MINUTES = 15;

function hasReachedIdleThreshold(systemIdleSeconds: number, thresholdMinutes = 15) {
  const minutes = Number.isFinite(thresholdMinutes)
    ? Math.max(1, Math.floor(thresholdMinutes))
    : DEFAULT_IDLE_THRESHOLD_MINUTES;
  return systemIdleSeconds >= minutes * 60;
}

export type RuntimeTrackingStatus =
  | "starting"
  | "active"
  | "idle"
  | "locked"
  | "sleeping"
  | "paused"
  | "offline"
  | "error";

export type RuntimeConnectionStatus = "online" | "offline";

/**
 * An HTTP response proves that the API is reachable, even when that response
 * rejects an individual queued item. Only failures without a response are
 * network/offline failures.
 */
export function connectionStatusAfterApiFailure(
  responseStatus?: number,
): RuntimeConnectionStatus {
  return responseStatus === undefined ? "offline" : "online";
}

/**
 * These screenshot requests cannot become valid by retrying the same payload.
 * Authentication and server failures remain retryable so a repaired identity
 * or recovered service can still upload the locally preserved image.
 */
export function isPermanentScreenshotSyncFailure(options: {
  responseStatus?: number;
  apiErrorCode?: string;
}): boolean {
  if (options.apiErrorCode === "SCREENSHOT_AC_POWER_REQUIRED") {
    return true;
  }
  return (
    options.responseStatus !== undefined &&
    [400, 403, 404, 413, 422].includes(options.responseStatus)
  );
}

export function screenshotCaptureBlockReasonForState(options: {
  enrolled: boolean;
  screenshotsEnabled: boolean;
  hasActiveSession: boolean;
  // Only the employee's manual "Pause" blocks capture. Sign-out/stop and paid
  // pauses also mark tracking as paused, but workplace screenshot monitoring is
  // an independent company policy and deliberately continues in those states,
  // so this signal is intentionally narrower than a generic "trackingPaused".
  manualPauseActive: boolean;
  onAcPower: boolean;
  trackingStatus: RuntimeTrackingStatus;
  systemIdleSeconds: number;
  idleThresholdMinutes?: number;
}): string | null {
  if (!options.enrolled) return "device_not_enrolled";
  if (!options.screenshotsEnabled) return "capture_disabled";
  if (!options.hasActiveSession) return "no_active_session";
  if (options.manualPauseActive) return "tracking_paused";
  if (!options.onAcPower) return "battery_power";
  if (options.trackingStatus === "locked") return "screen_locked";
  if (options.trackingStatus === "sleeping") return "system_sleeping";
  if (
    options.trackingStatus === "idle" ||
    hasReachedIdleThreshold(
      options.systemIdleSeconds,
      options.idleThresholdMinutes,
    )
  ) {
    return "no_user_activity";
  }
  return null;
}
