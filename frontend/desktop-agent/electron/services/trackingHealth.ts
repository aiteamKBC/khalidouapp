// Read-only presentation and notification policy. This never starts, stops,
// credits, or uploads tracking data.
export const TRACKING_INTERRUPTION_GRACE_MS = 30_000;
export const SYNC_DELAY_WARNING_MS = 5 * 60_000;

export type HealthTone = "ok" | "muted" | "warning" | "error";

export type TrackingSyncSnapshot = {
  databaseReady: boolean;
  pendingEvents: number;
  pendingScreenshots: number;
  pendingSessions: number;
  oldestPendingAt: string | null;
  localCheckpointAt: string | null;
};

export type TrackingHealth = {
  tracking: {
    state: "recording" | "starting" | "paused" | "away" | "interrupted";
    tone: HealthTone;
    label: string;
    detail: string;
  };
  sync: {
    state: "synced" | "pending" | "offline" | "delayed" | "checking" | "unavailable";
    tone: HealthTone;
    label: string;
    detail: string;
  };
  pendingEvents: number;
  pendingScreenshots: number;
  pendingSessions: number;
  localCheckpointAt: string | null;
  lastServerContactAt: string | null;
  alerts: Array<{ key: string; title: string; body: string }>;
};

export type TrackingHealthInput = {
  identityKey: string;
  enrolled: boolean;
  trackingExpected: boolean;
  trackingPaused: boolean;
  trackingStatus: string;
  trackingMovedToDevice?: string | null;
  hasTrackingSession: boolean;
  lastTrackingTickAgeMs: number | null;
  connectionStatus: "online" | "offline";
  lastSuccessfulSyncAt: string | null;
  sync: TrackingSyncSnapshot;
};

function timestampAge(value: string | null, nowMs: number): number | null {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? Math.max(0, nowMs - timestamp) : null;
}

export class TrackingHealthMonitor {
  private identityKey: string | null = null;
  private interruptedSince: number | null = null;
  private unconfirmedSince: number | null = null;
  private notified = new Set<string>();

