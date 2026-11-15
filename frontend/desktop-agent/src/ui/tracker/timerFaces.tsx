import { useEffect, useState } from "react";
import type { TimerStyle } from "./timerStyle";

/**
 * The six timer faces from the Readdy design, compact variant only (the
 * tracker card is the one place they render). A face only draws: the
 * number it shows and the ring fill both come from App.tsx. The number can
 * be worked time, the idle counter or extra time, so the fill is passed
 * separately as `progress` (worked share of the daily target, 0..1).
 */
export type FaceProps = {
  /** The formatted main timer, e.g. "03:00:00" (App.tsx formatDuration). */
  clock: string;
  /** Worked share of the daily target, 0..1. */
  progress: number;
  /** Colons pulse only while the timer is counting work. */
  live: boolean;
};

function BigClock({ clock }: { clock: string }) {
  const parts = clock.split(":");
  return (
    <div className="tp-clock" role="timer" aria-label={clock}>
      <span>{parts[0]}</span>
      <span className="tp-colon" aria-hidden="true">:</span>
      <span>{parts[1]}</span>
      <span className="tp-colon" aria-hidden="true">:</span>
      <span>{parts[2]}</span>
    </div>
  );
}

const RING_R = 116;
const RING_CIRC = 2 * Math.PI * RING_R;

function RingFace({ clock, progress }: FaceProps) {
  return (
    <div className="relative mx-auto h-[200px] w-[200px] flex-none">
      <div
        className="pointer-events-none absolute inset-4 rounded-full blur-[46px]"
        style={{ background: "radial-gradient(closest-side, var(--k-glow), transparent 72%)" }}
        aria-hidden="true"
      />
      <svg viewBox="0 0 280 280" className="relative h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="trackerRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--k-ring-1)" }} />
            <stop offset="38%" style={{ stopColor: "var(--k-ring-2)" }} />
            <stop offset="70%" style={{ stopColor: "var(--k-ring-3)" }} />
            <stop offset="100%" style={{ stopColor: "var(--k-ring-4)" }} />
          </linearGradient>
        </defs>
        <circle cx="140" cy="140" r={RING_R} fill="none" style={{ stroke: "var(--k-track)" }} strokeWidth="9" />
        <circle
          cx="140"
          cy="140"
          r={RING_R - 17}
          fill="none"
          style={{ stroke: "var(--k-track)" }}
          strokeWidth="1"
          strokeDasharray="2 7"
        />
        <circle
          cx="140"
          cy="140"
          r={RING_R}
          fill="none"
          stroke="url(#trackerRing)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={RING_CIRC}
          strokeDashoffset={RING_CIRC * (1 - progress)}
          transform="rotate(-90 140 140)"
          className="app-ring-glow"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <p className="app-num m-0 text-[33px] font-bold leading-none tracking-[-0.02em] text-ink" role="timer">
          {clock}
        </p>
      </div>
    </div>
  );
}

const ARC_R = 116;
const ARC_LEN = Math.PI * ARC_R;

function ArcFace({ clock, progress }: FaceProps) {
  return (
    <div className="relative w-[280px] max-w-full">
      <svg viewBox="0 0 280 168" className="w-full" aria-hidden="true">
        <defs>
          <linearGradient id="trackerArc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: "var(--k-ring-1)" }} />
            <stop offset="55%" style={{ stopColor: "var(--k-ring-3)" }} />
            <stop offset="100%" style={{ stopColor: "var(--k-ring-4)" }} />
          </linearGradient>
        </defs>
        <path
          d={`M 24 148 A ${ARC_R} ${ARC_R} 0 0 1 256 148`}
          fill="none"
          style={{ stroke: "var(--k-track)" }}
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d={`M 24 148 A ${ARC_R} ${ARC_R} 0 0 1 256 148`}
          fill="none"
          stroke="url(#trackerArc)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={ARC_LEN}
          strokeDashoffset={ARC_LEN * (1 - progress)}
          className="app-ring-glow"
        />
      </svg>
      <div className="absolute inset-x-0 bottom-4 flex justify-center">
        <p className="app-num m-0 text-[34px] font-bold leading-none tracking-[-0.02em] text-ink" role="timer">
          {clock}
        </p>
      </div>
    </div>
  );
}

