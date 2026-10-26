import { useId, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PortalSummary } from "@/api/employee-portal";
import { countedSeconds, type SummaryKey, type TimeSummary } from "./model";
import { fmtSeconds } from "./format";

// V211's activity chart uses account totals; pending requests never count as worked time.
export default function ActivityCard({
  summary,
  summaries,
  onBreakdown,
}: {
  summary: PortalSummary;
  summaries: TimeSummary[];
  onBreakdown: (key: SummaryKey) => void;
}) {
  const [period, setPeriod] = useState<SummaryKey>("today");
  const [showWorked, setShowWorked] = useState(true);
  const [showIdle, setShowIdle] = useState(true);
  const chartId = useId();
  const selected = summaries.find((item) => item.key === period)!;
  const data = useMemo(() => {
    if (period !== "today") {
      const today = summary.todayTimeline.date;
      const cursor = new Date(`${today}T12:00:00Z`);
      if (period === "week")
        cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
      else cursor.setUTCDate(1);
      const start = cursor.toISOString().slice(0, 10);
      return summary.days
        .filter((day) => day.date >= start && day.date <= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((day) => ({
          label: day.date.slice(5),
          worked: day.active_seconds / 3600,
          idle: day.idle_seconds / 3600,
        }));
    }
    const intervals = summary.todayTimeline.intervals.filter(
      (item) => item.type === "worked" || item.type === "idle",
    );
    const buckets = new Map<number, { label: string; worked: number; idle: number }>();
    for (const item of intervals) {
      const start = Date.parse(item.startedAt);
      const end = start + item.durationSeconds * 1000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      for (let hour = Math.floor(start / 3_600_000) * 3_600_000; hour < end; hour += 3_600_000) {
        const bucket = buckets.get(hour) ?? {
          label: new Date(hour).toLocaleTimeString([], {
            timeZone: summary.todayTimeline.timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
          worked: 0,
          idle: 0,
        };
        bucket[item.type === "worked" ? "worked" : "idle"] +=
          Math.max(0, Math.min(end, hour + 3_600_000) - Math.max(start, hour)) / 3_600_000;
        buckets.set(hour, bucket);
      }
    }
    return [...buckets.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
  }, [period, summary]);
  return (
    <section className="k-card ew-activity" aria-labelledby={`${chartId}-title`}>
      <header className="ew-activity-header">
        <div>
          <h2 id={`${chartId}-title`}>Activity</h2>
          <p>Your recorded time, across the day and beyond.</p>
        </div>
        <div className="ew-period-tabs" role="group" aria-label="Activity period">
          {(["today", "week", "month"] as const).map((key) => (
            <button
              type="button"
              key={key}
              aria-pressed={period === key}
              onClick={() => setPeriod(key)}
            >
              {key === "today" ? "Day" : key === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
      </header>
      <div className="ew-activity-totals">
        <div>
          <span>Counted time</span>
          <strong>{fmtSeconds(countedSeconds(selected.breakdown))}</strong>
        </div>
        <div>
          <span>Idle</span>
          <strong>{fmtSeconds(selected.breakdown.idleSeconds)}</strong>
        </div>
        <div>
          <span>Manual approved</span>
          <strong>{fmtSeconds(selected.breakdown.manualApprovedSeconds)}</strong>
        </div>
        <button type="button" onClick={() => onBreakdown(period)}>
          View breakdown →
        </button>
      </div>
      <div className="ew-activity-legend" role="group" aria-label="Chart series">
        <button
          type="button"
          aria-pressed={showWorked}
          onClick={() => setShowWorked((value) => !value)}
        >
          <i className="ew-legend-worked" />
          {period === "today" ? "Tracked activity" : "Counted time"}
        </button>
        <button
          type="button"
          aria-pressed={showIdle}
          onClick={() => setShowIdle((value) => !value)}
        >
          <i className="ew-legend-idle" />
          Idle
        </button>
        <span>Hours · {selected.range}</span>
      </div>
      <div
        className="ew-activity-chart"
        role="img"
        aria-label={`${period === "today" ? "Hourly tracked" : "Daily counted"} time and idle time in hours`}
      >
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 12, right: 18, bottom: 0, left: -18 }}
              accessibilityLayer
            >
              <CartesianGrid stroke="var(--k-line)" strokeDasharray="3 6" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--k-muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={25}
              />
              <YAxis
                tick={{ fill: "var(--k-muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                domain={[0, "auto"]}
              />
              <Tooltip
                formatter={(value, name) => [fmtSeconds(Number(value) * 3600), name]}
                contentStyle={{
                  background: "var(--k-card)",
                  borderColor: "var(--k-line)",
                  borderRadius: 10,
                  color: "var(--k-ink)",
                  fontSize: 12,
                }}
              />
              <Line
                hide={!showWorked}
                type="monotone"
                dataKey="worked"
                name={period === "today" ? "Tracked activity" : "Counted time"}
                stroke="var(--k-pink)"
                strokeWidth={3}
                dot={{ r: 3, fill: "var(--k-card)", strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
              <Line
                hide={!showIdle}
                type="monotone"
                dataKey="idle"
                name="Idle"
                stroke="var(--k-amber)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="ew-hub-empty">No recorded activity for this period yet.</p>
        )}
      </div>
      <footer>
        {period === "today"
          ? "Hourly chart shows tracked activity and idle time. Approved manual time is included in the total above."
          : "Daily chart shows available records from the current month. Counted time includes approved manual time."}{" "}
        Pending requests are excluded.
      </footer>
    </section>
  );
}
