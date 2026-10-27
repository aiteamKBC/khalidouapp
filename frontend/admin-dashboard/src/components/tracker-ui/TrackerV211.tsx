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
import type { Appearance, AppearancePatch } from "../../../../shared/appearance-store";
import { appearanceVariables } from "../../../../shared/appearance-palettes";
import "./readdy-reference.css";
import "./tracker.css";
import "./readdy-alignment.css";

// Readdy V211 /app, connected to the authenticated employee APIs.
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
  const [style, setStyle] = useState<TimerStyle>("ring");
  const [localSkin, setLocalSkin] = useState("violet");
  const skin = appearance ? (appearance.skin === "orbit" ? "violet" : appearance.skin) : localSkin;
  const setSkin = (value: string) => {
    if (onAppearanceChange)
      onAppearanceChange({ skin: value === "violet" ? "orbit" : (value as Appearance["skin"]) });
    else setLocalSkin(value);
  };
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  useEffect(() => {
    const savedStyle = savedPreference("khaliduo-timer-style-v3", "ring");
    const savedSkin = savedPreference("khaliduo-app-skin-v4", "violet");
    if (savedStyle === "bar") setStyle("minimal");
    else if (isTimerStyle(savedStyle)) setStyle(savedStyle);
    if (["ember", "forest", "violet"].includes(savedSkin)) setLocalSkin(savedSkin);
    setPreferencesLoaded(true);
  }, []);
  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem("khaliduo-timer-style-v3", style);
    } catch {
      /* device preference */
    }
  }, [style, preferencesLoaded]);
  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem("khaliduo-app-skin-v4", skin);
    } catch {
      /* device preference */
    }
  }, [skin, preferencesLoaded]);
  const nav = (dock: boolean) => (
    <nav
      aria-label={dock ? "Workspace dock" : "Tracker sections"}
      className={dock ? "v211-dock-nav" : "v211-top-nav"}
    >
      {sections
        .filter((section) => sections.length <= 6 || !["requests", "meeting"].includes(section.id))
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
        style={appearance ? (appearanceVariables(appearance) as CSSProperties) : undefined}
        data-tone={dataTone}
        className={`readdy-tracker-ui app-shell tracker-frame ${theme === "dark" ? "app-dark dark" : ""} ${native ? "tracker-native k-app k-readdy" : ""}`}
      >
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
                <i className={running ? "tracker-live-dot" : "tracker-paused-dot"} />
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
                  {(
                    [
                      ["violet", "Orbit"],
                      ["ember", "Ember"],
                      ["forest", "Forest"],
                    ] as const
                  ).flatMap(([value, label]) =>
                    (["light", "dark"] as const).map((mode) => (
                      <button
                        type="button"
                        key={`${value}-${mode}`}
                        aria-pressed={skin === value && theme === mode}
                        onClick={(event) => {
                          if (onAppearanceChange)
                            onAppearanceChange({
                              skin: value === "violet" ? "orbit" : value,
                              mode,
                            });
                          else {
                            setSkin(value);
                            if (theme !== mode) onThemeChange();
                          }
                          event.currentTarget.closest("details")?.removeAttribute("open");
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
                    .filter((section) => ["requests", "meeting"].includes(section.id))
                    .map((section) => (
                      <button
                        type="button"
                        key={section.id}
                        onClick={(event) => {
                          onViewChange(section.id);
                          event.currentTarget.closest("details")?.removeAttribute("open");
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
        <main ref={contentRef} className="tracker-content" data-motion-scroller="">
          {children}
        </main>
        {sections.length > 0 && (
          <div className="app-dock v211-dock">
            <div className="app-dock-bar">{nav(true)}</div>
          </div>
        )}
        <footer className="app-statusbar tracker-statusbar">
          <span>
            <i className={running ? "tracker-live-dot" : "tracker-paused-dot"} />
            {stateLabel}
          </span>
          <button type="button" onClick={onSync}>
            {synced ? "Synced" : "Time saved · sync pending"}
          </button>
          <span className="v211-status-time">Worked today {clock(seconds)}</span>
          {version && <span>v{version}</span>}
        </footer>
      </div>
    </TimerContext.Provider>
  );
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
    targetSeconds > 0 ? Math.min(100, Math.round((counted / targetSeconds) * 100)) : 0;
  const activity =
    activityPct === null ? "—" : `${Math.max(0, Math.min(100, Math.round(activityPct)))}%`;
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
          event.target.closest('input, textarea, select, [contenteditable="true"]'))
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
      note: running ? "Active right now" : stateLabel,
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
      note: targetSeconds > 0 ? `${progress}% fulfilled today` : "No target configured",
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
    <section className="v211-tracker" aria-label={`${name}'s tracking workspace`}>
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
                .filter((task) => !projectId || task.projectId === projectId || task.id === taskId)
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
          {onNoteSubmit ? (
            <button type="submit" disabled={!note.trim() || noteSaving} className="v211-save-note">
              {noteSaving ? "Saving…" : "Save"}
            </button>
          ) : null}
        </form>
        <button type="button" className="tp-ghost" onClick={onOpenShots}>
          <TrackerIcon className="ri-image-line" aria-hidden="true" />
          Screenshots
        </button>
        {onOpenAttendance ? (
          <button type="button" className="tp-ghost v216-shift-action" onClick={onOpenAttendance}>
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
              <i className={running ? "tracker-live-dot" : "tracker-paused-dot"} />
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
                <i className={synced ? "tracker-live-dot" : "tracker-paused-dot"} />
                {synced ? "Connected & synced" : "Sync pending"}
              </span>
            ) : null}
          </header>
          <div className="v211-timer-area">
            <p className="tp-eyebrow">Elapsed work time</p>
            <div className="v211-timer-face">
              <SwipeTimer
                style={timer.style}
                onChange={timer.change}
                seconds={counted}
                targetSeconds={targetSeconds}
                running={running}
                compact
              />
            </div>
            <p className="v211-task-caption">
              <TrackerIcon className="ri-arrow-right-up-line" aria-hidden="true" />
              {activeTask?.name ??
                projects.find((project) => project.id === projectId)?.name ??
                "No task selected"}
            </p>
            <div className="v211-goal">
              <span className="tp-eyebrow">Daily goal</span>
              <strong>{targetSeconds > 0 ? `${progress}%` : "—"}</strong>
              <p>
                {clock(counted).slice(0, 5)} logged ·{" "}
                {clock(Math.max(0, targetSeconds - counted)).slice(0, 5)} remaining
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
                  {controlBusy ? "Updating…" : running ? "Pause Tracker" : "Resume Tracker"}
                </button>
                <button
                  type="button"
                  className="tp-action"
                  disabled={controlBusy || !running}
                  onClick={onToggle}
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
              <span className="tp-tag">{Math.floor(counted / 3600)}H logged</span>
            </header>
            <ul>
              {timeline.length ? (
                timeline.map((row) => (
                  <li
                    key={row.id}
                    className={
                      row.kind === "idle"
                        ? "is-away is-idle"
                        : row.kind === "worked" || row.kind === "manual" ? "is-work" : "is-away"
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
                  <span>Synced</span>
                </span>
              ) : null}
            </button>
            <footer>
              <span>Workplace capture</span>
              <span className="v216-capture-status">
                {screenshotsEnabled === false ? "Capture disabled" : "Company schedule"}
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
              <button type="button" className="tp-stat-note" onClick={onExplainIdle}>
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
      {children}
    </section>
  );
}
