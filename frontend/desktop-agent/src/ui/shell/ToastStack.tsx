import type { ToastItem, ToastTone } from "./toastQueue";

const TONES: Record<ToastTone, { icon: string; label: string }> = {
  success: { icon: "ri-checkbox-circle-line", label: "Done" },
  warning: { icon: "ri-error-warning-line", label: "Heads up" },
  error: { icon: "ri-close-circle-line", label: "Failed" },
};

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="app-toast-stack" role="region" aria-label="Notifications">
      {toasts.map((toast) => {
        const tone = TONES[toast.tone];
        return (
          <div key={toast.id} role="status" aria-live="polite" className="app-toast" data-tone={toast.tone}>
            <span className="app-toast-icon" aria-hidden="true">
              <i className={tone.icon} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="app-toast-label">{tone.label}</span>
              <span className="app-toast-text">{toast.message}</span>
            </span>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="app-plain-btn flex h-4 w-4 flex-none items-center justify-center text-muted hover:text-ink"
            >
              <i className="ri-close-line text-[13px]" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
