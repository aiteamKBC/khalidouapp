export type TimerStyle = "ring" | "arc" | "segments" | "bar" | "minimal";

export const TIMER_STYLES: {
  key: TimerStyle;
  label: string;
  hint: string;
  icon: string;
}[] = [
  {
    key: "ring",
    label: "Progress ring",
    hint: "Full circle, moving arc",
    icon: "ri-loader-4-line",
  },
  { key: "arc", label: "Semi arc", hint: "Half gauge, calm edges", icon: "ri-contrast-drop-line" },
  {
    key: "segments",
    label: "Segments",
    hint: "Tick dial around the clock",
    icon: "ri-donut-chart-line",
  },
  {
    key: "bar",
    label: "Linear bar",
    hint: "Wide track under the numbers",
    icon: "ri-progress-2-line",
  },
  { key: "minimal", label: "Numbers only", hint: "Type-led, no shape", icon: "ri-text" },
];

export function isTimerStyle(value: string | null): value is TimerStyle {
  return !!value && TIMER_STYLES.some((item) => item.key === value);
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export function clampProgress(seconds: number, targetSeconds: number): number {
  if (!targetSeconds) return 0;
  return Math.min(1, Math.max(0, seconds / targetSeconds));
}
