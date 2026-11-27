import type { TrackingHealth } from "../../../electron/services/trackingHealth";
import "./tracking-health.css";

function clockLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
}

export function TrackingHealthPanel({ health, syncing, error, onSync }: {
  health: TrackingHealth;
  syncing: boolean;
  error: string | null;
  onSync: () => void;
}) {
  const pending = [
    health.pendingEvents ? `${health.pendingEvents} activity update${health.pendingEvents === 1 ? "" : "s"}` : null,
    health.pendingScreenshots ? `${health.pendingScreenshots} screenshot${health.pendingScreenshots === 1 ? "" : "s"}` : null,
    health.pendingSessions ? `${health.pendingSessions} work session${health.pendingSessions === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");
  const savedAt = health.localCheckpointAt && clockLabel(health.localCheckpointAt);
  const contactedAt = health.lastServerContactAt && clockLabel(health.lastServerContactAt);

  return (
    <section className="app-tracking-health" aria-label="Recording and sync status">
      <div className="app-health-item" data-health-tone={health.tracking.tone}>
        <span className="app-health-icon" aria-hidden="true">
          <i className={health.tracking.state === "recording" ? "ri-record-circle-line" : health.tracking.state === "interrupted" ? "ri-error-warning-line" : "ri-pause-circle-line"} />
        </span>
        <div className="app-health-copy" role="status">
          <strong>{health.tracking.label}</strong>
          <p>{health.tracking.detail}</p>
        </div>
      </div>
      <div className="app-health-item" data-health-tone={health.sync.tone}>
        <span className="app-health-icon" aria-hidden="true">
          <i className={health.sync.state === "synced" ? "ri-cloud-line" : health.sync.state === "unavailable" ? "ri-error-warning-line" : "ri-cloud-off-line"} />
        </span>
        <div className="app-health-copy">
          <div role="status">
            <strong>{health.sync.label}</strong>
            <p>{health.sync.detail}</p>
          </div>
          {pending ? <small>{pending} waiting to upload</small> : null}
          {savedAt || contactedAt ? (
            <small className="app-health-timestamps">
              {savedAt ? <span title={health.localCheckpointAt!}>Local save {savedAt}</span> : null}
              {contactedAt ? <span title={health.lastServerContactAt!}>Server contact {contactedAt}</span> : null}
            </small>
          ) : null}
        </div>
      </div>
      <button className="app-health-sync" type="button" onClick={onSync} disabled={syncing}>
        <i className={syncing ? "ri-loader-4-line app-health-spin" : "ri-refresh-line"} aria-hidden="true" />
        {syncing ? "Syncing…" : "Sync now"}
      </button>
      {error ? <p className="app-health-error" role="alert">{error}</p> : null}
    </section>
  );
}
