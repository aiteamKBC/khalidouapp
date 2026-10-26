export const BREAK_WARNING_SECONDS = 45 * 60;
export const BREAK_END_SECONDS = 60 * 60;

export function timedBreakState(startedAt: string | null | undefined, now = Date.now(), accumulatedSeconds = 0) {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const running = Number.isFinite(start);
  const savedSeconds = Number.isSafeInteger(accumulatedSeconds) ? Math.max(0, accumulatedSeconds) : 0;
  if (!running && savedSeconds === 0) return null;
  const seconds = savedSeconds + (running ? Math.max(0, Math.floor((now - start) / 1000)) : 0);
  return {
    running,
    seconds,
    warning: seconds >= BREAK_WARNING_SECONDS,
    expired: seconds >= BREAK_END_SECONDS,
    remainingSeconds: Math.max(0, BREAK_END_SECONDS - seconds),
  };
}
