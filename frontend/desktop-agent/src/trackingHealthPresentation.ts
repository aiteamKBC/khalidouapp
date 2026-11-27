import type { TrackingHealth } from "../electron/services/trackingHealth";

export const STATUS_CONFIRMATION_TIMEOUT_MS = 30_000;

/** A stale IPC snapshot cannot confirm that recording or uploading continues. */
export function unconfirmedTrackingHealth(previous: TrackingHealth): TrackingHealth {
  return {
    ...previous,
    tracking: {
      state: "interrupted",
      tone: "error",
      label: "Recording status unavailable",
      detail: "The timer status has not been confirmed for 30 seconds. Check Khaliduo before continuing.",
    },
    sync: {
      state: "checking",
      tone: "warning",
      label: "Waiting for app response",
      detail: "The latest recording and upload status could not be checked.",
    },
    alerts: [],
  };
}
