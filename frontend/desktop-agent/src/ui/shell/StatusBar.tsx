import type { ShellTone } from "./TopBar";

export type CaptureState = "active" | "queued" | "paused";

type Props = {
  tone: ShellTone;
  /** App.tsx: "Timer paused" | "Timer running" | "Idle". */
  timerStateLabel: string;
  syncOk: boolean;
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
  syncOk,
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
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex items-center gap-1.5 whitespace-nowrap" data-tone={tone}>
            <span className="app-tone-dot" aria-hidden="true" />
            {timerStateLabel}
          </span>
          <button
            type="button"
            className={`app-status-btn ${syncOk ? "text-ok" : "text-bad"}`}
            onClick={onSync}
            title={syncTitle}
          >
            <i className={`${syncOk ? "ri-cloud-line" : "ri-cloud-off-line"} text-[11px]`} aria-hidden="true" />
            {syncLabel}
          </button>
          {capture ? (
            <span
              className={`flex items-center gap-1.5 whitespace-nowrap ${CAPTURE_CLASS[capture.state]}`}
              title={capture.title}
            >
              <i className="ri-camera-line text-[11px]" aria-hidden="true" />
              {capture.label}
            </span>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center gap-5">
          <span className="whitespace-nowrap">
            Worked today <span className="app-num text-ink-2">{workedTodayLabel}</span>
          </span>
          <span className="whitespace-nowrap">
            Activity <span className="app-num text-ink-2">{activityPercent}%</span>
          </span>
          <span className="whitespace-nowrap text-faint">v{agentVersion}</span>
        </div>
      </div>
    </footer>
  );
}
