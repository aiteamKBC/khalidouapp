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
