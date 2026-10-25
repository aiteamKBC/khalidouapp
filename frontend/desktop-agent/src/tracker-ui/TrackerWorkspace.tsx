import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import TimerDisplay from "./TimerFaces";
import { clock, isTimerStyle, type TimerStyle } from "./timer-style";
import TimerStylePicker from "./TimerStylePicker";
import SelectMenu from "./SelectMenu";
import { TrackerIcon } from "./TrackerIcon";
import "./readdy-reference.css";
import "./tracker.css";

const TimerContext = createContext<{ style: TimerStyle; change: (style: TimerStyle) => void }>({
  style: "ring",
  change: () => {},
});
export type TrackerSection = { id: string; label: string; icon: string };
export type TrackerTask = { id: string; name: string; projectId: string };
export type TrackerTimelineRow = {
  id: string;
  label: string;
  time: string;
  seconds: number;
  kind: string;
};

export function TrackerFrame({
  name,
  email,
  avatar,
  logo,
  theme,
  onThemeChange,
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
  const [style, setStyle] = useState<TimerStyle>(() => {
    try {
      const saved =
        typeof window !== "undefined" ? localStorage.getItem("khaliduo-timer-style") : null;
      return isTimerStyle(saved) ? saved : "ring";
    } catch {
      return "ring";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("khaliduo-timer-style", style);
    } catch {
      /* unavailable storage leaves this session usable */
    }
  }, [style]);
  const title = sections.find((section) => section.id === view)?.label ?? "Tracker";
  const nav = (
    <nav aria-label="Tracker sections">
      {sections.map((section) => (
        <button
          type="button"
          key={section.id}
          className={`app-side-link ${section.id === view ? "app-side-active" : ""}`}
          aria-current={section.id === view ? "page" : undefined}
          onClick={() => onViewChange(section.id)}
        >
          <TrackerIcon className={section.icon} aria-hidden="true" />
          <span>{section.label}</span>
        </button>
      ))}
    </nav>
  );
  return (
    <TimerContext.Provider value={{ style, change: setStyle }}>
      <div
        data-theme={theme}
        data-tone={dataTone}
        className={`readdy-tracker-ui app-shell tracker-frame ${theme === "dark" ? "app-dark dark" : ""} ${native ? "tracker-native k-app k-readdy" : ""}`}
      >
        <aside className="app-sidebar tracker-sidebar">
          <div className="tracker-brand">
            <img src={logo} alt="Khaliduo" />
            <div>
              <strong>khaliduo</strong>
              <small>TRACKER SUITE</small>
            </div>
          </div>
          <p className="tracker-label">WORKSPACE</p>
          {nav}
          <div className="tracker-shift-note">
            <span className="tracker-label">● {stateLabel}</span>
            <p>Paid shift {shiftLabel}. Tracked time syncs with your workspace.</p>
          </div>
          <div className="tracker-sidebar-bottom">
            <TimerStylePicker value={style} onChange={setStyle} variant="sidebar" />
            <button type="button" className="tracker-dashboard-link" onClick={onDashboard}>
              ← Web dashboard
            </button>
            <div className="tracker-account">
              <span className="tracker-avatar">
                {avatar ? <img src={avatar} alt="" /> : name.slice(0, 1)}
              </span>
              <div>
                <strong>{name}</strong>
                <small>{email}</small>
              </div>
            </div>
            {version && (
              <small className="tracker-label">
                v{version} · {synced ? "SESSION SYNCED" : "SYNC PENDING"}
              </small>
            )}
          </div>
        </aside>
        <div className="tracker-main">
          <header className="app-topbar tracker-topbar">
            <div className="tracker-breadcrumb">
              KHALIDUO <span>•</span> {title.toUpperCase()}
            </div>
            <span className="app-pill">
              <span className={running ? "tracker-live-dot" : "tracker-paused-dot"} />
              <span>{stateLabel}</span>
              <strong className="app-num">{clock(seconds)}</strong>
            </span>
            <div className="tracker-top-actions">
              <button
                type="button"
                className="app-nav-btn tracker-mobile-dashboard"
                onClick={onDashboard}
                aria-label="Web dashboard"
              >
                ↗
              </button>
              <button
                type="button"
                className="app-nav-btn"
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                onClick={onThemeChange}
              >
                <TrackerIcon
                  className={theme === "dark" ? "ri-sun-line" : "ri-moon-line"}
                  aria-hidden="true"
                />
              </button>
              <span className="app-pill tracker-shots-label">{shotsLabel}</span>
              <button type="button" className="app-pill" onClick={onSync}>
                <span className={synced ? "tracker-live-dot" : "tracker-paused-dot"} />
                {synced ? "Synced" : "Retry sync"}
              </button>
              {headerControls}
            </div>
          </header>
          <div className="tracker-mobile-nav">{nav}</div>
          <div className="tracker-content">{children}</div>
          <footer className="app-statusbar tracker-statusbar">
            <span>
              <i className={running ? "tracker-live-dot" : "tracker-paused-dot"} />
              {stateLabel}
            </span>
            <span>
              {synced ? "SYNCED" : native ? "TIME SAVED · SYNC PENDING" : "REFRESH PENDING"}
            </span>
            <span className="tracker-status-time">WORKED TODAY {clock(seconds)}</span>
            {version && <span>v{version}</span>}
          </footer>
        </div>
      </div>
    </TimerContext.Provider>
  );
}

export function TrackerStage({
  name,
  avatar,
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
  controlBusy?: boolean;
  onExplainIdle: () => void;
  screenshot: ReactNode;
  screenshotTime: string | null;
  onOpenShots: () => void;
  timeline: TrackerTimelineRow[];
  children?: ReactNode;
}) {
  const preference = useContext(TimerContext);
  const activeTask = tasks.find((task) => task.id === taskId);
  const counted = Math.max(0, seconds);
  const target = Math.max(1, targetSeconds);
  const progress = Math.min(100, Math.round((counted / target) * 100));
  const slices = [
    {
      label: "Normal shift work",
      seconds: Math.max(0, counted - overtimeSeconds - approvedSeconds),
      color: "var(--k-green)",
    },
    { label: "Extra recorded", seconds: overtimeSeconds, color: "var(--k-pink)" },
    { label: "Idle", seconds: idleSeconds, color: "var(--k-amber)" },
    { label: "Manual approved", seconds: approvedSeconds, color: "var(--k-plum-2)" },
    { label: "Manual pending", seconds: pendingSeconds, color: "var(--k-rose)" },
    { label: "Manual rejected", seconds: rejectedSeconds, color: "var(--k-dot)" },
  ];
  const activity =
    activityPct === null ? "—" : `${Math.min(100, Math.max(0, Math.round(activityPct)))}%`;
  return (
    <>
      <div className="tracker-heading">
        <h1>
          Welcome back <span>{name.split(/\s+/)[0]}</span>
        </h1>
        <p>Your work, tasks and captured time, together in one workspace.</p>
      </div>
      <div className="k-frame tracker-stage">
        <div className="tracker-selectors">
          <div>
            <label htmlFor="live-project" className="k-field-label">
              Project
            </label>
            <SelectMenu
              id="live-project"
              ariaLabel="Project"
              variant="app"
              value={projectId}
              options={[
                { value: "", label: "All projects" },
                ...projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
              onChange={onProjectChange}
              disabled={selectionDisabled}
            />
          </div>
          <div>
            <label htmlFor="live-task" className="k-field-label">
              Task
            </label>
            <SelectMenu
              id="live-task"
              ariaLabel="Task"
              variant="app"
              value={taskId}
              options={[
                { value: "", label: "Choose a task" },
                ...tasks
                  .filter(
                    (task) => !projectId || task.projectId === projectId || task.id === taskId,
                  )
                  .map((task) => ({ value: task.id, label: task.name })),
              ]}
              onChange={onTaskChange}
              disabled={selectionDisabled}
            />
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onNoteSubmit?.();
            }}
          >
            <label htmlFor="live-note" className="k-field-label">
              Note
            </label>
            <input
              id="live-note"
              className="k-app-field"
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Add a note (optional)…"
              maxLength={1000}
            />
          </form>
        </div>
        <div className="tracker-stage-grid">
          <section className="app-card tracker-clock-card">
            <div className="tracker-style-picker">
              <TimerStylePicker value={preference.style} onChange={preference.change} />
            </div>
            <span className="tracker-avatar tracker-main-avatar">
              {avatar ? <img src={avatar} alt="" /> : name.slice(0, 1)}
            </span>
            <p className="tracker-label">
              PAID SHIFT <strong>{shiftLabel}</strong>
            </p>
            <span className={`tracker-state ${running ? "is-running" : "is-paused"}`}>
              {stateLabel}
            </span>
            <div className="tracker-timer-face">
              <TimerDisplay
                style={preference.style}
                seconds={counted}
                targetSeconds={target}
                running={running}
              />
            </div>
            <p className="tracker-task-caption" dir="auto">
              {projects.find((project) => project.id === projectId)?.name ?? "All projects"} ·{" "}
              {activeTask?.name ?? "No task selected"}
            </p>
            {onToggle ? (
              <button
                type="button"
                className="tracker-cta"
                disabled={controlBusy}
                onClick={onToggle}
              >
                {controlBusy ? "Updating…" : running ? "Ⅱ Pause" : "▶ Resume"}
              </button>
            ) : (
              <p className="tracker-control-help">
                Pause or resume tracking from your desktop app.
              </p>
            )}
            <div className="k-glass-card k-glass-card-bleed tracker-glass-stats">
              {[
                { label: "Activity", value: activity, hint: "Active" },
                { label: "Current session", value: clock(sessionSeconds), hint: "Tracked session" },
                { label: "Total time", value: clock(counted), hint: "Counted today" },
                {
                  label: "Overtime",
                  value: clock(overtimeSeconds),
                  hint: overtimeSeconds ? "Recorded for review" : "No overtime",
                },
                {
                  label: "Idle",
                  value: clock(idleSeconds),
                  hint: idleSeconds ? "Explain idle" : "No idle time",
                },
              ].map((item) => (
                <div className="k-glass-cell" key={item.label}>
                  <strong className="app-num">{item.value}</strong>
                  <span>{item.label}</span>
                  {item.label === "Idle" && idleSeconds > 0 ? (
                    <button type="button" onClick={onExplainIdle}>
                      {item.hint}
                    </button>
                  ) : (
                    <small>{item.hint}</small>
                  )}
                </div>
              ))}
            </div>
          </section>
          <aside className="tracker-right-rail">
            <section className="app-card tracker-rail-card">
              <header>
                <h2>Latest screenshot</h2>
                <button type="button" onClick={onOpenShots}>
                  View all
                </button>
              </header>
              <div className="tracker-screenshot">{screenshot ?? <p>No captures available</p>}</div>
              <p className="tracker-label tracker-shot-time">
                {screenshotTime ?? "No screenshot recorded"}
              </p>
            </section>
            <section className="app-card tracker-rail-card tracker-timeline">
              <header>
                <h2>Today’s timeline</h2>
                <span className="tracker-label">{Math.floor(counted / 3600)}H LOGGED</span>
              </header>
              <ul>
                {timeline.length ? (
                  timeline.map((row) => (
                    <li key={row.id}>
                      <i
                        className={
                          row.kind === "worked" ? "tracker-live-dot" : "tracker-paused-dot"
                        }
                      />
                      <div>
                        <strong>{row.label}</strong>
                        <small>{row.time}</small>
                      </div>
                      <span className="app-num">{clock(row.seconds)}</span>
                    </li>
                  ))
                ) : (
                  <li>No work sessions recorded yet.</li>
                )}
              </ul>
            </section>
          </aside>
        </div>
      </div>
      <div className="tracker-session-strip app-card">
        <div>
          <small>STARTED AT</small>
          <strong>{startedAt ?? "Not started"}</strong>
        </div>
        <div>
          <small>LAST ACTIVITY</small>
          <strong>{lastActivityAt ?? "Not recorded"}</strong>
        </div>
        <div>
          <small>SESSION</small>
          <strong>{running ? "Still running · no sign-out yet" : stateLabel}</strong>
        </div>
      </div>
      <div className="tracker-summary-cards">
        {[
          { label: "Today", value: clock(counted) },
          { label: "This week", value: clock(weekSeconds) },
          { label: "Session", value: clock(sessionSeconds) },
          { label: "Activity", value: activity },
          { label: "Idle", value: clock(idleSeconds) },
        ].map((item) => (
          <div key={item.label} className="app-card">
            <small>{item.label}</small>
            <strong className="app-num">{item.value}</strong>
          </div>
        ))}
      </div>
      <section className="app-card tracker-breakdown">
        <header>
          <h2>Daily target</h2>
          <span>
            {clock(counted)} / {clock(targetSeconds)} · {progress}%
          </span>
        </header>
        <div className="tracker-target-track">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="tracker-breakdown-legend">
          {slices.map((slice) => (
            <span key={slice.label}>
              <i style={{ background: slice.color }} />
              {slice.label} <strong className="app-num">{clock(slice.seconds)}</strong>
            </span>
          ))}
        </div>
      </section>
      {children}
    </>
  );
}