  sample(input: TrackingHealthInput, nowMs: number, elapsedMs: number): TrackingHealth {
    if (input.identityKey !== this.identityKey || !input.enrolled) {
      this.identityKey = input.identityKey;
      this.interruptedSince = null;
      this.unconfirmedSince = null;
      this.notified.clear();
    }
    const away = ["idle", "locked", "sleeping"].includes(input.trackingStatus);
    const recordingState = ["active", "starting"].includes(input.trackingStatus);
    const expected = input.enrolled && input.trackingExpected && !input.trackingPaused && !away;
    const stalled = recordingState && input.lastTrackingTickAgeMs !== null &&
      input.lastTrackingTickAgeMs >= TRACKING_INTERRUPTION_GRACE_MS;
    const interrupted = expected && (
      !input.hasTrackingSession || !recordingState || stalled || input.lastTrackingTickAgeMs === null
    );
    this.interruptedSince = interrupted ? (this.interruptedSince ?? elapsedMs) : null;
    const interruptionConfirmed = this.interruptedSince !== null &&
      (stalled || elapsedMs - this.interruptedSince >= TRACKING_INTERRUPTION_GRACE_MS);

    let tracking: TrackingHealth["tracking"];
    if (input.trackingMovedToDevice) {
      tracking = { state: "paused", tone: "muted", label: "Recording on another device", detail: `Work is being tracked on ${input.trackingMovedToDevice}.` };
    } else if (input.trackingPaused || input.trackingStatus === "paused") {
      tracking = { state: "paused", tone: "muted", label: "Recording paused", detail: "Resume the timer when you are ready to work." };
    } else if (away || !input.trackingExpected) {
      tracking = { state: "away", tone: "muted", label: away ? "Away from work" : "Waiting for activity", detail: "Idle, lock, sleep and break rules still apply to your time." };
    } else if (interruptionConfirmed) {
      tracking = { state: "interrupted", tone: "error", label: "Recording needs attention", detail: "The timer is not recording work as expected. Check Khaliduo before continuing." };
    } else if (interrupted || !input.enrolled) {
      tracking = { state: "starting", tone: "muted", label: "Starting recording", detail: "Waiting for the work timer to become ready." };
    } else {
      tracking = { state: "recording", tone: "ok", label: "Recording your work", detail: "Your work timer is running on this device." };
    }

    const pending = input.sync.pendingEvents + input.sync.pendingScreenshots + input.sync.pendingSessions;
    const contactAge = timestampAge(input.lastSuccessfulSyncAt, nowMs);
    const pendingAge = timestampAge(input.sync.oldestPendingAt, nowMs);
    const unconfirmed = input.enrolled && (input.connectionStatus === "offline" || contactAge === null);
    this.unconfirmedSince = unconfirmed ? (this.unconfirmedSince ?? elapsedMs) : null;
    const needsConfirmation = pending > 0 || expected;
    const delayed = (pending > 0 && pendingAge !== null && pendingAge >= SYNC_DELAY_WARNING_MS) ||
      (needsConfirmation && contactAge !== null && contactAge >= SYNC_DELAY_WARNING_MS) ||
      (needsConfirmation && this.unconfirmedSince !== null && elapsedMs - this.unconfirmedSince >= SYNC_DELAY_WARNING_MS);

    let sync: TrackingHealth["sync"];
    if (!input.sync.databaseReady) {
      sync = { state: "unavailable", tone: "error", label: "Local storage unavailable", detail: "Saved activity could not be checked. Open Khaliduo and contact support if this continues." };
    } else if (delayed) {
      sync = { state: "delayed", tone: "warning", label: "Sync is delayed", detail: pending > 0 ? "Saved activity is still waiting to upload. Automatic retries continue." : "There is no recent server confirmation. Check your connection or try syncing now." };
    } else if (pending > 0) {
      const recentLocalSave = timestampAge(input.sync.localCheckpointAt, nowMs);
      sync = { state: "pending", tone: "warning", label: recentLocalSave !== null && recentLocalSave < TRACKING_INTERRUPTION_GRACE_MS ? "Saved on this device" : "Activity waiting to sync", detail: "Saved activity will upload automatically when the server accepts it." };
    } else if (input.connectionStatus === "offline") {
      sync = { state: "offline", tone: "warning", label: "Server unreachable", detail: "The server cannot be reached. Khaliduo will retry automatically." };
    } else if (contactAge === null) {
      sync = { state: "checking", tone: "muted", label: "Waiting for sync", detail: "Waiting for the first successful server connection." };
    } else if (contactAge >= SYNC_DELAY_WARNING_MS) {
      sync = { state: "checking", tone: "muted", label: "No pending uploads", detail: "No saved activity is waiting. The last server contact is shown below." };
    } else {
      sync = { state: "synced", tone: "ok", label: "Up to date", detail: "No saved activity is waiting to upload." };
    }

    const alerts: TrackingHealth["alerts"] = [];
    if (input.enrolled && tracking.state === "interrupted") {
      alerts.push({ key: "tracking_interrupted", title: "Work recording needs attention", body: tracking.detail });
    }
    if (input.enrolled && sync.state === "unavailable") {
      alerts.push({ key: "local_storage_unavailable", title: sync.label, body: sync.detail });
    }
    if (input.enrolled && sync.state === "delayed") {
      alerts.push({ key: "sync_delayed", title: "Khaliduo sync is delayed", body: sync.detail });
    }
    const activeKeys = new Set(alerts.map((alert) => alert.key));
    for (const key of this.notified) {
      if (!activeKeys.has(key)) this.notified.delete(key);
    }
    return {
      tracking, sync, alerts,
      pendingEvents: input.sync.pendingEvents,
      pendingScreenshots: input.sync.pendingScreenshots,
      pendingSessions: input.sync.pendingSessions,
      localCheckpointAt: input.sync.localCheckpointAt,
      lastServerContactAt: input.lastSuccessfulSyncAt,
    };
  }

  takeNotification(health: TrackingHealth): TrackingHealth["alerts"][number] | null {
    const alert = health.alerts.find((item) => !this.notified.has(item.key));
    if (!alert) return null;
    this.notified.add(alert.key);
    return alert;
  }
}
