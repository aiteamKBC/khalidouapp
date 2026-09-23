// Today's scheduled breaks for display. Prayer-anchored breaks ("dhuhr" /
// "asr") arrive from the server with that day's start and end already filled.

export type BreakRuleLike = {
  name: string;
  minutes: number;
  paid: boolean;
  start_time?: string | null;
  end_time?: string | null;
  anchor?: string | null;
};

export type TodayBreak = {
  name: string;
  start: string;
  end: string;
  paid: boolean;
  prayer: "Dhuhr" | "Asr" | null;
};

const PRAYER_NAMES: Record<string, "Dhuhr" | "Asr"> = { dhuhr: "Dhuhr", asr: "Asr" };

function clock(value: string | null | undefined) {
  return value && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : null;
}

export function todaysBreaks(rules: BreakRuleLike[] | null | undefined): TodayBreak[] {
  return (rules ?? [])
    .flatMap((rule) => {
      const start = clock(rule.start_time);
      const end = clock(rule.end_time);
      if (!start || !end) return [];
      return [
        {
          name: rule.name || "Break",
          start,
          end,
          paid: rule.paid,
          prayer: PRAYER_NAMES[rule.anchor ?? ""] ?? null,
        },
      ];
    })
    .sort((left, right) => left.start.localeCompare(right.start));
}

/** Which break is running at ``minutesOfDay``, or the next one still to come. */
export function breakStatusAt(breaks: TodayBreak[], minutesOfDay: number) {
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const current = breaks.find(
    (item) => toMinutes(item.start) <= minutesOfDay && minutesOfDay < toMinutes(item.end),
  );
  const next = breaks.find((item) => toMinutes(item.start) > minutesOfDay) ?? null;
  return { current: current ?? null, next };
}
