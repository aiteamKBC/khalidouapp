export function mainTimerSeconds(options: {
  isAutomaticIdle: boolean;
  isExtraTime: boolean;
  currentIdleSeconds: number;
  extraSeconds: number;
  trackedTodaySeconds: number;
  // Paid scheduled-break time spent away; payroll pays it, so the paid-shift
  // timer counts it too. Work during a break is already in trackedTodaySeconds.
  paidBreakSeconds?: number;
}) {
  if (options.isAutomaticIdle) {
    return Math.max(0, options.currentIdleSeconds);
  }
  if (options.isExtraTime) {
    return Math.max(0, options.extraSeconds);
  }
  return (
    Math.max(0, options.trackedTodaySeconds) +
    Math.max(0, options.paidBreakSeconds ?? 0)
  );
}

type BreakTimelineInterval = {
  type: string;
  started_at: string;
  duration_seconds: number;
  is_current: boolean;
  break_paid?: boolean | null;
};

/**
 * Paid break time in today's timeline. The current break keeps growing between
 * timeline refreshes, up to the end of the break that is running now; once the
 * break is over, the next refresh turns the rest of the absence into idle.
 */
export function paidBreakSecondsToday(
  intervals: BreakTimelineInterval[],
  nowMs: number,
  runningBreakEndsAtMs: number | null,
) {
  let total = 0;
  for (const interval of intervals) {
    if (interval.type !== "break" || interval.break_paid !== true) continue;
    let seconds = Math.max(0, interval.duration_seconds);
    const startedAtMs = Date.parse(interval.started_at);
    if (
      interval.is_current &&
      runningBreakEndsAtMs !== null &&
      Number.isFinite(startedAtMs)
    ) {
      const liveSeconds = Math.floor(
        (Math.min(nowMs, runningBreakEndsAtMs) - startedAtMs) / 1000,
      );
      seconds = Math.max(seconds, liveSeconds);
    }
    total += seconds;
  }
  return total;
}

export function reconciledNormalTodaySeconds(options: {
  normalSeconds: number;
  extraSeconds: number;
  manualApprovedSeconds: number;
  trackedTodaySeconds: number;
}) {
  const trackedNormalSeconds = Math.max(
    0,
    options.trackedTodaySeconds -
      Math.max(0, options.extraSeconds) -
      Math.max(0, options.manualApprovedSeconds),
  );
  return Math.max(0, options.normalSeconds, trackedNormalSeconds);
}
