import { useEffect, useRef, useState } from "react";
import { TIMER_STYLES, type TimerStyle } from "./timerStyle";

type Props = {
  value: TimerStyle;
  onChange: (value: TimerStyle) => void;
};

export function TimerStylePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = TIMER_STYLES.find((item) => item.key === value) ?? TIMER_STYLES[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Timer style: ${current.label}`}
        title={`Timer style · ${current.label}`}
        className="app-plain-btn flex h-8 w-8 items-center justify-center rounded-md border border-solid border-line bg-card text-muted transition-colors hover:border-plum-2 hover:text-plum"
      >
        <i className="ri-shapes-line text-[15px]" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Timer style"
          className="absolute right-0 top-[calc(100%+8px)] z-[75] w-[286px] rounded-[11px] border border-solid border-line bg-card p-1.5 text-left"
        >
          <span className="block px-2 pb-1.5 pt-1 text-[8.5px] uppercase tracking-[0.2em] text-faint">
            how your timer looks
          </span>
          {TIMER_STYLES.map((item) => {
            const active = item.key === value;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(item.key);
                  setOpen(false);
                }}
                className={`app-plain-btn flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left transition-colors ${
                  active ? "bg-pink-2 text-pink" : "text-ink-2 hover:bg-bg-2 hover:text-plum"
                }`}
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-solid border-line bg-bg-2">
                  <i className={`${item.icon} text-[14px]`} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold leading-tight">{item.label}</span>
                  <span className="block truncate text-[10.5px] leading-tight text-muted">{item.hint}</span>
                </span>
                <i className={`ri-check-line text-[13px] ${active ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
              </button>
            );
          })}
          <p className="mt-1 border-0 border-t border-solid border-line-2 px-2 pb-0.5 pt-2 text-[10px] leading-snug text-faint">
            Saved on this computer. Your shift and tracked time are untouched.
          </p>
        </div>
      ) : null}
    </div>
  );
}
