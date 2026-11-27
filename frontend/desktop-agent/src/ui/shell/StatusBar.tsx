import type { ShellTone } from "./TopBar";
import type { HealthTone } from "../../../electron/services/trackingHealth";

export type CaptureState = "active" | "queued" | "paused";

type Props = {
  tone: ShellTone;
  /** Current recording status, including interruptions and intentional pauses. */
  timerStateLabel: string;
  syncTone: HealthTone;
  syncDisabled: boolean;
  syncLabel: string;
  syncTitle: string;
  onSync: () => void;
  /** null when screenshot monitoring is off for this employee. */
  capture: { state: CaptureState; label: string; title: string } | null;
  workedTodayLabel: string;
  activityPercent: number;
  agentVersion: string;
};

const CAPTURE_CLASS: Record<CaptureState, string> = {
  active: "text-ok",
  queued: "text-warn",
  paused: "text-muted",
};

export function StatusBar({
  tone,
  timerStateLabel,
  syncTone,
  syncDisabled,
  syncLabel,
  syncTitle,
  onSync,
  capture,
  workedTodayLabel,
  activityPercent,
  agentVersion,
}: Props) {
  return (
    <footer className="app-statusbar">
      <div className="flex h-8 w-full min-w-0 items-center justify-between gap-3 px-4 text-[9.5px] font-semibold uppercase tracking-[0.1em]">
        <div className="app-statusbar-states flex min-w-0 items-center gap-4">
          <span className="app-statusbar-timer flex items-center gap-1.5 whitespace-nowrap" data-tone={tone}>
            <span className="app-tone-dot" aria-hidden="true" />
            <span title={timerStateLabel}>{timerStateLabel}</span>
          </span>
          <button
            type="button"
            className={`app-status-btn ${syncTone === "ok" ? "text-ok" : syncTone === "warning" ? "text-warn" : syncTone === "error" ? "text-bad" : "text-muted"}`}
            onClick={onSync}
            disabled={syncDisabled}
            title={syncTitle}
          >
            <i className={`${syncTone === "ok" ? "ri-cloud-line" : "ri-cloud-off-line"} text-[11px]`} aria-hidden="true" />
            <span>{syncLabel}</span>
          </button>
          {capture ? (
            <span
              className={`app-statusbar-capture flex items-center gap-1.5 whitespace-nowrap ${CAPTURE_CLASS[capture.state]}`}
              title={capture.title}
            >
              <i className="ri-camera-line text-[11px]" aria-hidden="true" />
              {capture.label}
            </span>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center gap-5">
          <span className="app-statusbar-worked whitespace-nowrap">
            Worked today <span className="app-num text-ink-2">{workedTodayLabel}</span>
          </span>
          <span className="app-statusbar-activity whitespace-nowrap">
            Activity <span className="app-num text-ink-2">{activityPercent}%</span>
          </span>
          <span className="whitespace-nowrap text-faint">v{agentVersion}</span>
        </div>
      </div>
    </footer>
  );
}
