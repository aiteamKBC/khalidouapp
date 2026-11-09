import type { CSSProperties, ReactNode } from "react";
import { SwipeTimer } from "./SwipeTimer";
import { TimerStylePicker } from "./TimerStylePicker";
import type { TimerStyle } from "./timerStyle";

/*
 * Tracker screen cards in the Readdy style. Display only: every value and
 * label arrives already computed by App.tsx (HomeView / Timeline), and every
 * button calls the handler it is given.
 */

/** Which face the hero card shows; picked in HomeView from App's flags. */
export type HeroMode = "running" | "idle" | "break" | "paused" | "overtime" | "stopped";

export function Card({
  title,
  icon,
  action,
  children,
  className = "",
  ariaLabel,
}: {
  title?: string;
  icon?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <section className={`tp-card flex min-w-0 flex-col ${className}`} aria-label={ariaLabel}>
      {title ? (
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
          <div className="flex min-w-0 items-center gap-2">
            {icon ? (
              <span className="tp-card-icon">
                <i className={`${icon} text-[14px]`} aria-hidden="true" />
              </span>
            ) : null}
            <h2 className="truncate text-[14px] font-semibold text-ink">{title}</h2>
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* ---------- quick bar: project, task, note ---------- */
export function QuickBar({
  projects,
  projectId,
  onProjectChange,
  tasks,
  taskId,
  taskDisabled,
  onTaskChange,
  note,
  onNoteChange,
}: {
  projects: Array<{ id: string; name: string }>;
  projectId: string;
  onProjectChange: (projectId: string) => void;
  tasks: Array<{ id: string; name: string }>;
  taskId: string;
  taskDisabled: boolean;
  onTaskChange: (taskId: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
}) {
  return (
    <section className="flex min-w-0 items-center gap-2.5">
      <label className="tp-pill w-[230px] flex-none">
        <span className="h-2 w-2 flex-none rounded-full bg-plum-2" aria-hidden="true" />
        <span className="tp-pill-key">Project</span>
        <select
          className="tp-select"
          aria-label="Project"
          value={projectId}
          onChange={(event) => onProjectChange(event.target.value)}
        >
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label className="tp-pill w-[230px] flex-none">
        <i className="ri-focus-3-line text-[13px] text-plum-2" aria-hidden="true" />
        <span className="tp-pill-key">Task</span>
        <select
          className="tp-select"
          aria-label="Task"
          value={taskId}
          disabled={taskDisabled}
          onChange={(event) => onTaskChange(event.target.value)}
        >
          <option value="none">Choose a task</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.name}
            </option>
          ))}
        </select>
      </label>
      <label className="tp-pill min-w-0 flex-1">
        <i className="ri-quill-pen-line flex-none text-[13px] text-faint" aria-hidden="true" />
        <input
          className="tp-note-input"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="Add a note for this session (optional)..."
          aria-label="Session note"
        />
      </label>
    </section>
  );
}

/* ---------- hero timer card ---------- */
export type BreakChip = {
  key: string;
  label: string;
  range: string;
  title?: string;
  state: "now" | "next" | null;
};

export function HeroCard({
  mode,
  statusText,
  shiftLabel,
  breaks,
  savedBreak,
  overtimeLabel,
  overtimeHelp,
  eyebrow,
  clock,
  targetProgress,
  goalLabel,
  remainingLabel,
  live,
  timerAriaLabel,
  projectTaskLabel,
  toggleLabel,
  toggleResumes,
  toggleDisabled,
  onToggle,
  explainLabel,
  explainDisabled,
  onExplain,
  timerStyle,
  onTimerStyle,
}: {
  mode: HeroMode;
  statusText: string;
  shiftLabel: string;
  breaks: BreakChip[];
  savedBreak: { remaining: string; title: string } | null;
  overtimeLabel: string | null;
  overtimeHelp: string | null;
  eyebrow: string;
  clock: string;
  /** Worked share of the daily target in percent (App's targetProgress). */
  targetProgress: number;
  goalLabel: string;
  /** "03:15:00 logged · 04:45:00 remaining", from App's counted time. */
  remainingLabel: string;
  live: boolean;
  timerAriaLabel: string;
  projectTaskLabel: string;
  toggleLabel: string;
  toggleResumes: boolean;
  toggleDisabled: boolean;
  onToggle: () => void;
  explainLabel: string;
  explainDisabled: boolean;
  onExplain: () => void;
  timerStyle: TimerStyle;
  onTimerStyle: (style: TimerStyle) => void;
}) {
  return (
    <section
      className="tp-card tp-hero flex min-w-0 flex-col items-center gap-2.5 px-5 pb-5 pt-4 text-center"
      data-mode={mode}
      style={{ "--tp-deg": `${targetProgress * 3.6}deg` } as CSSProperties}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="tp-shift" title="Today's paid shift">
          <i className="ri-briefcase-4-line text-[12px]" aria-hidden="true" />
          {shiftLabel}
        </span>
        <span className="tp-tag" role="status">
          <span className="tp-tag-dot" aria-hidden="true" />
          {statusText}
        </span>
        <TimerStylePicker value={timerStyle} onChange={onTimerStyle} />
      </div>

      {breaks.length > 0 || savedBreak ? (
        <ul className="tp-breaks" aria-label="Today's breaks">
          {breaks.map((item) => (
            <li key={item.key} data-state={item.state ?? undefined} title={item.title}>
              <span>{item.label}</span>
              <strong className="app-num">{item.range}</strong>
              {item.state === "now" ? <em>Now</em> : null}
              {item.state === "next" ? <em>Next</em> : null}
            </li>
          ))}
          {savedBreak ? (
            <li data-state="saved" title={savedBreak.title}>
              <span>Saved break</span>
              <strong className="app-num">{savedBreak.remaining}</strong>
            </li>
          ) : null}
        </ul>
      ) : null}

      {overtimeLabel ? <span className="tp-overtime">{overtimeLabel}</span> : null}

      <p className="tp-eyebrow m-0">{eyebrow}</p>

      <div className="tp-hero-timer w-full max-w-[430px]" aria-label={timerAriaLabel}>
        <SwipeTimer
          style={timerStyle}
          onChange={onTimerStyle}
          clock={clock}
          progress={Math.max(0, Math.min(1, targetProgress / 100))}
          live={live}
        />
      </div>

      <div className="flex flex-col items-center gap-1">
        <div className="flex flex-wrap items-baseline justify-center gap-x-2">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">Daily goal</span>
          <span className="app-num text-[12px] font-bold leading-none text-ink">{targetProgress}%</span>
          <span className="app-num text-[10px] text-faint" title={goalLabel}>
            {goalLabel}
          </span>
        </div>
        <span className="app-num text-[10.5px] text-muted">{remainingLabel}</span>
      </div>

      {overtimeHelp ? <p className="m-0 max-w-[420px] text-[10.5px] text-muted">{overtimeHelp}</p> : null}

      <p className="m-0 max-w-full truncate text-[11px] font-medium text-ink-2" title={projectTaskLabel}>
        {projectTaskLabel}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={onToggle}
          disabled={toggleDisabled}
          className="tp-cta"
          data-resume={toggleResumes ? "true" : undefined}
        >
          <i className={`text-[14px] ${toggleResumes ? "ri-play-fill" : "ri-pause-fill"}`} aria-hidden="true" />
          {toggleLabel}
        </button>
        <button type="button" onClick={onExplain} disabled={explainDisabled} className="tp-action">
          <i className="ri-question-answer-line text-[14px]" aria-hidden="true" />
          {explainLabel}
        </button>
      </div>
    </section>
  );
}

/* ---------- stat tiles ---------- */
export type Tile = {
  key: string;
  icon: string;
  label: string;
  value: string;
  note?: string;
  tone?: "ok" | "warn" | "accent";
  bar?: number;
};

export function StatTiles({ tiles, row = false }: { tiles: Tile[]; row?: boolean }) {
  return (
    <div className={`tp-tiles${row ? " is-row" : ""}`}>
      {tiles.map((tile) => (
        <div key={tile.key} className="tp-stat" data-tone={tile.tone}>
          <div className="flex items-start justify-between gap-2">
            <span className="tp-stat-label truncate">{tile.label}</span>
            <i className={`${tile.icon} tp-stat-icon text-[14px]`} aria-hidden="true" />
          </div>
          <span className="tp-stat-value">{tile.value}</span>
          {typeof tile.bar === "number" ? (
            <span className="tp-target-track">
              <span style={{ width: `${Math.max(2, Math.min(100, tile.bar))}%` }} />
            </span>
          ) : null}
          {tile.note ? (
            <p className="tp-stat-note m-0 truncate" title={tile.note}>
              {tile.note}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ---------- workday strip ---------- */
export function WorkdayStrip({ cells }: { cells: Array<{ label: string; value: string }> }) {
  return (
    <section className="tp-card tp-workday" aria-label="Today's workday timing">
      {cells.map((cell) => (
        <div key={cell.label}>
          <span>{cell.label}</span>
          <strong>{cell.value}</strong>
        </div>
      ))}
    </section>
  );
}

/* ---------- daily target breakdown ---------- */
export function BreakdownCard({
  summary,
  segments,
}: {
  summary: string;
  segments: Array<{ key: string; label: string; value: string; className: string; widthPercent: number }>;
}) {
  return (
    <Card title="Daily target" icon="ri-flag-2-line" action={<span className="app-num text-[11px] font-semibold text-muted">{summary}</span>}>
      <div className="px-4 pb-4">
        <div className="tp-breakdown-bar">
          {segments.map((segment) =>
            segment.widthPercent > 0 ? (
              <i
                key={segment.key}
                className={`segment-${segment.className}`}
                style={{ width: `${segment.widthPercent}%` }}
                title={`${segment.label}: ${segment.value}`}
              />
            ) : null,
          )}
        </div>
        <div className="tp-legend">
          {segments.map((segment) => (
            <span key={segment.key}>
              <i className={`segment-${segment.className}`} /> {segment.label}{" "}
              <b className="app-num">{segment.value}</b>
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ---------- timeline ---------- */
export type TimelineRow = {
  key: string;
  /** timelineDisplayType from timelinePresentation.ts */
  displayType: string;
  label: string;
  detail: string | null;
  range: string;
  duration: string;
  isCurrent: boolean;
};

export type NeedsRow = {
  key: string;
  range: string;
  detail: string;
  action: string;
  onClick: () => void;
};

/* his badge per row; break work is never called overtime */
const TIMELINE_BADGES: Record<string, string> = {
  worked: "Shift",
  extra: "Overtime",
  break_work: "Break work",
  break: "Rest",
  saved_break: "Saved",
  idle: "Idle",
  locked: "Locked",
  sleeping: "Sleep",
  untracked: "Gap",
  manual: "Manual",
  leave: "Leave",
};

export function TimelineCard({
  rows,
  needs,
  needsSummary,
  loggedLabel,
  footer,
}: {
  rows: TimelineRow[];
  needs: NeedsRow[];
  needsSummary: string;
  loggedLabel: string;
  footer: { label: string; ok: boolean };
}) {
  return (
    <Card
      title="Today's timeline"
      icon="ri-file-list-3-line"
      className="tp-timeline-card"
      action={<span className="tp-logged">{loggedLabel}</span>}
    >
      {needs.length ? (
        <section className="tp-needs" aria-label="Idle periods needing explanation">
          <header>
            <strong>Needs explanation</strong>
            <span>{needsSummary}</span>
          </header>
          {needs.map((row) => (
            <button key={row.key} type="button" className="tp-needs-item" onClick={row.onClick}>
              <span className="app-num">{row.range}</span>
              <small>{row.detail}</small>
              <b>{row.action}</b>
            </button>
          ))}
        </section>
      ) : null}
      <ul className="tp-timeline">
        {rows.map((row, index) => (
          <li key={row.key} className="tp-tl-row" data-type={row.displayType}>
            <span className="relative flex w-3 flex-none justify-center pt-[5px]">
              {index < rows.length - 1 ? <span className="tp-tl-line" aria-hidden="true" /> : null}
              <span className={`tp-tl-dot${row.isCurrent ? " is-live" : ""}`} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="tp-tl-label text-[12px] font-semibold">{row.label}</span>
                <span className="app-num text-[10.5px] text-muted">{row.range}</span>
              </div>
              {row.detail ? (
                <p className="m-0 mt-0.5 truncate text-[10.5px] text-muted" title={row.detail}>
                  {row.detail}
                </p>
              ) : null}
            </div>
            <span className="flex flex-none flex-col items-end gap-1">
              <span className={`tp-tl-chip${row.isCurrent ? " is-live" : ""}`} data-type={row.displayType}>
                {row.isCurrent ? "Ongoing" : (TIMELINE_BADGES[row.displayType] ?? row.label)}
              </span>
              <span className="app-num text-[11px] font-semibold text-ink-2">{row.duration}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="tp-card-foot">
        <span className="truncate">{footer.label}</span>
        <i
          className={`tp-foot-badge ${footer.ok ? "ri-shield-check-line is-ok" : "ri-cloud-off-line"}`}
          aria-hidden="true"
        />
      </div>
    </Card>
  );
}

/* ---------- latest screenshot ---------- */
export function ShotCard({
  shot,
  showLoadButton,
  loading,
  onLoad,
  onViewAll,
  viewAllDisabled,
  empty,
  errors,
  footer,
}: {
  shot: { src: string; alt: string; time: string; syncLabel: string; synced: boolean } | null;
  footer: { interval: string | null; captureLabel: string; captureOk: boolean } | null;
  showLoadButton: boolean;
  loading: boolean;
  onLoad: () => void;
  onViewAll: () => void;
  viewAllDisabled: boolean;
  empty: boolean;
  errors: string[];
}) {
  return (
    <Card
      title="Latest screenshot"
      icon="ri-computer-line"
      action={
        <button
          type="button"
          onClick={onViewAll}
          disabled={viewAllDisabled}
          className="app-plain-btn flex flex-none items-center gap-1 whitespace-nowrap text-[10.5px] font-semibold text-plum-2 hover:underline"
        >
          View all
          <i className="ri-arrow-right-line text-[12px]" aria-hidden="true" />
        </button>
      }
    >
      <div className="flex flex-col gap-2 px-3 pb-3">
        {showLoadButton ? (
          <button type="button" className="tp-shot-placeholder" onClick={onLoad} disabled={loading}>
            <i className="ri-image-line text-[18px]" aria-hidden="true" />
            {loading ? "Loading..." : "Show latest capture"}
          </button>
        ) : null}
        {shot ? (
          <figure className="tp-shot">
            <button
              type="button"
              className="tp-shot-open"
              onClick={onViewAll}
              disabled={viewAllDisabled}
              title="Open your screenshots in the web dashboard"
            >
              <img src={shot.src} alt={shot.alt} />
            </button>
            <figcaption>
              <span className="app-num">
                <i className="ri-time-line text-[10px]" aria-hidden="true" /> {shot.time}
              </span>
              <b className={shot.synced ? "is-synced" : ""}>{shot.syncLabel}</b>
            </figcaption>
          </figure>
        ) : null}
        {empty ? <p className="m-0 py-6 text-center text-[11px] text-muted">No screenshots have been uploaded yet.</p> : null}
        {errors.map((error) => (
          <p key={error} className="k-error m-0 text-[11px]">
            {error}
          </p>
        ))}
      </div>
      {footer ? (
        <div className="tp-card-foot">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <i className="ri-timer-2-line text-[11px]" aria-hidden="true" />
            <span className="truncate">
              {footer.interval ? `Automated snapshot frequency · ${footer.interval}` : "Automated snapshots"}
            </span>
          </span>
          <span className={`flex flex-none items-center gap-1.5 font-semibold ${footer.captureOk ? "text-ok" : "text-warn"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${footer.captureOk ? "bg-ok" : "bg-warn"}`} aria-hidden="true" />
            {footer.captureLabel}
          </span>
        </div>
      ) : null}
    </Card>
  );
}

/* ---------- recent tasks ---------- */
export function RecentTasksCard({
  tasks,
  onPick,
}: {
  tasks: Array<{ id: string; name: string; project: string; tracked: string }>;
  onPick: (taskId: string) => void;
}) {
  return (
    <Card title="Recent tasks" icon="ri-history-line">
      <div className="flex flex-col px-2 pb-2">
        {tasks.map((task) => (
          <button key={task.id} type="button" className="tp-recent" onClick={() => onPick(task.id)}>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[12px] font-semibold text-ink">{task.name}</span>
              <span className="block truncate text-[10.5px] text-muted">{task.project}</span>
            </span>
            <span className="app-num flex-none text-[11px] font-semibold text-ink-2">{task.tracked}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
