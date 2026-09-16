// The worked-time accumulator runs on a ~1s interval and credits the elapsed
// wall-clock delta since the previous tick. When the process is frozen — system
// sleep, hibernate (S4, which frequently does NOT emit a powerMonitor "resume"
// event), or a severe main-process stall — the next tick observes a delta far
// larger than the interval. That gap is not worked time and must never be
// banked, or a multi-hour hibernation shows up as multi-hour "active" time.
//
// This module isolates the delta decision so it can be unit-tested without the
// Electron runtime.

// A tick delta beyond this bound can only mean the process was frozen, not that
// the user worked. Generous enough to tolerate GC pauses and heavy main-process
// lag (well under a minute), far below any real sleep/hibernate gap (minutes to
// hours), so the two never overlap.
export const MAX_TRACKING_TICK_MS = 60_000;

export type TrackingTickResult = {
  // Seconds to credit for this tick (0 when the gap is discarded or sub-second).
  elapsedSeconds: number;
  // Where the tick pointer should advance to. On a discarded freeze gap this is
  // `nowMs`, so the frozen interval is skipped rather than paid out.
  nextTickMs: number;
};

export function trackingTick(
  previousTickMs: number,
  nowMs: number,
  maxTickMs: number = MAX_TRACKING_TICK_MS,
): TrackingTickResult {
  const rawElapsedMs = nowMs - previousTickMs;
  // Frozen process (suspend/hibernate/stall) or a clock that jumped backwards:
  // discard the gap and re-anchor the pointer to now.
  if (rawElapsedMs < 0 || rawElapsedMs > maxTickMs) {
    return { elapsedSeconds: 0, nextTickMs: nowMs };
  }
  const elapsedSeconds = Math.max(0, Math.floor(rawElapsedMs / 1000));
  return {
    elapsedSeconds,
    // Advance only by whole counted seconds so sub-second remainders carry over.
    nextTickMs: previousTickMs + elapsedSeconds * 1000,
  };
}