const SEGMENTS = 48;

function SegmentsFace({ clock, progress }: FaceProps) {
  const filled = Math.round(progress * SEGMENTS);
  return (
    <div className="relative mx-auto flex items-center justify-center">
      <svg viewBox="0 0 280 280" className="h-[200px] w-[200px] flex-none" aria-hidden="true">
        {Array.from({ length: SEGMENTS }).map((_, index) => {
          const active = index < filled;
          return (
            <rect
              key={index}
              x="138.8"
              y="13"
              width="2.4"
              height={active ? 16 : 11}
              rx="1.2"
              fill={active ? "var(--k-ring-3)" : "var(--k-track)"}
              opacity={active ? 0.55 + (index / SEGMENTS) * 0.45 : 1}
              transform={`rotate(${(index / SEGMENTS) * 360} 140 140)`}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="app-num m-0 text-[32px] font-bold leading-none tracking-[-0.02em] text-ink" role="timer">
          {clock}
        </p>
      </div>
    </div>
  );
}

function BarFace({ clock, progress }: FaceProps) {
  return (
    <div className="flex w-full max-w-[380px] flex-col items-center gap-4">
      <BigClock clock={clock} />
      <span className="relative block h-2.5 w-full overflow-hidden rounded-full bg-[var(--k-track)]">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-out"
          style={{
            width: `${Math.round(progress * 100)}%`,
            background: "linear-gradient(90deg, var(--k-ring-1), var(--k-ring-3))",
          }}
        />
      </span>
    </div>
  );
}

/* ---------- split-flap board ---------- */
function FlipDigit({ char, slot, accent = false }: { char: string; slot: number; accent?: boolean }) {
  const [rest, setRest] = useState(char);
  const [next, setNext] = useState(char);
  const [flipping, setFlipping] = useState(false);
  const [flipKey, setFlipKey] = useState(0);

  useEffect(() => {
    if (char === rest) return undefined;
    setNext(char);
    setFlipping(true);
    setFlipKey((key) => key + 1);
    const timer = window.setTimeout(() => {
      setRest(char);
      setFlipping(false);
    }, 720);
    return () => window.clearTimeout(timer);
  }, [char, rest]);

  return (
    <span
      className={`sf-slot${accent ? " is-accent" : ""}`}
      style={{ animationDelay: `${130 + slot * 62}ms` }}
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
            <span key={`bot-${flipKey}`} className="sf-leaf sf-leaf-bot">
              <span className="sf-glyph">{next}</span>
            </span>
          </>
        ) : null}
      </span>
    </span>
  );
}

function DigitGroup({ value, label, offset, accent = false }: { value: string; label: string; offset: number; accent?: boolean }) {
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

function FlipFace({ clock, live }: FaceProps) {
  const [hours, minutes, secs] = clock.split(":");
  return (
    <div className="sf-timer" role="timer" aria-label={clock}>
      <div className="sf-board" aria-hidden="true">
        <span className="sf-sheen" />
        <div className="sf-row">
          <DigitGroup value={hours} label="HRS" offset={0} />
          <span className={`sf-colon${live ? " is-live" : ""}`}>
            <i />
            <i />
          </span>
          <DigitGroup value={minutes} label="MIN" offset={2} />
          <span className={`sf-colon${live ? " is-live" : ""}`}>
            <i />
            <i />
          </span>
          <DigitGroup value={secs} label="SEC" offset={4} accent />
        </div>
      </div>
    </div>
  );
}

export function TimerFace({ style, ...face }: FaceProps & { style: TimerStyle }) {
  if (style === "flip") return <FlipFace {...face} />;
  if (style === "ring") return <RingFace {...face} />;
  if (style === "arc") return <ArcFace {...face} />;
  if (style === "segments") return <SegmentsFace {...face} />;
  if (style === "bar") return <BarFace {...face} />;
  return <BigClock clock={face.clock} />;
}
