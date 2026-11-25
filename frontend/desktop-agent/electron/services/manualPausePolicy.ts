export const PAUSE_REMINDER_DELAY_MS = 2 * 60_000;
export const PAUSE_REMINDER_REPEAT_MS = 15 * 60_000;
const RECENT_INPUT_MS = 5_000;

// Input during an explicit Pause is a reason to ask, never permission to
// resume tracking or retrospectively credit the paused interval.
export class ManualPauseReminder {
  private startedAt: number | null = null;
  private remindedAt: number | null = null;

  reset() {
    this.startedAt = null;
    this.remindedAt = null;
  }

  shouldRemind(options: {
    paused: boolean;
    canPrompt: boolean;
    latestInputAt: number | null;
    now: number;
  }): boolean {
    if (!options.paused) {
      this.reset();
      return false;
    }
    this.startedAt ??= options.now;
    const inputAt = options.latestInputAt;
    if (
      !options.canPrompt ||
      inputAt === null ||
      inputAt < this.startedAt ||
      inputAt > options.now ||
      options.now - inputAt > RECENT_INPUT_MS
    ) {
      return false;
    }
    const since = this.remindedAt ?? this.startedAt;
    const delay =
      this.remindedAt === null ? PAUSE_REMINDER_DELAY_MS : PAUSE_REMINDER_REPEAT_MS;
    if (options.now - since < delay) return false;
    this.remindedAt = options.now;
    return true;
  }
}

export type ManualPauseSource = "tracker_control" | "tray" | "window_close" | "idle_alert";

export function manualPauseEventDetails(
  options?: string | { source?: ManualPauseSource; reason?: string },
) {
  const supplied = options && typeof options === "object" ? options : undefined;
  const reason = typeof options === "string" ? options : supplied?.reason;
  return {
    source: supplied?.source ?? "tracker_control",
    reason: typeof reason === "string" && reason.trim()
      ? reason.trim().slice(0, 500)
      : "Employee paused tracking",
  };
}
