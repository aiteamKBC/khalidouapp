import { apiFetch } from "./client";
import type { TrackingSettings } from "@/types";

type BackendTrackingSettings = {
  screenshot_enabled: boolean;
  screenshot_interval_minutes: number;
  screenshots_per_interval: number;
  idle_threshold_minutes: number;
  capture_during_idle: boolean;
  offline_threshold_minutes: number;
  screenshot_retention_days: number;
};

function mapSettings(settings: BackendTrackingSettings): TrackingSettings {
  return {
    screenshotsEnabled: settings.screenshot_enabled,
    screenshotIntervalMinutes:
      settings.screenshot_interval_minutes as TrackingSettings["screenshotIntervalMinutes"],
    screenshotsPerInterval: settings.screenshots_per_interval,
    idleThresholdMinutes: settings.idle_threshold_minutes,
    captureDuringIdle: settings.capture_during_idle,
    offlineThresholdMinutes: settings.offline_threshold_minutes,
    screenshotRetentionDays: settings.screenshot_retention_days,
  };
}

export async function getTrackingSettings(): Promise<TrackingSettings> {
  return mapSettings(await apiFetch<BackendTrackingSettings>("/settings/tracking"));
}

export async function updateTrackingSettings(next: TrackingSettings): Promise<TrackingSettings> {
  return mapSettings(
    await apiFetch<BackendTrackingSettings>("/settings/tracking", {
      method: "PATCH",
      body: JSON.stringify({
        screenshot_enabled: next.screenshotsEnabled,
        screenshot_interval_minutes: next.screenshotIntervalMinutes,
        screenshots_per_interval: next.screenshotsPerInterval,
        idle_threshold_minutes: next.idleThresholdMinutes,
        capture_during_idle: next.captureDuringIdle,
        offline_threshold_minutes: next.offlineThresholdMinutes,
        screenshot_retention_days: next.screenshotRetentionDays,
      }),
    }),
  );
}
