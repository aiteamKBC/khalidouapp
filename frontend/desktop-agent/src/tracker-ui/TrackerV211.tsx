import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { clock, isTimerStyle, type TimerStyle } from "./timer-style";
import TimerStylePicker from "./TimerStylePicker";
import SwipeTimer from "./SwipeTimer";
import SelectMenu from "./SelectMenu";
import { TrackerIcon } from "./TrackerIcon";
import type { Appearance, AppearancePatch } from "../../../shared/appearance-store";
import { appearanceVariables } from "../../../shared/appearance-palettes";
import { timedBreakState } from "../../electron/services/timedBreak";
import { screenshotSyncLabel } from "../screenshotRecovery";
import "./break-timer.css";
import "./readdy-reference.css";
import "./tracker.css";
import "./readdy-alignment.css";
import "./compact-tracker.css";
import "./progressive-tracker.css";

// Readdy V211 /app, connected to the desktop's existing tracking and request APIs.
const TimerContext = createContext<{
  style: TimerStyle;
  change: (style: TimerStyle) => void;
}>({ style: "ring", change: () => {} });
export type TrackerSection = { id: string; label: string; icon: string };
export type TrackerTask = { id: string; name: string; projectId: string };
export type TrackerTimelineRow = {
  id: string;
  label: string;
  time: string;
  seconds: number;
  kind: string;
  current?: boolean;
  category?: string | null;
};

