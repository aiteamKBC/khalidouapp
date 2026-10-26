import { Check, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { DASHBOARD_THEMES, type DashboardSkin, type WorkspaceTheme } from "./dashboard-skins";

export default function SkinPicker({
  skin,
  mode,
  onSelect,
}: {
  skin: DashboardSkin;
  mode: WorkspaceTheme;
  onSelect: (skin: DashboardSkin, mode: WorkspaceTheme) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = DASHBOARD_THEMES.find((item) => item.skin === skin && item.mode === mode)!;
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusOut);
    };
  }, [open]);
  return (
    <div className="ew-skin-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="ew-skin-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Change dashboard theme, currently ${active.label}`}
        title={`Theme · ${active.label}`}
      >
        <Palette size={17} aria-hidden="true" />
      </button>
      {open ? (
        <div className="k-pop ew-skin-panel" role="dialog" aria-label="Dashboard theme" id={id}>
          <header>
            <span>Theme</span>
            <span className="ew-skin-dots" aria-hidden="true">
              {active.swatch.map((color) => (
                <i key={color} style={{ backgroundColor: color }} />
              ))}
            </span>
          </header>
          {DASHBOARD_THEMES.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={item.id === active.id}
              className="ew-skin-choice"
              onClick={() => {
                onSelect(item.skin, item.mode);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <span className="ew-skin-swatches" aria-hidden="true">
                {item.swatch.map((color) => (
                  <i key={color} style={{ backgroundColor: color }} />
                ))}
              </span>
              <span className="ew-skin-description">
                <strong>{item.label}</strong>
                <small>
                  {item.mode === "light" ? (
                    <Sun size={10} aria-hidden="true" />
                  ) : (
                    <Moon size={10} aria-hidden="true" />
                  )}
                  {item.blurb}
                </small>
              </span>
              {item.id === active.id ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
