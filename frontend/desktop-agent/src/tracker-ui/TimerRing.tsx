type Props = {
  seconds: number;
  targetSeconds: number;
  running: boolean;
  /** tight face that has to fit the fixed height of the tracker card */
  compact?: boolean;
};

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

const RADIUS = 116;
const CIRC = 2 * Math.PI * RADIUS;

export default function TimerRing({
  seconds,
  targetSeconds,
  running,
  compact = false,
}: Props) {
  const progress = Math.min(1, Math.max(0, seconds / targetSeconds));
  const percent = Math.round(progress * 100);

  const boxClass = compact
    ? "relative mx-auto h-[210px] w-[210px] flex-none"
    : "relative mx-auto h-[288px] w-[288px] flex-none sm:h-[320px] sm:w-[320px]";

  return (
    <div className={boxClass}>
      <div
        className={`pointer-events-none absolute rounded-full blur-[46px] ${
          compact ? "inset-4" : "inset-6"
        }`}
        style={{
          background:
            "radial-gradient(closest-side, var(--k-glow), transparent 72%)",
        }}
        aria-hidden="true"
      />

      <svg viewBox="0 0 280 280" className="relative h-full w-full">
        <defs>
          <linearGradient id="trackerRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--k-ring-1)" }} />
            <stop offset="38%" style={{ stopColor: "var(--k-ring-2)" }} />
            <stop offset="70%" style={{ stopColor: "var(--k-ring-3)" }} />
            <stop offset="100%" style={{ stopColor: "var(--k-ring-4)" }} />
          </linearGradient>
        </defs>

        <circle
          cx="140"
          cy="140"
          r={RADIUS}
          fill="none"
          style={{ stroke: "var(--k-track)" }}
          strokeWidth="9"
        />
        <circle
          cx="140"
          cy="140"
          r={RADIUS - 17}
          fill="none"
          style={{ stroke: "var(--k-track-2)" }}
          strokeWidth="1"
          strokeDasharray="2 7"
        />
        <circle
          cx="140"
          cy="140"
          r={RADIUS}
          fill="none"
          stroke="url(#trackerRing)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - progress)}
          transform="rotate(-90 140 140)"
          className="app-ring-glow"
        />
      </svg>

      {compact ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <p className="app-num text-[34px] font-bold leading-none tracking-[-0.02em] text-ink">
            {clock(seconds)}
          </p>
          <p className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
            {percent}%
          </p>
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <p className="app-num text-[36px] font-bold leading-none tracking-[-0.02em] text-ink sm:text-[44px]">
              {clock(seconds)}
            </p>
            <p className="mt-3 max-w-[190px] font-mono text-[9px] uppercase leading-[1.6] tracking-[0.14em] text-muted">
              Worked today · {percent}% of {clock(targetSeconds).slice(0, 5)}{" "}
              target
            </p>
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
          </div>

          <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
            6H
          </span>
          <span className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
            8H
          </span>
          <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
            2H
          </span>
          <span className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
            4H
          </span>
        </>
      )}
    </div>
  );
}
