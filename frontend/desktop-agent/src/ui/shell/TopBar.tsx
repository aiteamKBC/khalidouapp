import logoUrl from "../assets/khaliduo-logo.png";
import type { Mode, Skin } from "../theme/skin";
import { ThemePicker } from "./ThemePicker";

export type ShellView = "home" | "tasks" | "requests" | "meeting" | "insights" | "settings";

/** Matches App.tsx's timerTone; the shell only colours by it. */
export type ShellTone = "running" | "paused" | "stopped" | "overtime";

type Props = {
  enrolled: boolean;
  activeView: ShellView;
  onViewChange: (view: ShellView) => void;
  onOpenDashboard: () => void;
  isOpeningDashboard: boolean;
  /** App.tsx statusText, unchanged. */
  statusText: string;
  /** App.tsx formatDuration(displayedTimerSeconds), unchanged. */
  timerLabel: string;
  tone: ShellTone;
  updateLabel: string;
  updateTitle: string;
  updateDisabled: boolean;
  /** Show the update as a labelled pill instead of an icon. */
  updateHighlighted: boolean;
  onUpdate: () => void;
  skin: Skin;
  mode: Mode;
  onSkin: (skin: Skin) => void;
  onMode: (mode: Mode) => void;
  employeeName: string;
  employeeAvatarUrl: string | null;
  employeeInitials: string;
  presenceLabel: string;
  presenceOk: boolean;
};

const NAV: { key: ShellView; label: string; icon: string; activeIcon: string }[] = [
  { key: "home", label: "Tracker", icon: "ri-timer-line", activeIcon: "ri-timer-flash-fill" },
  { key: "tasks", label: "Tasks", icon: "ri-task-line", activeIcon: "ri-task-fill" },
  { key: "requests", label: "Requests", icon: "ri-calendar-check-line", activeIcon: "ri-calendar-check-fill" },
  { key: "meeting", label: "Meeting", icon: "ri-video-chat-line", activeIcon: "ri-video-chat-fill" },
  { key: "insights", label: "Insights", icon: "ri-bar-chart-2-line", activeIcon: "ri-bar-chart-2-fill" },
  { key: "settings", label: "Settings", icon: "ri-settings-3-line", activeIcon: "ri-settings-3-fill" },
];

export function TopBar(props: Props) {
  const {
    enrolled,
    activeView,
    onViewChange,
    onOpenDashboard,
    isOpeningDashboard,
    statusText,
    timerLabel,
    tone,
    updateLabel,
    updateTitle,
    updateDisabled,
    updateHighlighted,
    onUpdate,
    skin,
    mode,
    onSkin,
    onMode,
    employeeName,
    employeeAvatarUrl,
    employeeInitials,
    presenceLabel,
    presenceOk,
  } = props;

  return (
    <header className="app-topbar">
      <div className="flex h-[60px] w-full min-w-0 items-center gap-3 pl-4 pr-2">
        <div className="flex flex-none items-center gap-2.5">
          <span className="app-logo-plate h-9 w-9 overflow-hidden">
            <img src={logoUrl} alt="Khaliduo" width={32} height={32} className="h-full w-full object-contain" />
          </span>
          <span className="app-hide-below-wide flex min-w-0 flex-col leading-none">
            <span className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-ink">Khaliduo</span>
            <span className="mt-1 truncate text-[7.5px] uppercase tracking-[0.24em] text-faint">
              Kent Consultancy
            </span>
          </span>
        </div>

        {enrolled ? (
          <>
            <span className="app-hide-below-wide h-6 w-px flex-none bg-line" aria-hidden="true" />
            <nav className="flex flex-none items-center gap-1" aria-label="Primary navigation">
              {NAV.map((item) => {
                const active = item.key === activeView;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onViewChange(item.key)}
                    aria-current={active ? "page" : undefined}
                    aria-label={item.label}
                    title={item.label}
                    className={`app-nav-pill${active ? " is-active" : ""}`}
                  >
                    <i className={`${active ? item.activeIcon : item.icon} text-[14px]`} aria-hidden="true" />
                    <span className="app-nav-label">{item.label}</span>
                    {item.key === "home" && tone !== "stopped" ? (
                      <span className="flex" data-tone={tone} aria-hidden="true">
                        <span className="app-tone-dot" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </>
        ) : null}

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <span className="app-pill min-w-[178px] max-w-[260px]" data-tone={tone} title={statusText} role="status">
            <span className="app-tone-dot" aria-hidden="true" />
            <span className="app-pill-label truncate">{statusText}</span>
            {enrolled ? <span className="app-num flex-none font-semibold text-ink">{timerLabel}</span> : null}
          </span>

          {enrolled ? (
            <button
              type="button"
              className="app-nav-btn"
              onClick={onOpenDashboard}
              disabled={isOpeningDashboard}
              aria-label="Dashboard"
              title="Open the web dashboard"
            >
              <i className="ri-external-link-line text-[15px]" aria-hidden="true" />
            </button>
          ) : null}

          {updateHighlighted ? (
            <button
              type="button"
              className="app-update-btn"
              onClick={onUpdate}
              disabled={updateDisabled}
              aria-label={updateLabel}
              title={updateTitle}
            >
              <i className="ri-download-cloud-2-line text-[14px]" aria-hidden="true" />
              <span className="app-hide-below-wide">{updateLabel}</span>
            </button>
          ) : (
            <button
              type="button"
              className="app-nav-btn"
              onClick={onUpdate}
              disabled={updateDisabled}
              aria-label={updateLabel}
              title={`${updateLabel} · ${updateTitle}`}
            >
              <i className="ri-refresh-line text-[15px]" aria-hidden="true" />
            </button>
          )}

          <ThemePicker skin={skin} mode={mode} onSkin={onSkin} onMode={onMode} />

          {enrolled ? (
            <div className="flex flex-none items-center gap-2 border-0 border-l border-solid border-line pl-2.5">
              <span
                className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full border border-solid border-plum-2 bg-card text-[11px] font-bold text-ink-2"
                title={`${employeeName} · ${presenceLabel}`}
              >
                {employeeAvatarUrl ? (
                  <img src={employeeAvatarUrl} alt="" className="h-full w-full object-cover object-top" />
                ) : (
                  employeeInitials
                )}
              </span>
              <span className="app-hide-below-wide flex min-w-0 max-w-[140px] flex-col leading-none">
                <span className="truncate text-[11.5px] font-semibold text-ink">{employeeName}</span>
                <span className={`mt-1 truncate text-[9.5px] font-semibold ${presenceOk ? "text-ok" : "text-bad"}`}>
                  {presenceLabel}
                </span>
              </span>
            </div>
          ) : null}

          <div className="flex flex-none items-center gap-0.5 pl-1" aria-label="Window controls">
            <button
              type="button"
              className="app-window-btn"
              aria-label="Minimize"
              onClick={() => void window.khaliduo?.minimizeWindow()}
            >
              <i className="ri-subtract-line text-[16px]" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="app-window-btn"
              aria-label="Maximize or restore"
              onClick={() => void window.khaliduo?.toggleMaximizeWindow()}
            >
              <i className="ri-checkbox-blank-line text-[13px]" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="app-window-btn is-close"
              aria-label="Close"
              onClick={() => void window.khaliduo?.closeWindow()}
            >
              <i className="ri-close-line text-[17px]" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
