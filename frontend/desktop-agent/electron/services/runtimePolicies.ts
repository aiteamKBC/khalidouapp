const IDLE_THRESHOLD_SECONDS = 10 * 60;

function hasReachedIdleThreshold(systemIdleSeconds: number) {
  return systemIdleSeconds >= IDLE_THRESHOLD_SECONDS;
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
  trackingPaused: boolean;
  onAcPower: boolean;
  trackingStatus: RuntimeTrackingStatus;
  systemIdleSeconds: number;
}): string | null {
  if (!options.enrolled) return "device_not_enrolled";
  if (!options.screenshotsEnabled) return "capture_disabled";
  if (!options.hasActiveSession) return "no_active_session";
  if (options.trackingPaused) return "tracking_paused";
  if (!options.onAcPower) return "battery_power";
  if (options.trackingStatus === "locked") return "screen_locked";
  if (options.trackingStatus === "sleeping") return "system_sleeping";
  if (
    options.trackingStatus === "idle" ||
    hasReachedIdleThreshold(options.systemIdleSeconds)
  ) {
    return "no_user_activity";
  }
  return null;
}
