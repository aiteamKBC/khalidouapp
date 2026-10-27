import { useEffect, useState } from "react";

type Props = {
  seconds: number;
  targetSeconds: number;
  running: boolean;
  compact?: boolean;
};

function pad2(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, "0");
}

function formatClock(total: number): string {
  const safe = Math.max(0, Math.floor(total));
  return `${pad2(safe / 3600)}:${pad2((safe % 3600) / 60)}:${pad2(safe % 60)}`;
}

/* ---------- one mechanical digit ---------- */
function FlipDigit({
  char,
  slot,
  accent = false,
}: {
  char: string;
  slot: number;
  accent?: boolean;
}) {
  const [rest, setRest] = useState(char);
  const [next, setNext] = useState(char);
  const [flipping, setFlipping] = useState(false);
  const [flipKey, setFlipKey] = useState(0);

  useEffect(() => {
    if (char === rest) return undefined;
    setNext(char);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRest(char);
      setFlipping(false);
      return undefined;
    }
    setFlipping(true);
    setFlipKey((key) => key + 1);
    const timer = window.setTimeout(() => {
      setRest(char);
      setFlipping(false);
    }, 500); // Fallback if the animation is cancelled or the window is hidden.
    return () => window.clearTimeout(timer);
  }, [char, rest]);

  return (
    <span
      className={`sf-slot${accent ? " is-accent" : ""}`}
      style={{ animationDelay: `${60 + slot * 32}ms` }}
      aria-hidden="true"
    >
      <span className="sf-card">
        <span className="sf-half sf-top">
          <span className="sf-glyph">{next}</span>
        </span>
        <span className="sf-half sf-bot">
          <span className="sf-glyph">{rest}</span>
        </span>
        <span className="sf-seam" />
        {flipping ? (
          <>
            <span key={`top-${flipKey}`} className="sf-leaf sf-leaf-top">
              <span className="sf-glyph">{rest}</span>
            </span>
            <span
              key={`bot-${flipKey}`}
              className="sf-leaf sf-leaf-bot"
              onAnimationEnd={(event) => {
                if (event.target !== event.currentTarget) return;
                setRest(char);
                setFlipping(false);
              }}
            >
              <span className="sf-glyph">{next}</span>
            </span>
          </>
        ) : null}
      </span>
    </span>
  );
}

/* ---------- a pair of digits + its unit label ---------- */
function DigitGroup({
  value,
  label,
  offset,
  accent = false,
}: {
  value: string;
  label: string;
  offset: number;
  accent?: boolean;
}) {
  return (
    <span className="sf-group">
      <span className="sf-digits">
        <FlipDigit char={value.slice(0, 1)} slot={offset} accent={accent} />
        <FlipDigit char={value.slice(1, 2)} slot={offset + 1} accent={accent} />
      </span>
      <span className="sf-label">{label}</span>
    </span>
  );
}

function Colon({ live }: { live: boolean }) {
  return (
    <span className={`sf-colon${live ? " is-live" : ""}`} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

function StatusChip({ running }: { running: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.1em] ${
        running ? "bg-ok-2 text-ok" : "bg-warn-2 text-warn"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${running ? "bg-ok app-dot-live" : "bg-warn"}`}
        aria-hidden="true"
      />
      {running ? "Tracking" : "Paused"}
    </span>
  );
}

/* ---------- the board ---------- */
export default function SplitFlapTimer({
  seconds,
  targetSeconds,
  running,
  compact,
}: Props) {
  const safe = Math.max(0, Math.floor(seconds));
  const progress = targetSeconds
    ? Math.min(1, Math.max(0, seconds / targetSeconds))
    : 0;
  const percent = Math.round(progress * 100);

  const hours = pad2(safe / 3600);
  const minutes = pad2((safe % 3600) / 60);
  const secs = pad2(safe % 60);
  const targetShort = formatClock(targetSeconds).slice(0, 5);

  return (
    <div
      className="sf-timer"
      role="timer"
      aria-label={`Worked today ${formatClock(safe)}, ${percent} percent of the ${targetShort} target`}
    >
      <div className="sf-board" aria-hidden="true">
        <span className="sf-sheen" />

        <div className="sf-row">
          <DigitGroup value={hours} label="HRS" offset={0} />
          <Colon live={running} />
          <DigitGroup value={minutes} label="MIN" offset={2} />
          <Colon live={running} />
          <DigitGroup value={secs} label="SEC" offset={4} accent />
        </div>

        {compact ? null : (
          <div className="sf-meta">
            <span className="sf-meta-key">worked today</span>
            <span className="sf-meta-val">
              {percent}% of {targetShort}
            </span>
          </div>
        )}

        {compact ? null : (
          <span className="sf-bar">
            <span style={{ width: `max(3px, ${percent}%)` }} />
          </span>
        )}
      </div>

      {compact ? null : <StatusChip running={running} />}
    </div>
  );
}
