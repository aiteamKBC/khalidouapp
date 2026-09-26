export type IdleRequestAvailability = {
  availableSeconds: number;
};

export function requestableIdleMinutes(
  option: IdleRequestAvailability,
): number {
  return Math.max(0, Math.floor(option.availableSeconds / 60));
}

export function totalRequestableIdleMinutes(
  options: readonly IdleRequestAvailability[],
): number {
  return options.reduce(
    (total, option) => total + requestableIdleMinutes(option),
    0,
  );
}

export type IdleRequestPeriodLike = {
  work_session_id: string;
  started_at: string;
  ended_at: string;
  available_seconds: number;
};

export function idleRequestKey(period: IdleRequestPeriodLike): string {
  return `${period.work_session_id}|${period.started_at}|${period.ended_at}`;
}

// The explainable period that an idle popup refers to: the latest period that
// ended at or after the idle began and still has at least one requestable
// minute. Returns null while it has not synced yet (or was under a minute).
export function idleRequestKeyForIdleStart(
  periods: readonly IdleRequestPeriodLike[],
  idleStartedAt: number,
): string | null {
  const toleranceMs = 5_000;
  let best: IdleRequestPeriodLike | null = null;
  for (const period of periods) {
    if (requestableIdleMinutes({ availableSeconds: period.available_seconds }) < 1) {
      continue;
    }
    const endedAt = Date.parse(period.ended_at);
    if (!Number.isFinite(endedAt) || endedAt < idleStartedAt - toleranceMs) {
      continue;
    }
    if (!best || endedAt > Date.parse(best.ended_at)) best = period;
  }
  return best ? idleRequestKey(best) : null;
}
