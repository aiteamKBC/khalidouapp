// Pure helpers for scheduled-break presentation. Idle inside a scheduled break
// is paid break time, not accountable idle, so the visible idle counter must
// only grow outside break windows.

export type BreakWindow = { name: string; startMs: number; endMs: number };

/** Seconds of [idleStartMs, nowMs] that fall outside every break window. */
export function idleSecondsOutsideBreaks(
  idleStartMs: number,
  nowMs: number,
  windows: BreakWindow[],
): number {
  if (!(nowMs > idleStartMs)) return 0;
  let excludedMs = 0;
  // Windows of one day never overlap each other (the backend validates break
  // rules), so overlaps can be summed directly.
  for (const window of windows) {
    const start = Math.max(idleStartMs, window.startMs);
    const end = Math.min(nowMs, window.endMs);
    if (end > start) excludedMs += end - start;
  }
  return Math.max(0, Math.floor((nowMs - idleStartMs - excludedMs) / 1000));
}

/** The break window containing `atMs`, if any. */
export function breakWindowAt(
  atMs: number,
  windows: BreakWindow[],
): BreakWindow | null {
  return windows.find((window) => atMs >= window.startMs && atMs < window.endMs) ?? null;
}
