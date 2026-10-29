import { useEffect, useRef, useState } from "react";
import { SKINS, skinMeta, type Mode, type Skin } from "../theme/skin";

type Props = {
  skin: Skin;
  mode: Mode;
  onSkin: (skin: Skin) => void;
  onMode: (mode: Mode) => void;
};

const MODES: { key: Mode; icon: string; label: string }[] = [
  { key: "light", icon: "ri-sun-line", label: "Light" },
  { key: "dark", icon: "ri-moon-line", label: "Dark" },
];

export function ThemePicker({ skin, mode, onSkin, onMode }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointer = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const meta = skinMeta(skin);
  const dots = mode === "dark" ? meta.swatchDark : meta.swatch;

  return (
    <div ref={wrapRef} className="app-no-drag relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Change theme, currently ${meta.label} ${mode}`}
        aria-expanded={open}
        aria-haspopup="true"
        title={`Theme · ${meta.label} ${mode === "dark" ? "Dark" : "Light"}`}
        className={`app-nav-btn ${open ? "app-nav-active" : ""}`}
      >
        <i className="ri-palette-line text-[15px]" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Theme"
          className="absolute right-0 top-[calc(100%+10px)] z-[70] w-[262px] rounded-xl border border-solid border-line bg-card p-2.5"
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[8.5px] uppercase tracking-[0.2em] text-faint">theme</span>
            <span className="flex items-center gap-1">
              {dots.map((color) => (
                <span
                  key={color}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: color }}
                  aria-hidden="true"
                />
              ))}
            </span>
          </div>

          <div
            className="mb-2 flex items-center gap-1 rounded-lg border border-solid border-line bg-hover p-1"
            role="group"
            aria-label="Light or dark"
          >
            {MODES.map((item) => {
              const selected = item.key === mode;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onMode(item.key)}
                  className={`app-plain-btn flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-[5px] text-[10.5px] font-semibold transition-colors ${
                    selected ? "bg-card text-plum" : "text-muted hover:text-ink"
                  }`}
                >
                  <i className={`${item.icon} text-[12px]`} aria-hidden="true" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-1">
            {SKINS.map((item) => {
              const selected = item.key === skin;
              const swatch = mode === "dark" ? item.swatchDark : item.swatch;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => onSkin(item.key)}
                  className={`app-plain-btn flex w-full items-center gap-2.5 rounded-lg border border-solid px-2 py-2 text-left transition-colors ${
                    selected ? "border-pink bg-pink-2" : "border-transparent hover:bg-hover"
                  }`}
                >
                  <span className="flex flex-none items-center gap-[3px]" aria-hidden="true">
                    {swatch.map((color) => (
                      <span
                        key={color}
                        className="h-4 w-[7px] rounded-[2px]"
                        style={{ background: color }}
                      />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold leading-tight text-ink">
                      {item.label}
                    </span>
                    <span className="mt-[2px] block truncate text-[9.5px] leading-tight text-muted">
                      {item.blurb}
                    </span>
                  </span>
                  <i
                    className={`ri-check-line flex-none text-[13px] ${
                      selected ? "text-plum" : "text-transparent"
                    }`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
