// Server UTC plus elapsed monotonic time keeps a Windows clock correction from
// moving the employee into yesterday/tomorrow or inventing tracked hours. This
// module also runs in the renderer, calibrated from main-process status updates.
export class TrackingClock {
  private wallNow: () => number;
  private monotonicNow: () => number;
  private anchor: { utcMs: number; monotonicMs: number } | null = null;
  private elapsedAnchor: { utcMs: number; monotonicMs: number };

  constructor(
    wallNow: () => number = () => Date.now(),
    monotonicNow: () => number = () => performance.now(),
  ) {
    this.wallNow = wallNow;
    this.monotonicNow = monotonicNow;
    this.elapsedAnchor = { utcMs: wallNow(), monotonicMs: monotonicNow() };
  }

  // Durations must never use calibrated UTC: the first server response can
  // correct a wrong PC clock by seconds or days while a timer is running.
  elapsedMs(): number {
    return this.elapsedAnchor.utcMs + Math.max(0, this.monotonicNow() - this.elapsedAnchor.monotonicMs);
  }

  nowMs(): number {
    return this.anchor
      ? this.anchor.utcMs + Math.max(0, this.monotonicNow() - this.anchor.monotonicMs)
      : this.wallNow();
  }

  get synchronized(): boolean {
    return this.anchor !== null;
  }

  observeServerTime(value: unknown): boolean {
    if (typeof value !== "string") return false;
    const utcMs = Date.parse(value);
    if (!Number.isFinite(utcMs)) return false;
    // A slow response or an older IPC snapshot can arrive after a newer one.
    // It must not rewind the day or the timer after the first calibration.
    if (this.anchor && utcMs < this.nowMs() - 5_000) return false;
    // HTTP Date has one-second precision. Keep the monotonic anchor through
    // normal response jitter instead of repeatedly moving timers backwards.
    if (!this.anchor || utcMs - this.nowMs() > 5_000) {
      this.anchor = { utcMs, monotonicMs: this.monotonicNow() };
    }
    return true;
  }
}

const trackingClock = new TrackingClock();
export const trackingNowMs = () => trackingClock.nowMs();
export const trackingElapsedMs = () => trackingClock.elapsedMs();
export const trackingNowDate = () => new Date(trackingNowMs());
export const observeServerTime = (value: unknown) => trackingClock.observeServerTime(value);
export const trackingClockSynchronized = () => trackingClock.synchronized;
