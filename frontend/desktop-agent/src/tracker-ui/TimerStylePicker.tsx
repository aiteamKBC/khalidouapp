import { TrackerIcon } from "./TrackerIcon";
import { useEffect, useRef, useState } from "react";
import { TIMER_STYLES, type TimerStyle } from "./timer-style";

type Props = {
  value: TimerStyle;
  onChange: (value: TimerStyle) => void;
  variant?: "inline" | "sidebar";
};

const PANEL_WIDTH = 286;

type PanelPos = { left: number; top?: number; bottom?: number };

function panelPosition(el: HTMLElement, variant: "inline" | "sidebar"): PanelPos {
  const rect = el.getBoundingClientRect();
  const rawLeft = variant === "sidebar" ? rect.left - 4 : rect.right - PANEL_WIDTH;
  const left = Math.min(Math.max(8, rawLeft), window.innerWidth - PANEL_WIDTH - 8);
  if (variant === "sidebar") {
    return { left, bottom: window.innerHeight - rect.top + 8 };
  }
  return { left, top: rect.bottom + 8 };
}

export default function TimerStylePicker({ value, onChange, variant = "inline" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const current = TIMER_STYLES.find((item) => item.key === value) ?? TIMER_STYLES[0];

  const openPanel = () => {
    if (btnRef.current) setPos(panelPosition(btnRef.current, variant));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        const panel = document.getElementById("timer-style-panel");
        if (panel && panel.contains(target)) return;
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScroll = () => {
      if (btnRef.current) setPos(panelPosition(btnRef.current, variant));
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, variant]);

  const pick = (next: TimerStyle) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Timer style: ${current.label}`}
        title={`Timer style · ${current.label}`}
        className={
          variant === "sidebar"
            ? "flex w-full cursor-pointer items-center gap-2 rounded-md border border-line bg-card px-2.5 py-2 text-left text-[11.5px] font-semibold text-ink-2 transition-colors hover:bg-bg-2"
            : "flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-line bg-card text-muted transition-colors hover:border-plum-2 hover:text-plum"
        }
      >
        {variant === "sidebar" ? (
          <>
            <span className="flex h-4 w-4 flex-none items-center justify-center text-pink">
              <TrackerIcon className="ri-shapes-line text-[13px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate">Timer style</span>
            <span className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
              {current.label}
            </span>
            <span className="flex h-4 w-4 flex-none items-center justify-center text-muted">
              <TrackerIcon
                className={
                  open ? "ri-arrow-down-s-line text-[13px]" : "ri-arrow-up-s-line text-[13px]"
                }
                aria-hidden="true"
              />
            </span>
          </>
        ) : (
          <TrackerIcon className="ri-shapes-line text-[15px]" aria-hidden="true" />
        )}
      </button>

      {open && pos ? (
        <div
          id="timer-style-panel"
          role="menu"
          aria-label="Timer style"
          className="k-pop fixed z-[75] rounded-[11px] border border-line bg-card p-1.5"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: PANEL_WIDTH }}
        >
          <span className="block px-2 pb-1.5 pt-1 font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">
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
                onClick={() => pick(item.key)}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-[7px] border border-transparent px-2 py-1.5 text-left transition-colors ${
                  active ? "bg-pink-2 text-pink" : "text-ink-2 hover:bg-bg-2 hover:text-plum"
                }`}
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-line bg-bg-2">
                  <TrackerIcon className={`${item.icon} text-[14px]`} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold leading-tight">
                    {item.label}
                  </span>
                  <span className="block truncate text-[10.5px] leading-tight text-muted">
                    {item.hint}
                  </span>
                </span>
                <span
                  className={`flex h-4 w-4 flex-none items-center justify-center ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <TrackerIcon className="ri-check-line text-[13px]" aria-hidden="true" />
                </span>
              </button>
            );
          })}
          <p className="mt-1 border-t border-line-2 px-2 pb-0.5 pt-2 text-[10px] leading-snug text-faint">
            Saved on this device — your shift, tasks and captures are untouched.
          </p>
        </div>
      ) : null}
    </div>
  );
}
