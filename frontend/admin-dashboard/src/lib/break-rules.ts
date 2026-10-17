// Breaks run at fixed clock times set on the Breaks page. Older data may still
// carry an "anchor" field from when breaks followed the prayer times.

export type BreakAnchor = "fixed" | "dhuhr" | "asr";

/** Start and end clock times of a fixed-time break. */
export function breakWindow(rule: {
  start_time?: string | null;
  end_time?: string | null;
}): { start: string; end: string } | null {
  if (!rule.start_time || !rule.end_time) return null;
  return { start: rule.start_time.slice(0, 5), end: rule.end_time.slice(0, 5) };
}

/** "13:00–13:30 · 30 min". */
export function describeBreakTiming(rule: {
  minutes: number;
  start_time?: string | null;
  end_time?: string | null;
}) {
  const window = breakWindow(rule);
  return `${window ? `${window.start}–${window.end}` : "—"} · ${rule.minutes} min`;
}