function savedPreference(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

const TRACKER_SKINS = [
  ["violet", "Orbit"],
  ["ember", "Ember"],
  ["forest", "Forest"],
] as const;

export function TrackerFrame({
  name,
  email,
  avatar,
  logo,
  theme,
  onThemeChange,
  appearance,
  onAppearanceChange,
  sections,
  view,
  onViewChange,
  seconds,
  running,
  stateLabel,
  shiftLabel,
  shotsLabel,
  synced,
  onSync,
  onDashboard,
  headerControls,
  version,
  children,
  native = false,
  dataTone,
}: {
  name: string;
  email?: string | null;
  avatar?: string | null;
  logo: string;
  theme: "light" | "dark";
  onThemeChange: () => void;
  appearance?: Appearance;
  onAppearanceChange?: (patch: AppearancePatch) => void;
  sections: TrackerSection[];
  view: string;
  onViewChange: (view: string) => void;
  seconds: number;
  running: boolean;
  stateLabel: string;
  shiftLabel: string;
  shotsLabel: string;
  synced: boolean;
  onSync: () => void;
  onDashboard: () => void;
  headerControls?: ReactNode;
  version?: string;
  children: ReactNode;
  native?: boolean;
  dataTone?: string;
}) {
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [view]);
  const [style, setStyle] = useState<TimerStyle>(() => {
    const saved = savedPreference("khaliduo-timer-style-v3", "ring");
    if (saved === "bar") return "minimal";
    return isTimerStyle(saved) ? saved : "ring";
  });
  const [localSkin, setLocalSkin] = useState(() => {
    const saved = savedPreference("khaliduo-app-skin-v4", "violet");
    return ["ember", "forest", "violet"].includes(saved) ? saved : "violet";
  });
  const skin = appearance ? (appearance.skin === "orbit" ? "violet" : appearance.skin) : localSkin;
  const setSkin = (value: string) => {
    if (onAppearanceChange) onAppearanceChange({ skin: value === "violet" ? "orbit" : value as Appearance["skin"] });
    else setLocalSkin(value);
  };
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!paletteOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !paletteRef.current?.contains(event.target)) {
        setPaletteOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPaletteOpen(false);
        paletteRef.current?.querySelector<HTMLButtonElement>(".compact-palette-toggle")?.focus();
      }
    };
    const resize = () => setPaletteOpen(false);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", resize);
    };
  }, [paletteOpen]);
  useEffect(() => {
    try {
      localStorage.setItem("khaliduo-timer-style-v3", style);
    } catch {
      /* device preference */
    }
  }, [style]);
  useEffect(() => {
    try {
      localStorage.setItem("khaliduo-app-skin-v4", skin);
    } catch {
      /* device preference */
    }
  }, [skin]);
  const nav = (dock: boolean) => (
    <nav
      aria-label={dock ? "Workspace dock" : "Tracker sections"}
      className={dock ? "v211-dock-nav" : "v211-top-nav"}
    >
      {sections
        .filter(
          (section) =>
            sections.length <= 6 ||
            !["requests", "meeting"].includes(section.id),
        )
        .map((section) => (
          <button
            type="button"
            key={section.id}
            className={`${dock ? "app-dock-tab" : "app-nav-pill"}${section.id === view ? " is-active" : ""}`}
            aria-current={section.id === view ? "page" : undefined}
            onClick={() => onViewChange(section.id)}
          >
            <TrackerIcon className={section.icon} aria-hidden="true" />
            <span className={dock ? "app-dock-label" : undefined}>
              {section.id === "screenshots"
                ? "Shots"
                : section.id === "attendance"
                  ? "Shift"
                  : section.label}
            </span>
          </button>
        ))}
    </nav>
  );
  return (
    <TimerContext.Provider value={{ style, change: setStyle }}>
      <div
        data-theme={theme}
        data-skin={skin}
        data-tone={dataTone}
        data-view={view}
        style={appearance ? appearanceVariables(appearance) as CSSProperties : undefined}
        className={`readdy-tracker-ui app-shell tracker-frame ${theme === "dark" ? "app-dark dark" : ""} ${native ? "tracker-native k-app k-readdy" : ""}`}
      >
        {native && (
          <div className="compact-window-bar">
            <span className="compact-drag-handle" title="Drag to move; double-click to maximize" />
            <button
              type="button"
              className="compact-theme-toggle"
              onClick={onThemeChange}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              <TrackerIcon className={theme === "dark" ? "ri-sun-line" : "ri-moon-line"} />
            </button>
            <div ref={paletteRef} className="compact-palette-picker">
              <button
                type="button"
                className="compact-palette-toggle"
                aria-label="Color theme"
                title="Color theme"
                aria-expanded={paletteOpen}
                aria-controls="compact-color-themes"
                onClick={() => setPaletteOpen((open) => !open)}
              >
                <TrackerIcon className="ri-palette-line" aria-hidden="true" />
              </button>
              {paletteOpen && (
                <div id="compact-color-themes" className="compact-palette-panel" role="group" aria-label="Color themes">
                  <strong>Color theme</strong>
                  {TRACKER_SKINS.map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={skin === value}
                      onClick={() => {
                        setSkin(value);
                        setPaletteOpen(false);
                        paletteRef.current?.querySelector<HTMLButtonElement>(".compact-palette-toggle")?.focus();
                      }}
                    >
                      <i className={`compact-palette-swatch is-${value}`} />
                      <span>{label}</span>
                      {skin === value && <TrackerIcon className="ri-check-line" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {headerControls}
          </div>
        )}
        <div className="v211-watermark" aria-hidden="true">
          <span
            className="v216-watermark-horse"
            style={{ maskImage: 'url("./employee-workspace/horse.png")' }}
          />
          <span
            className="v216-watermark-bird"
            style={{ maskImage: 'url("./employee-workspace/bird.png")' }}
          />
        </div>
        <header className="app-topbar v211-topbar">
          <div className="v216-topbar-inner">
            <button
              type="button"
              className="v211-brand"
              onClick={onDashboard}
              aria-label="Open web dashboard"
            >
              <img src={logo} alt="Khaliduo" />
              <span>
                <strong>Khaliduo</strong>
                <small>ENTERPRISE</small>
              </span>
            </button>
            {nav(false)}
            <div className="v211-top-actions">
              <span
                className="app-pill app-pill-live v211-shift"
                title={`${stateLabel} · ${shiftLabel}`}
              >
                <i
                  className={
                    running ? "tracker-live-dot" : "tracker-paused-dot"
                  }
                />
                <span>{running ? "Active shift" : stateLabel}</span>
                <strong>{clock(seconds)}</strong>
              </span>
              <button
                type="button"
                className="app-nav-btn"
                onClick={onSync}
                aria-label={synced ? "Sync now" : "Retry sync"}
                title={synced ? "Sync now" : "Retry sync"}
              >
                <TrackerIcon className="ri-refresh-line" aria-hidden="true" />
              </button>
              <details className="v211-theme-picker">
                <summary aria-label="Appearance" title="Appearance">
                  <TrackerIcon className="ri-palette-line" aria-hidden="true" />
                </summary>
                <div className="v211-theme-panel">
                  <strong>Appearance</strong>
                  {TRACKER_SKINS.flatMap(([value, label]) =>
                    (["light", "dark"] as const).map((mode) => (
                      <button
                        type="button"
                        key={`${value}-${mode}`}
                        aria-pressed={skin === value && theme === mode}
                        onClick={(event) => {
                          if (onAppearanceChange) onAppearanceChange({ skin: value === "violet" ? "orbit" : value, mode });
                          else { setSkin(value); if (theme !== mode) onThemeChange(); }
                          event.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                        }}
                      >
                        <i className={`v211-swatch is-${value}`} />
                        {label} {mode === "light" ? "Light" : "Dark"}
                      </button>
                    )),
                  )}
                </div>
              </details>
              <details className="v216-account-menu">
                <summary
                  className="v211-account"
                  title={email ?? name}
                  aria-label="Account and more sections"
                >
                  <span className="v211-avatar">
                    {avatar ? <img src={avatar} alt="" /> : name.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{name}</strong>
                    <small>Employee workspace</small>
                  </span>
                </summary>
                <div className="v216-account-panel">
                  <span>{email ?? name}</span>
                  {sections
                    .filter((section) =>
                      ["requests", "meeting"].includes(section.id),
                    )
                    .map((section) => (
                      <button
                        type="button"
                        key={section.id}
                        onClick={(event) => {
                          onViewChange(section.id);
                          event.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                        }}
                      >
                        <TrackerIcon className={section.icon} />
                        {section.label}
                      </button>
                    ))}
                  <button type="button" onClick={onDashboard}>
                    Open web dashboard
                  </button>
                  <small>{shotsLabel}</small>
                </div>
              </details>
              {headerControls}
            </div>
          </div>
        </header>
        <main
          ref={contentRef}
          className="tracker-content"
          data-motion-scroller=""
        >
          {children}
        </main>
        {sections.length > 0 && (
          <div className="app-dock v211-dock">
            <div className="app-dock-bar">{nav(true)}</div>
          </div>
        )}
        <footer className="app-statusbar tracker-statusbar">
          <span>
            <i
              className={running ? "tracker-live-dot" : "tracker-paused-dot"}
            />
            {stateLabel}
          </span>
          <button type="button" onClick={onSync}>
            {synced ? "Synced" : "Time saved · sync pending"}
          </button>
          <span className="v211-status-time">
            Worked today {clock(seconds)}
          </span>
          {version && <span>v{version}</span>}
        </footer>
      </div>
    </TimerContext.Provider>
  );
}

function BreakTimer({ startedAt, accumulatedSeconds = 0 }: { startedAt?: string | null; accumulatedSeconds?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
    };
  }, [startedAt]);
  const state = timedBreakState(startedAt, startedAt ? Math.max(now, Date.parse(startedAt)) : now, accumulatedSeconds);
  if (!state) return null;
  const elapsed = `${String(Math.floor(state.seconds / 60)).padStart(2, "0")}:${String(state.seconds % 60).padStart(2, "0")}`;
  const remaining = clock(state.remainingSeconds).slice(3);
  return <span
    className={`tracker-break-timer${state.warning ? " is-warning" : ""}`}
    role="timer"
    aria-label={`Break ${elapsed}. ${state.running ? `Shift ends in ${remaining} of break time.` : "Break timer paused."}`}
    title={state.running ? `Your shift ends after ${remaining} more break time. Resume tracking to pause this timer.` : "Break timer paused. Take Break continues from this time."}
  >Break <time>{elapsed}</time>{!state.running && <small>Paused</small>}</span>;
}

export function TrackerStage({
  name,
  projects,
  projectId,
  onProjectChange,
  tasks,
  taskId,
  onTaskChange,
  selectionDisabled,
  note,
  onNoteChange,
  onNoteSubmit,
  noteSaving = false,
  running,
  stateLabel,
  seconds,
  timerSeconds = seconds,
  timerLabel = "Elapsed work time",
  targetSeconds,
  sessionSeconds,
  weekSeconds,
  activityPct,
  idleSeconds,
  overtimeSeconds,
  approvedSeconds,
  pendingSeconds,
  rejectedSeconds,
  shiftLabel,
  startedAt,
  lastActivityAt,
  onToggle,
  onTakeBreak,
  breakStartedAt,
  breakElapsedSeconds,
  onEndShift,
  onOpenAttendance,
  deviceLabel,
  synced,
  screenshotsEnabled,
  controlBusy,
  onExplainIdle,
  screenshot,
  screenshotTime,
  onOpenShots,
  timeline,
  children,
}: {
  name: string;
  avatar?: string | null;
  projects: { id: string; name: string }[];
  projectId: string;
  onProjectChange: (id: string) => void;
  tasks: TrackerTask[];
  taskId: string;
  onTaskChange: (id: string) => void;
  selectionDisabled?: boolean;
  note: string;
  onNoteChange: (note: string) => void;
  onNoteSubmit?: () => void;
  noteSaving?: boolean;
  running: boolean;
  stateLabel: string;
  seconds: number;
  timerSeconds?: number;
  timerLabel?: string;
  targetSeconds: number;
  sessionSeconds: number;
  weekSeconds: number;
  activityPct: number | null;
  idleSeconds: number;
  overtimeSeconds: number;
  approvedSeconds: number;
  pendingSeconds: number;
  rejectedSeconds: number;
  shiftLabel: string;
  startedAt: string | null;
  lastActivityAt: string | null;
  onToggle?: () => void;
  onTakeBreak?: () => void;
  breakStartedAt?: string | null;
  breakElapsedSeconds?: number;
  onEndShift?: () => void;
  onOpenAttendance?: () => void;
  deviceLabel?: string | null;
  synced?: boolean;
  screenshotsEnabled?: boolean;
  controlBusy?: boolean;
  onExplainIdle: () => void;
  screenshot: ReactNode;
  screenshotTime: string | null;
  onOpenShots: () => void;
  timeline: TrackerTimelineRow[];
  children?: ReactNode;
}) {
  const timer = useContext(TimerContext);
  const counted = Math.max(0, seconds);
  const progress =
    targetSeconds > 0
      ? Math.min(100, Math.round((counted / targetSeconds) * 100))
      : 0;
  const activity =
    activityPct === null
      ? "—"
      : `${Math.max(0, Math.min(100, Math.round(activityPct)))}%`;
  const activeTask = tasks.find((task) => task.id === taskId);
  useEffect(() => {
    if (!onToggle || controlBusy) return;
    const shortcut = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        event.code !== "KeyP" ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            'input, textarea, select, [contenteditable="true"]',
          ))
      )
        return;
      event.preventDefault();
      onToggle();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [onToggle, controlBusy]);
  const stats = [
    {
      label: "Current session",
      value: clock(sessionSeconds),
      icon: "ri-timer-line",
      note: stateLabel,
    },
    {
      label: "Weekly total",
      value: clock(weekSeconds),
      icon: "ri-calendar-check-line",
      note: "Counted this week",
    },
    {
      label: "Daily target",
      value: `${clock(counted).slice(0, 5)} / ${clock(targetSeconds).slice(0, 5)}`,
      icon: "ri-flag-line",
      note:
        targetSeconds > 0
          ? `${progress}% fulfilled today`
          : "No target configured",
      bar: true,
    },
    {
      label: "Activity score",
      value: activity,
      icon: "ri-bar-chart-line",
      note: "Recorded input activity",
    },
    {
      label: "Idle time",
      value: clock(idleSeconds),
      icon: "ri-hourglass-line",
      note: idleSeconds > 0 ? "Explain idle time" : "No idle time",
    },
    {
      label: "Shift opened",
      value: startedAt ?? "Not started",
      icon: "ri-login-box-line",
      note: `Last activity ${lastActivityAt ?? "not recorded"}`,
    },
  ];
  return (
    <section
      className="v211-tracker"
      aria-label={`${name}'s tracking workspace`}
    >
      <section className="compact-tracker-card" aria-label="Compact work timer">
        <header className="compact-tracker-header">
          <span className="compact-tracker-state">
            <i />{stateLabel}
          </span>
          {deviceLabel && <span className="compact-device">#{deviceLabel}</span>}
          <span className={`compact-sync ${synced ? "is-synced" : ""}`}>
            <i />{synced ? "Connected & synced" : "Sync pending"}
          </span>
        </header>
        <div className="compact-tracker-session">
          <div className="compact-time-info">
            <p className="compact-eyebrow">{timerLabel}</p>
            <div className="compact-clock" aria-label={`${timerLabel} ${clock(timerSeconds)}`}>
              {clock(timerSeconds).split(":").map((part, index) => (
                <span key={index}>{index > 0 && <b>:</b>}{part}</span>
              ))}
            </div>
            <BreakTimer startedAt={breakStartedAt} accumulatedSeconds={breakElapsedSeconds} />
            <p className="compact-task-caption">
              <TrackerIcon className="ri-arrow-right-up-line" aria-hidden="true" />
              <span>{activeTask?.name ?? (running ? "Your work session is being tracked" : "Ready when you are")}</span>
            </p>
          </div>
          <div className="compact-goal" aria-label={targetSeconds > 0 ? `${progress}% of daily goal` : "No daily target configured"}>
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle className="compact-goal-track" cx="60" cy="60" r="50" />
              <circle className="compact-goal-fill" cx="60" cy="60" r="50" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - progress} />
            </svg>
            <div><strong>{targetSeconds > 0 ? `${progress}%` : "—"}</strong><span>Daily goal</span></div>
          </div>
        </div>
        <div className="compact-progress-panel">
          <div>
            <span>{targetSeconds > 0 ? `${progress}% of ${clock(targetSeconds)} Daily Target` : "No daily target configured"}</span>
            <span>{clock(Math.max(0, targetSeconds - counted))} Remaining</span>
          </div>
          <div className="compact-progress-track" role="progressbar" aria-label="Daily target" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="compact-tracker-controls">
          {onToggle ? <>
            <button type="button" className="compact-toggle" disabled={controlBusy} onClick={onToggle}>
              <TrackerIcon className={running ? "ri-pause-circle-line" : "ri-play-circle-line"} />
              {controlBusy ? "Updating…" : running ? "Pause Tracker" : "Resume Tracker"}
            </button>
            <button type="button" className="compact-break" disabled={controlBusy || !running} onClick={onTakeBreak}>
              <TrackerIcon className="ri-cup-line" />Take Break
            </button>
            <span className="compact-shortcut">Shortcut: <kbd>Alt + P</kbd></span>
          </> : <p>Control tracking from your desktop app.</p>}
        </div>
      </section>
      <div className="v211-quickbar">
        <div className="tp-pill">
          <label htmlFor="live-project" className="tp-pill-key">
            Project:
          </label>
          <SelectMenu
            id="live-project"
            ariaLabel="Project"
            variant="app"
            value={projectId}
            options={[
              { value: "", label: "All projects" },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
            onChange={onProjectChange}
            disabled={selectionDisabled}
          />
        </div>
        <div className="tp-pill">
          <TrackerIcon className="ri-focus-line" aria-hidden="true" />
          <SelectMenu
            id="live-task"
            ariaLabel="Task"
            variant="app"
            value={taskId}
            options={[
              { value: "", label: "Choose a task…" },
              ...tasks
                .filter(
                  (task) =>
                    !projectId ||
                    task.projectId === projectId ||
                    task.id === taskId,
                )
                .map((task) => ({ value: task.id, label: task.name })),
            ]}
            onChange={onTaskChange}
            disabled={selectionDisabled}
          />
        </div>
        <form
          className="tp-pill v211-note"
          onSubmit={(event) => {
            event.preventDefault();
            onNoteSubmit?.();
          }}
        >
          <TrackerIcon className="ri-quill-pen-line" aria-hidden="true" />
          <input
            id="live-note"
            aria-label="New task name"
            disabled={noteSaving}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            maxLength={255}
            placeholder="Create a new task…"
          />
          {onNoteSubmit && (
            <button type="submit" disabled={!note.trim() || noteSaving} className="v211-save-note">
              {noteSaving ? "Saving…" : "Save"}
            </button>
          )}
        </form>
        <button type="button" className="tp-ghost" onClick={onOpenShots}>
          <TrackerIcon className="ri-image-line" aria-hidden="true" />
          Screenshots
        </button>
        {onOpenAttendance ? (
          <button
            type="button"
            className="tp-ghost v216-shift-action"
            onClick={onOpenAttendance}
          >
            <TrackerIcon className="ri-focus-3-line" />
            Shift details
          </button>
        ) : null}
      </div>
      <div className="v211-stage-grid">
        <section
          className="tp-card tp-hero v211-hero"
          style={
            {
              "--tp-goal": `${progress}%`,
              "--tp-deg": `${progress * 3.6}deg`,
            } as CSSProperties
          }
        >
          <header className="v211-hero-header">
            <span className="tp-tag">
              <i
                className={running ? "tracker-live-dot" : "tracker-paused-dot"}
              />
              {stateLabel}
            </span>
            <span className="v211-shift-label">
              {deviceLabel ? `ID: ${deviceLabel}` : shiftLabel}
            </span>
            <div className="tracker-style-picker">
              <TimerStylePicker value={timer.style} onChange={timer.change} />
            </div>
            {synced !== undefined ? (
              <span className="v216-sync-label">
                <i
                  className={synced ? "tracker-live-dot" : "tracker-paused-dot"}
                />
                {synced ? "Connected & synced" : "Sync pending"}
              </span>
            ) : null}
          </header>
          <div className="v211-timer-area">
            <p className="tp-eyebrow">{timerLabel}</p>
            <div className="v211-timer-face" data-timer-style={timer.style}>
              <SwipeTimer
                style={timer.style}
                onChange={timer.change}
                seconds={timerSeconds}
                targetSeconds={targetSeconds}
                running={running}
                compact
              />
              <BreakTimer startedAt={breakStartedAt} accumulatedSeconds={breakElapsedSeconds} />
            </div>
            <p className="v211-task-caption">
              <TrackerIcon
                className="ri-arrow-right-up-line"
                aria-hidden="true"
              />
              {activeTask?.name ??
                projects.find((project) => project.id === projectId)?.name ??
                "No task selected"}
            </p>
            <div className="v211-goal">
              <span className="tp-eyebrow">Daily goal</span>
              <strong>{targetSeconds > 0 ? `${progress}%` : "—"}</strong>
              <p>
                {clock(counted).slice(0, 5)} logged ·{" "}
                {clock(Math.max(0, targetSeconds - counted)).slice(0, 5)}{" "}
                remaining
              </p>
            </div>
          </div>
          <div className="v211-controls">
            {onToggle ? (
              <>
                <button
                  type="button"
                  className="tp-cta tracker-cta"
                  disabled={controlBusy}
                  onClick={onToggle}
                >
                  <TrackerIcon
                    className={running ? "ri-pause-line" : "ri-play-line"}
                    aria-hidden="true"
                  />
                  {controlBusy
                    ? "Updating…"
                    : running
                      ? "Pause Tracker"
                      : "Resume Tracker"}
                </button>
                <button
                  type="button"
                  className="tp-action"
                  disabled={controlBusy || !running}
                  onClick={onTakeBreak}
                >
                  <TrackerIcon className="ri-cup-line" aria-hidden="true" />
                  Take Break
                </button>
                {onEndShift ? (
                  <button
                    type="button"
                    className="tp-action"
                    disabled={controlBusy}
                    onClick={onEndShift}
                  >
                    <TrackerIcon className="ri-stop-circle-line" />
                    End Shift
                  </button>
                ) : null}
              </>
            ) : (
              <p>Pause or resume tracking from your desktop app.</p>
            )}
          </div>
        </section>
        <aside className="v211-right-rail">
          <section className="tp-card v211-timeline">
            <header>
              <h2>
                <TrackerIcon className="ri-task-line" aria-hidden="true" />
                Today’s Timeline
              </h2>
              <span className="tp-tag">
                {Math.floor(counted / 3600)}H logged
              </span>
            </header>
            <ul>
              {timeline.length ? (
                timeline.map((row) => (
                  <li
                    key={row.id}
                    className={
                      row.kind === "idle"
                        ? "is-away is-idle"
                        : row.kind === "worked" || row.kind === "manual"
                        ? "is-work"
                        : "is-away"
                    }
                  >
                    <i />
                    <div>
                      <div className="v216-timeline-heading">
                        <strong>
                          {row.current && row.kind === "worked"
                            ? "Worked (Current Session)"
                            : ({
                                worked: "Worked",
                                manual: "Manual time",
                                idle: "Idle",
                                break: "Scheduled break",
                                locked: "Screen locked",
                                sleeping: "Sleeping",
                                untracked: "Untracked",
                              }[row.kind] ?? row.kind)}
                        </strong>
                        <span>{row.time}</span>
                      </div>
                      <small>{row.label}</small>
                    </div>
                    <span
                      className={`tp-tl-chip ${row.kind === "idle" ? "is-idle" : row.current ? "is-live" : row.kind === "break" ? "is-rest" : row.category ? "is-overtime" : ""}`}
                      title={clock(row.seconds)}
                    >
                      {row.current
                        ? "Ongoing"
                        : row.kind === "worked"
                          ? row.category
                            ? "Overtime"
                            : "Shift"
                          : row.kind}
                    </span>
                  </li>
                ))
              ) : (
                <li>No work sessions recorded yet.</li>
              )}
            </ul>
            <footer>Last activity {lastActivityAt ?? "not recorded"}</footer>
          </section>
          <section className="tp-card v211-latest-shot">
            <header>
              <h2>
                <TrackerIcon className="ri-image-line" aria-hidden="true" />
                Latest Screenshot
              </h2>
              <button type="button" onClick={onOpenShots}>
                View all →
              </button>
            </header>
            <button
              type="button"
              className="tracker-screenshot"
              onClick={onOpenShots}
              aria-label="Open latest screenshots"
            >
              {screenshot ?? (
                <span className="v216-empty-capture">
                  <TrackerIcon className="ri-image-line" />
                  <strong>
                    {screenshotsEnabled === false
                      ? "Screenshot capture is disabled"
                      : "No captures yet"}
                  </strong>
                  <small>
                    {screenshotsEnabled === false
                      ? "Your company has disabled captures for this account."
                      : "Your next workplace capture will appear here."}
                  </small>
                </span>
              )}
              {screenshot && screenshotTime ? (
                <span className="v216-shot-meta">
                  {screenshotTime}
                  <span>{screenshotSyncLabel(synced ? "online" : "offline")}</span>
                </span>
              ) : null}
            </button>
            <footer>
              <span>Workplace capture</span>
              <span className="v216-capture-status">
                {screenshotsEnabled === false
                  ? "Capture disabled"
                  : "Company schedule"}
              </span>
            </footer>
          </section>
        </aside>
      </div>
      <div className="tracker-summary-cards v211-stats">
        {stats.map((stat) => (
          <article className="tp-stat" key={stat.label}>
            <header>
              <span className="tp-stat-label">{stat.label}</span>
              <TrackerIcon className={stat.icon} aria-hidden="true" />
            </header>
            <strong className="tp-stat-value">{stat.value}</strong>
            {stat.bar && (
              <span className="tp-target-track">
                <span style={{ width: `${progress}%` }} />
              </span>
            )}
            {stat.label === "Idle time" && idleSeconds > 0 ? (
              <button
                type="button"
                className="tp-stat-note"
                onClick={onExplainIdle}
              >
                {stat.note}
              </button>
            ) : (
              <p className="tp-stat-note">{stat.note}</p>
            )}
          </article>
        ))}
      </div>
      <details className="v211-time-details">
        <summary>Time breakdown</summary>
        <div>
          {[
            { label: "Overtime recorded", seconds: overtimeSeconds },
            { label: "Manual approved", seconds: approvedSeconds },
            { label: "Manual pending", seconds: pendingSeconds },
            { label: "Manual rejected", seconds: rejectedSeconds },
          ].map((item) => (
            <span key={item.label}>
              {item.label}
              <strong>{clock(item.seconds)}</strong>
            </span>
          ))}
        </div>
      </details>
      <div className="v211-stage-messages">{children}</div>
    </section>
  );
}
