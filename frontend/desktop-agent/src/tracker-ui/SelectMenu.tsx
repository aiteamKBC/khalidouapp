import { TrackerIcon } from "./TrackerIcon";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

export type SelectOption = {
  value: string;
  label: string;
};

type Props = {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  variant?: "default" | "app";
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
};

export default function SelectMenu({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Select an option",
  variant = "default",
  className = "",
  triggerClassName = "",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close();
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return undefined;

    const reposition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const rect = trigger.getBoundingClientRect();
      const panelHeight = Math.min(panel.scrollHeight + 12, 272);
      const spaceBelow = window.innerHeight - rect.bottom - 14;
      setFlipUp(spaceBelow < panelHeight && rect.top > panelHeight + 14);
    };

    const handleScroll = (event: Event) => {
      if (
        panelRef.current &&
        event.target instanceof Node &&
        panelRef.current.contains(event.target)
      ) {
        return;
      }
      reposition();
    };

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  const step = (direction: 1 | -1) => {
    if (options.length === 0) return;
    const currentIndex = options.findIndex((option) => option.value === value);
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    onChange(options[nextIndex].value);
  };

  const handleTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!open) {
        setOpen(true);
        if (!selected) step(direction);
        return;
      }
      step(direction);
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((prev) => !prev);
    }
  };

  return (
    <div ref={wrapRef} className={`k-dropdown ${open ? "k-dropdown-open" : ""} ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`k-select-trigger ${variant === "app" ? "k-select-trigger-app" : ""} ${
          open ? "is-open" : ""
        } ${triggerClassName}`}
      >
        <span className="k-dropdown-value" title={selected ? selected.label : placeholder}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="k-dropdown-caret" aria-hidden="true">
          <TrackerIcon className="ri-arrow-down-s-line text-[16px]" />
        </span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          className={`k-dropdown-panel k-scroll ${flipUp ? "k-dropdown-panel-up" : ""}`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="k-dropdown-item"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <span className="k-dropdown-item-label" title={option.label}>
                {option.label}
              </span>
              <span className="k-dropdown-check" aria-hidden="true">
                <TrackerIcon className="ri-check-line text-[13px]" />
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
