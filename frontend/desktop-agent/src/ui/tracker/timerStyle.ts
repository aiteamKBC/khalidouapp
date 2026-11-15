import { useEffect, useState } from "react";

/** The six timer faces from the Readdy design; the choice is per computer. */
export type TimerStyle = "flip" | "ring" | "arc" | "segments" | "bar" | "minimal";

export const TIMER_STYLES: { key: TimerStyle; label: string; hint: string; icon: string }[] = [
  { key: "minimal", label: "Numbers only", hint: "Type-led, no shape", icon: "ri-text" },
  { key: "ring", label: "Progress ring", hint: "Full circle, moving arc", icon: "ri-loader-4-line" },
  { key: "flip", label: "Split-flap", hint: "Station board, digits fall on their own", icon: "ri-flip-horizontal-line" },
  { key: "arc", label: "Semi arc", hint: "Half gauge, calm edges", icon: "ri-contrast-drop-line" },
  { key: "segments", label: "Segments", hint: "Tick dial around the clock", icon: "ri-donut-chart-line" },
  { key: "bar", label: "Linear bar", hint: "Wide track under the numbers", icon: "ri-progress-2-line" },
];

const TIMER_STYLE_KEY = "khaliduo-timer-style";

function isTimerStyle(value: unknown): value is TimerStyle {
  return TIMER_STYLES.some((item) => item.key === value);
}

export function useTimerStyle() {
  const [style, setStyle] = useState<TimerStyle>(() => {
    try {
      const saved = window.localStorage.getItem(TIMER_STYLE_KEY);
      return isTimerStyle(saved) ? saved : "minimal";
    } catch {
      return "minimal";
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(TIMER_STYLE_KEY, style);
    } catch {
      // Storage can be unavailable; the choice still applies this session.
    }
  }, [style]);
  return [style, setStyle] as const;
}
