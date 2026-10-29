import { useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import TimerDisplay from "./TimerFaces";
import { TIMER_STYLES, type TimerStyle } from "./timer-style";
import { TrackerIcon } from "./TrackerIcon";
import "./swipe-timer.css";

type Props = {
  style: TimerStyle;
  onChange: (value: TimerStyle) => void;
  seconds: number;
  targetSeconds: number;
  running: boolean;
  /** tighter face for the tracker card */
  compact?: boolean;
};

/** how far a finger or the mouse has to travel before the face flips */
const THRESHOLD = 46;
/** maximum pull, reached with heavy resistance */
const MAX_PULL = 104;
/** a quick flick flips even when the travel is short (px per ms) */
const FLICK_VELOCITY = 0.55;

const rubber = (dx: number) => {
  const sign = dx < 0 ? -1 : 1;
  return sign * MAX_PULL * Math.tanh(Math.abs(dx) / MAX_PULL);
};

export default function SwipeTimer({
  style,
  onChange,
  seconds,
  targetSeconds,
  running,
  compact = false,
}: Props) {
  const index = Math.max(
    0,
    TIMER_STYLES.findIndex((item) => item.key === style),
  );
  const [drag, setDrag] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const axisRef = useRef<"x" | "y" | null>(null);
  const sampleRef = useRef<{ x: number; t: number; v: number }>({
    x: 0,
    t: 0,
    v: 0,
  });

  const goTo = (next: number) => {
    const wrapped = (next + TIMER_STYLES.length) % TIMER_STYLES.length;
    if (wrapped === index) return;
    setDir(wrapped > index ? 1 : -1);
    onChange(TIMER_STYLES[wrapped].key);
  };

  const shift = (step: number) => goTo(index + step);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startRef.current = { x: event.clientX, y: event.clientY };
    axisRef.current = null;
    sampleRef.current = { x: event.clientX, t: event.timeStamp, v: 0 };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (!axisRef.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 0.9;
      axisRef.current = horizontal ? "x" : "y";
      if (horizontal) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* capture is a nicety — the gesture still works without it */
        }
      }
    }

    if (axisRef.current !== "x") return;

    const sample = sampleRef.current;
    const dt = event.timeStamp - sample.t;
    if (dt > 0) {
      sample.v = (event.clientX - sample.x) / dt;
      sample.x = event.clientX;
      sample.t = event.timeStamp;
    }

    setDrag(rubber(dx));
  };

  const endGesture = () => {
    const capped = Math.max(-MAX_PULL, Math.min(MAX_PULL, drag));
    const flick = sampleRef.current.v;
    const velocityFlip =
      Math.abs(flick) >= FLICK_VELOCITY && Math.abs(capped) > 10;

    if (axisRef.current === "x") {
      if (capped <= -THRESHOLD || (velocityFlip && flick < 0)) shift(1);
      else if (capped >= THRESHOLD || (velocityFlip && flick > 0)) shift(-1);
    }

    startRef.current = null;
    axisRef.current = null;
    sampleRef.current.v = 0;
    setDrag(0);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      shift(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      shift(-1);
    }
  };

  const dragging = drag !== 0;
  const pull = Math.abs(drag);
  const tilt = Math.max(-4.2, Math.min(4.2, drag / 24));
  const lift = 1 - Math.min(0.045, pull / 2600);
  const goingNext = drag < 0;

  /* one fixed height for every face, so flipping never shifts the card */
  const faceHeight = compact ? "h-[238px]" : "h-[300px] sm:h-[336px]";

  return (
    <div className="timer-carousel flex w-full flex-col items-center">
      <div
        role="group"
        tabIndex={0}
        aria-label={`Timer face ${TIMER_STYLES[index].label}. Use the buttons, swipe, or use the arrow keys to change it.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onPointerLeave={() => {
          if (axisRef.current === "x") endGesture();
        }}
        onKeyDown={onKeyDown}
        className="relative w-full cursor-grab touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-pink/40 active:cursor-grabbing"
        style={{ perspective: "900px" }}
      >
        <div
          className="w-full"
          style={{
            transform: `translateX(${drag}px) rotateY(${tilt}deg) scale(${lift})`,
            transformOrigin: goingNext ? "left center" : "right center",
            opacity: dragging ? 1 - Math.min(0.22, pull / 620) : 1,
            transition: dragging
              ? "none"
              : "transform 0.52s cubic-bezier(0.34, 1.42, 0.44, 1), opacity 0.32s ease-out",
            willChange: "transform",
          }}
        >
          <div
            key={style}
            className={`timer-carousel-face flex w-full items-center justify-center ${faceHeight} ${dir > 0 ? "k-face-in-next" : "k-face-in-prev"}`}
            style={{ transformStyle: "preserve-3d" }}
          >
            <TimerDisplay
              style={style}
              seconds={seconds}
              targetSeconds={targetSeconds}
              running={running}
              compact={compact}
            />
          </div>
        </div>
        <button
          type="button"
          className="timer-carousel-button is-previous"
          aria-label="Previous timer style"
          title="Previous timer style"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => shift(-1)}
        >
          <TrackerIcon className="ri-arrow-left-line" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="timer-carousel-button is-next"
          aria-label="Next timer style"
          title="Next timer style"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => shift(1)}
        >
          <TrackerIcon className="ri-arrow-right-line" aria-hidden="true" />
        </button>
      </div>

      <div
        className={`flex flex-col items-center gap-1.5 ${compact ? "mt-1" : "mt-2"}`}
      >
        <div className="flex items-center gap-1.5">
          {TIMER_STYLES.map((item, dot) => {
            const active = dot === index;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => goTo(dot)}
                aria-label={`Use the ${item.label} face`}
                aria-current={active ? "true" : undefined}
                title={item.label}
                className={`h-1.5 cursor-pointer rounded-full transition-all duration-300 ${
                  active ? "w-5 bg-pink" : "w-1.5 bg-line-2 hover:bg-plum-2"
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
