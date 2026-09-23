import { useQuery } from "@tanstack/react-query";

import { getPrayerTimes } from "@/api/employees";
import {
  BREAK_ANCHOR_LABELS,
  breakWindow,
  isPrayerAnchor,
  type BreakAnchor,
  type PrayerTimesDay,
} from "@/lib/break-rules";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function localTodayIso() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

/** Today's Dhuhr/Asr times; prayer times change by a minute a day at most. */
export function usePrayerTimesToday(): PrayerTimesDay | null {
  const today = localTodayIso();
  const query = useQuery({
    queryKey: ["prayer-times", today],
    queryFn: ({ signal }) => getPrayerTimes(today, 1, signal),
    staleTime: 60 * 60 * 1000,
  });
  return query.data?.[0] ?? null;
}

export function BreakAnchorSelect({
  value,
  onChange,
  disabled,
}: {
  value: BreakAnchor;
  onChange: (value: BreakAnchor) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as BreakAnchor)}
      disabled={disabled}
    >
      <SelectTrigger aria-label="Break starts at">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(BREAK_ANCHOR_LABELS) as BreakAnchor[]).map((anchor) => (
          <SelectItem key={anchor} value={anchor}>
            {BREAK_ANCHOR_LABELS[anchor]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Today 12:48–13:18" under a prayer-anchored break. */
export function PrayerBreakHint({
  anchor,
  minutes,
  prayer,
}: {
  anchor: BreakAnchor;
  minutes: number;
  prayer: PrayerTimesDay | null;
}) {
  if (!isPrayerAnchor(anchor)) return null;
  const window = breakWindow({ anchor, minutes }, prayer);
  return (
    <p className="text-[11px] text-muted-foreground">
      Moves daily with the adhan{window ? ` · today ${window.start}–${window.end}` : ""}
    </p>
  );
}
