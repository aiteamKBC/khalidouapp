import TimerRing from "./TimerRing";
import SplitFlapTimer from "./SplitFlapTimer";

import { clock, clampProgress, type TimerStyle } from "./timer-style";

type FaceProps = {
  seconds: number;
  targetSeconds: number;
  running: boolean;
  /** inside the hero card the progress bar lives once, below the face */
  compact?: boolean;
};

export function TimerStatusChip({ running }: { running: boolean }) {
  return (
    <span
      className={`mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.1em] ${
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

export function BigClock({
  seconds,
  small = false,
}: {
  seconds: number;
  small?: boolean;
}) {
  const parts = clock(seconds).split(":");
  return (
    <div
      className={`tp-clock${small ? " is-small" : ""}`}
      role="timer"
      aria-label={`Elapsed ${clock(seconds)}`}
    >
      <span>{parts[0]}</span>
      <span className="tp-colon" aria-hidden="true">
        :
      </span>
      <span>{parts[1]}</span>
      <span className="tp-colon" aria-hidden="true">
        :
      </span>
      <span>{parts[2]}</span>
    </div>
  );
}

/* ---------- 2. semi arc ---------- */
const ARC_R = 116;
const ARC_LEN = Math.PI * ARC_R;

function ArcTimer({ seconds, targetSeconds, running, compact }: FaceProps) {
  const progress = clampProgress(seconds, targetSeconds);
  const percent = Math.round(progress * 100);
  const targetShort = clock(targetSeconds).slice(0, 5);

  const shape = (
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
  );

  if (compact) {
    return (
      <div className="mx-auto flex h-full w-full items-center justify-center">
        <div className="relative w-[280px] max-w-full">
          {shape}
          <div className="absolute inset-x-0 bottom-4 flex justify-center">
            <p className="app-num text-[34px] font-bold leading-none tracking-[-0.02em] text-ink">
              {clock(seconds)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[356px] flex-col items-center justify-center">
      <div className="relative w-full">
        {shape}

        <div className="absolute inset-x-0 bottom-6 flex flex-col items-center text-center">
          <p className="app-num text-[34px] font-bold leading-none tracking-[-0.02em] text-ink sm:text-[40px]">
            {clock(seconds)}
          </p>
          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
            {percent}% of {targetShort} target
          </p>
        </div>
      </div>

      <div className="mt-1 flex w-full items-center justify-between px-3 font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
        <span>Start</span>
        <span>{targetShort}</span>
      </div>

      <TimerStatusChip running={running} />
    </div>
  );
}

/* ---------- 3. segmented dial ---------- */
const SEGMENTS = 48;

function SegmentsTimer({
  seconds,
  targetSeconds,
  running,
  compact,
}: FaceProps) {
  const progress = clampProgress(seconds, targetSeconds);
  const percent = Math.round(progress * 100);
  const filled = Math.round(progress * SEGMENTS);
  const targetShort = clock(targetSeconds).slice(0, 5);

  const ticks = Array.from({ length: SEGMENTS }).map((_, index) => {
    const active = index < filled;
    const hue = 0.55 + (index / SEGMENTS) * 0.45;
    return (
      <rect
        key={index}
        x="138.8"
        y="13"
        width="2.4"
        height={active ? 16 : 11}
        rx="1.2"
        fill={active ? "var(--k-ring-3)" : "var(--k-track)"}
        opacity={active ? hue : 1}
        transform={`rotate(${(index / SEGMENTS) * 360} 140 140)`}
      />
    );
  });

  if (compact) {
    return (
      <div className="relative mx-auto flex h-full w-full items-center justify-center">
        <svg
          viewBox="0 0 280 280"
          className="h-[204px] w-[204px] flex-none"
          aria-hidden="true"
        >
          {ticks}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="app-num text-[33px] font-bold leading-none tracking-[-0.02em] text-ink">
            {clock(seconds)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex h-full w-full items-center justify-center">
      <svg
        viewBox="0 0 280 280"
        className="h-[252px] w-[252px] sm:h-[284px] sm:w-[284px]"
        aria-hidden="true"
      >
        {ticks}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        <p className="app-num text-[28px] font-bold leading-none tracking-[-0.02em] text-ink sm:text-[34px]">
          {clock(seconds)}
        </p>
        <p className="mt-2 max-w-[150px] font-mono text-[9px] uppercase leading-[1.6] tracking-[0.14em] text-muted">
          {percent}% of {targetShort} target
        </p>
        <TimerStatusChip running={running} />
      </div>
    </div>
  );
}

/* ---------- 4. linear bar ---------- */
function BarTimer({ seconds, targetSeconds, running, compact }: FaceProps) {
  const progress = clampProgress(seconds, targetSeconds);
  const percent = Math.round(progress * 100);
  const targetShort = clock(targetSeconds).slice(0, 5);

  if (compact) {
    return (
      <div className="mx-auto flex h-full w-full items-center justify-center">
        <BigClock seconds={seconds} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[460px] flex-col items-center justify-center px-1 text-center">
      <div className="flex flex-col items-center gap-2">
        <p className="app-num text-[32px] font-bold leading-none tracking-[-0.025em] text-ink sm:text-[40px]">
          {clock(seconds)}
        </p>
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
      </div>

      <div className="relative mt-4 h-2.5 w-full overflow-hidden rounded-full bg-[var(--k-track)]">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-out"
          style={{
            width: `${percent}%`,
            background:
              "linear-gradient(90deg, var(--k-ring-1), var(--k-ring-3))",
          }}
        />
      </div>

      <div className="mt-2 flex w-full items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
        <span>0h</span>
        <span className="text-muted">
          {percent}% of {targetShort}
        </span>
        <span>{targetShort}</span>
      </div>

      <div className="mt-4 flex w-full items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
        <span>{(seconds / 3600).toFixed(2)}h logged</span>
        <span>
          {Math.max(0, Math.ceil((targetSeconds - seconds) / 3600))}h left today
        </span>
      </div>
    </div>
  );
}

/* ---------- 5. numbers only ---------- */
function MinimalTimer({ seconds, targetSeconds, running, compact }: FaceProps) {
  const progress = clampProgress(seconds, targetSeconds);
  const percent = Math.round(progress * 100);
  const targetShort = clock(targetSeconds).slice(0, 5);

  if (compact) {
    return (
      <div className="mx-auto flex h-full w-full items-center justify-center">
        <BigClock seconds={seconds} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[420px] flex-col items-center justify-center px-2 text-center">
      <p className="app-num text-[48px] font-bold leading-none tracking-[-0.035em] text-ink sm:text-[62px]">
        {clock(seconds)}
      </p>
      <span className="mt-4 block h-[2px] w-[186px] overflow-hidden rounded-full bg-[var(--k-track)]">
        <span
          className="block h-full rounded-full transition-[width] duration-1000 ease-out"
          style={{
            width: `${percent}%`,
            background:
              "linear-gradient(90deg, var(--k-ring-1), var(--k-ring-3))",
          }}
        />
      </span>
      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
        {percent}% of {targetShort} target
      </p>
      <TimerStatusChip running={running} />
    </div>
  );
}

/* ---------- dispatcher ---------- */
type Props = FaceProps & {
  style: TimerStyle;
};

export default function TimerDisplay({
  style,
  seconds,
  targetSeconds,
  running,
  compact,
}: Props) {
  if (style === "flip") {
    return (
      <SplitFlapTimer
        seconds={seconds}
        targetSeconds={targetSeconds}
        running={running}
        compact={compact}
      />
    );
  }
  if (style === "ring") {
    return (
      <TimerRing
        seconds={seconds}
        targetSeconds={targetSeconds}
        running={running}
        compact={compact}
      />
    );
  }
  if (style === "arc") {
    return (
      <ArcTimer
        seconds={seconds}
        targetSeconds={targetSeconds}
        running={running}
        compact={compact}
      />
    );
  }
  if (style === "segments") {
    return (
      <SegmentsTimer
        seconds={seconds}
        targetSeconds={targetSeconds}
        running={running}
        compact={compact}
      />
    );
  }
  if (style === "bar") {
    return (
      <BarTimer
        seconds={seconds}
        targetSeconds={targetSeconds}
        running={running}
        compact={compact}
      />
    );
  }
  return (
    <MinimalTimer
      seconds={seconds}
      targetSeconds={targetSeconds}
      running={running}
      compact={compact}
    />
  );
}
