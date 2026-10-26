import { WorkspaceIcon } from "./WorkspaceIcon";
import { useEffect, useRef, type ReactNode } from "react";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  description,
  children,
  footer,
  size = "md",
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const timer = window.setTimeout(() => closeRef.current?.focus(), 40);

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="k-overlay" onClick={onClose} aria-hidden="true" />
      <div
        className="k-drawer"
        style={size === "lg" ? { maxWidth: 660 } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
      >
        <div className="flex items-start gap-3 border-b border-ew-line px-4 py-3.5 md:px-5">
          <div className="min-w-0 flex-1">
            {eyebrow ? <p className="k-label">{eyebrow}</p> : null}
            <h2
              className="mt-0.5 truncate font-ew-heading text-[17px] font-semibold text-ew-plum"
              dir="auto"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[12px] leading-snug text-ew-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-md border border-ew-line text-ew-ink-2 transition-colors hover:bg-ew-bg-2"
          >
            <span className="flex h-4 w-4 items-center justify-center">
              <WorkspaceIcon className="ri-close-line text-[17px]" aria-hidden="true" />
            </span>
          </button>
        </div>

        <div className="k-scroll flex-1 overflow-y-auto px-4 py-4 md:px-5">{children}</div>

        {footer ? <div className="border-t border-ew-line px-4 py-3 md:px-5">{footer}</div> : null}
      </div>
    </>
  );
}
