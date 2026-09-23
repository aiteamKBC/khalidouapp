// Breaks either run at fixed clock times or start at that day's adhan
// ("dhuhr" / "asr") and last `minutes`; the server works out the times daily.

export type BreakAnchor = "fixed" | "dhuhr" | "asr";

export type PrayerTimesDay = { date: string; dhuhr: string; asr: string };

export const BREAK_ANCHOR_LABELS: Record<BreakAnchor, string> = {
  fixed: "Fixed time",
  dhuhr: "Dhuhr adhan",
  asr: "Asr adhan",
};

export function isPrayerAnchor(anchor?: string | null): anchor is "dhuhr" | "asr" {
  return anchor === "dhuhr" || anchor === "asr";
}

export function addMinutesToClock(clock: string, minutes: number) {
  const [hours, mins] = clock.split(":").map(Number);
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Start and end clock times for a break on a day with the given prayer times. */
export function breakWindow(
  rule: {
    anchor?: string | null;
    minutes: number;
    start_time?: string | null;
    end_time?: string | null;
  },
  prayer?: PrayerTimesDay | null,
): { start: string; end: string } | null {
  if (isPrayerAnchor(rule.anchor)) {
    const start = prayer?.[rule.anchor];
    return start ? { start, end: addMinutesToClock(start, rule.minutes) } : null;
  }
  if (!rule.start_time || !rule.end_time) return null;
  return { start: rule.start_time.slice(0, 5), end: rule.end_time.slice(0, 5) };
}

/** "After Dhuhr adhan · 30 min (today 12:48–13:18)" or "13:00–13:30 · 30 min". */
export function describeBreakTiming(
  rule: {
    anchor?: string | null;
    minutes: number;
    start_time?: string | null;
    end_time?: string | null;
  },
  prayer?: PrayerTimesDay | null,
) {
  const window = breakWindow(rule, prayer);
  if (isPrayerAnchor(rule.anchor)) {
    const base = `From ${BREAK_ANCHOR_LABELS[rule.anchor]} · ${rule.minutes} min`;
    return window ? `${base} (today ${window.start}–${window.end})` : base;
  }
  return `${window ? `${window.start}–${window.end}` : "—"} · ${rule.minutes} min`;
}
