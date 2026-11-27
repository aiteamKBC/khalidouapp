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

function dayFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  });
}

export function endOfPreviousLocalDayIso(now: Date, timezone: string): string {
  const formatter = dayFormatter(timezone);
  const currentDate = formatter.format(now);
  // Subtracting the displayed hour assumes the UTC offset was constant since
  // midnight. DST days can have 23/25 hours, and Cairo can skip midnight itself.
  // Locate the first instant of this calendar date using the timezone rules.
  let lower = now.getTime() - 48 * 3600_000;
  let upper = now.getTime();
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (formatter.format(new Date(middle)) === currentDate) upper = middle;
    else lower = middle;
  }
  return new Date(upper - 1).toISOString();
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
  const formatter = dayFormatter(timezone);
  const crossesDay = formatter.format(new Date(parsed)) !== formatter.format(new Date(boundaryMs));
  return crossesDay ? new Date(boundaryMs).toISOString() : endedAtIso;
}
