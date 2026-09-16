// When a local (offline) tracking session is still open as the clock crosses
// into a new local day, it must be closed and recovered into YESTERDAY's ledger.
// Closing it — and later submitting its counters — at the first next-day tick
// (e.g. 00:00:00.250) makes the backend take its "new local workday" rollover
// branch, which closes the session before applying the counters and discards
// the offline work entirely.
//
// This computes the last instant of the previous local day for the given
// timezone, so the rollover close (and the recovery heartbeat/end that follows)
// stay inside the session's own day and the backend credits the work there.
// Clamping to exactly midnight is NOT enough: the midnight instant already
// belongs to the new day, so it still trips the next-day branch.

function localTimeParts(atMs: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone || "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(atMs));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { hour: value("hour"), minute: value("minute"), second: value("second") };
}

export function endOfPreviousLocalDayIso(now: Date, timezone: string): string {
  const { hour, minute, second } = localTimeParts(now.getTime(), timezone);
  // Milliseconds are timezone-independent, so the runtime ms component is exact.
  const millisecondsIntoLocalDay =
    ((hour * 60 + minute) * 60 + second) * 1000 + now.getMilliseconds();
  const startOfLocalDay = now.getTime() - millisecondsIntoLocalDay;
  // One millisecond before the new local day begins is the last instant that
  // still belongs to the previous local day.
  return new Date(startOfLocalDay - 1).toISOString();
}

export function recoveryEndTimestampIso(
  endedAtIso: string,
  timezone: string,
): string {
  // A daily-rollover session is bounded to the last instant of its local day
  // (…23:59:59.999) so the recovery HEARTBEAT stays inside that day — a heartbeat
  // at or past midnight takes the backend's "new local workday" branch, which
  // closes the session before applying its counters and discards the offline work.
  // The session's TRUE end, however, is the day boundary itself (the next local
  // midnight). end_session has no rollover branch and caps active_seconds at
  // floor(elapsed_seconds); ending at …23:59:59.999 therefore loses the final
  // whole second (e.g. 3599 credited for a genuine 3600). When endedAt is exactly
  // the last instant of its local day, return the day boundary (next local
  // midnight) so the END call credits that final second. The session still belongs
  // to the previous day because workday membership is keyed on started_at, not
  // ended_at. Any other end timestamp (a mid-day checkpoint bound or a normal
  // stop) is returned unchanged.
  const parsed = Date.parse(endedAtIso);
  if (Number.isNaN(parsed)) {
    return endedAtIso;
  }
  const boundaryMs = parsed + 1;
  const { hour, minute, second } = localTimeParts(boundaryMs, timezone);
  const atLocalMidnight =
    hour === 0 &&
    minute === 0 &&
    second === 0 &&
    new Date(boundaryMs).getMilliseconds() === 0;
  return atLocalMidnight ? new Date(boundaryMs).toISOString() : endedAtIso;
}
