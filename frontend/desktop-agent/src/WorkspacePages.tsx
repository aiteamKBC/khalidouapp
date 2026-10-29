import type { ReactNode } from "react";
import type { AgentStatus, RecentScreenshot } from "./types/electron";
import { TrackerIcon } from "./tracker-ui/TrackerIcon";

export function WorkspacePageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description: string;
  icon: string;
  actions?: ReactNode;
}) {
  return (
    <header className="wp-page-header">
      <div className="wp-page-heading">
        <span className="wp-page-icon">
          <TrackerIcon className={icon} aria-hidden="true" />
        </span>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      {actions && <div className="wp-page-actions">{actions}</div>}
    </header>
  );
}

export function ScreenshotsPage({
  screenshots,
  loading,
  error,
  enabled,
  openingDashboard,
  onRefresh,
  onOpenDashboard,
  formatTimestamp,
}: {
  screenshots: RecentScreenshot[] | null;
  loading: boolean;
  error: string | null;
  enabled: boolean;
  openingDashboard: boolean;
  onRefresh: () => void;
  onOpenDashboard: () => void;
  formatTimestamp: (value: string | null) => string;
}) {
  const hasCaptures = Boolean(screenshots?.length);
  return (
    <section className="k-page workspace-page wp-screenshots">
      <WorkspacePageHeader
        title="Screenshots"
        description="Your recent workplace captures, all in one place."
        icon="ri-image-line"
        actions={
          <button
            type="button"
            className="wp-primary"
            onClick={onRefresh}
            disabled={loading}
          >
            <TrackerIcon
              className={`ri-refresh-line${loading ? " wp-spinning" : ""}`}
              aria-hidden="true"
            />
            {loading ? "Loading…" : "Refresh screenshots"}
          </button>
        }
      />
      {error && (
        <p role="alert" className="wp-alert">
          {error}
        </p>
      )}
      <section
        className="wp-card wp-capture-library"
        aria-label="Recent captures"
        aria-busy={loading}
      >
        <header className="wp-card-heading">
          <div>
            <h2>Recent captures</h2>
            <p>Screenshots saved from this device.</p>
          </div>
          <span className={`wp-badge${enabled ? " is-success" : ""}`}>
            {enabled ? "Captures enabled" : "Capture disabled"}
          </span>
        </header>
        {hasCaptures ? (
          <div className="wp-capture-grid">
            {screenshots!.map((shot) => (
              <figure className="wp-capture" key={shot.id}>
                <img
                  src={shot.dataUrl}
                  alt={shot.displayName ?? "Workplace screenshot"}
                  loading="lazy"
                  decoding="async"
                />
                <figcaption>
                  <span className="wp-capture-device">
                    <TrackerIcon className="ri-image-line" aria-hidden="true" />
                    {shot.displayName ?? "This device"}
                  </span>
                  <time dateTime={shot.capturedAt}>
                    {formatTimestamp(shot.capturedAt)}
                  </time>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="wp-empty" role="status">
            <span className="wp-empty-icon">
              <TrackerIcon
                className={
                  loading ? "ri-refresh-line wp-spinning" : "ri-image-line"
                }
                aria-hidden="true"
              />
            </span>
            <h3>
              {loading
                ? "Loading your captures…"
                : enabled
                  ? "No screenshots yet"
                  : "Screenshot capture is disabled"}
            </h3>
            <p>
              {loading
                ? "Your recent screenshots will appear here."
                : enabled
                  ? "New captures will appear here after they sync. Screenshots follow your company’s schedule."
                  : "Your company has disabled screenshot capture for this account."}
            </p>
          </div>
        )}
        <footer className="wp-card-footer">
          <p>
            <TrackerIcon className="ri-image-line" aria-hidden="true" />
            {hasCaptures
              ? `${screenshots!.length} recent capture${screenshots!.length === 1 ? "" : "s"}`
              : "Workplace captures"}
          </p>
          <button
            type="button"
            onClick={onOpenDashboard}
            disabled={openingDashboard}
          >
            {openingDashboard
              ? "Opening…"
              : "Manage screenshots in web dashboard"}
            <TrackerIcon
              className="ri-arrow-right-up-line"
              aria-hidden="true"
            />
          </button>
        </footer>
      </section>
    </section>
  );
}

function duration(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function NativeShiftPage({
  status,
  scheduledShift,
  formatClock,
  formatDuration,
  children,
}: {
  status: AgentStatus;
  scheduledShift: string;
  formatClock: (value: string | null, timezone: string) => string;
  formatDuration: (seconds: number) => string;
  children: ReactNode;
}) {
  const timeline = status.todayTimeline;
  const state = status.breakStartedAt
    ? "break"
    : status.trackingPaused
      ? "paused"
      : status.trackingStatus;
  const stateLabel = {
    starting: "Connecting",
    active: "Tracking active",
    idle: "Idle",
    locked: "Locked",
    sleeping: "Sleeping",
    paused: "Paused",
    offline: "Offline",
    error: "Connection issue",
    break: "On break",
  }[state];
  const metrics = [
    {
      label: "Scheduled shift",
      value: scheduledShift,
      icon: "ri-calendar-line",
      kind: "schedule",
    },
    {
      label: "Worked today",
      value: formatDuration(
        timeline?.worked_seconds ?? status.workedTodaySeconds,
      ),
      icon: "ri-timer-line",
      kind: "worked",
    },
    {
      label: "Idle time",
      value: formatDuration(timeline?.idle_seconds ?? status.idleSeconds),
      icon: "ri-hourglass-line",
      kind: "idle",
    },
    {
      label: "First activity",
      value: formatClock(
        timeline?.first_started_at ?? null,
        timeline?.timezone ?? status.requestPolicy?.timezone ?? "UTC",
      ),
      icon: "ri-login-box-line",
      kind: "opened",
    },
  ];
  return (
    <section className="k-page workspace-page wp-shift">
      <WorkspacePageHeader
        title="Shift"
        description="Your schedule and activity for today."
        icon="ri-calendar-check-line"
        actions={
          <span className={`wp-badge wp-shift-status is-${state}`}>
            <i aria-hidden="true" />
            {stateLabel}
          </span>
        }
      />
      <dl className="wp-shift-summary" aria-label="Shift summary">
        {metrics.map((metric) => (
          <div
            className={`wp-card wp-shift-metric is-${metric.kind}`}
            key={metric.kind}
          >
            <dt>
              {metric.label}
              <TrackerIcon className={metric.icon} aria-hidden="true" />
            </dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}

export function NativeInsights({ status }: { status: AgentStatus }) {
  return (
    <section className="k-page workspace-page wp-insights">
      <WorkspacePageHeader
        title="Insights"
        description="A clear view of your work time and activity."
        icon="ri-bar-chart-line"
      />
      {status.timeSummary ? (
        <>
          <div className="wp-insight-grid">
            {(["today", "week", "month"] as const).map((key) => {
              const period = status.timeSummary![key];
              const label =
                key === "today"
                  ? "Today"
                  : key === "week"
                    ? "This week"
                    : "This month";
              return (
                <article
                  className="wp-card wp-insight-card"
                  key={key}
                  aria-label={`${label} work summary`}
                >
                  <header className="wp-insight-heading">
                    <h2>{label}</h2>
                    <span className="wp-metric-icon">
                      <TrackerIcon
                        className={
                          key === "today" ? "ri-timer-line" : "ri-calendar-line"
                        }
                        aria-hidden="true"
                      />
                    </span>
                  </header>
                  <strong className="wp-insight-total">
                    {duration(period.active_seconds)}
                  </strong>
                  <p className="wp-total-caption">Total work time</p>
                  <dl className="wp-insight-breakdown">
                    {[
                      {
                        label: "Tracked",
                        value: period.tracked_active_seconds,
                        kind: "tracked",
                      },
                      {
                        label: "Manual approved",
                        value: period.manual_approved_seconds,
                        kind: "approved",
                      },
                      {
                        label: "Pending approval",
                        value: period.manual_pending_seconds,
                        kind: "pending",
                      },
                      {
                        label: "Idle",
                        value: period.idle_seconds,
                        kind: "idle",
                      },
                    ].map((item) => (
                      <div key={item.kind} className={`wp-time-${item.kind}`}>
                        <dt>
                          <i />
                          {item.label}
                        </dt>
                        <dd>{duration(item.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
          <p className="wp-summary-note">
            <TrackerIcon className="ri-check-line" aria-hidden="true" />
            Approved manual time is included in your total. Pending requests are
            shown separately.
          </p>
        </>
      ) : (
        <div className="wp-card wp-empty">
          <span className="wp-empty-icon">
            <TrackerIcon className="ri-bar-chart-line" aria-hidden="true" />
          </span>
          <h2>No activity summary yet</h2>
          <p>Your work totals will appear after your next successful sync.</p>
        </div>
      )}
    </section>
  );
}
