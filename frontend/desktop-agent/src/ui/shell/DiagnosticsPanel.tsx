import { useCallback, useEffect, useRef, useState } from "react";

import type { DiagnosticsSnapshot } from "../../types/electron";

// A hidden support panel. It is dormant unless a passcode was configured at
// build time (diagnosticsConfig().enabled). Typing the trigger word while the
// app is focused brings up a passcode prompt; the passcode is verified in the
// Electron main process, and a correct unlock is written to the company audit
// log against this device. Every action here is read-only or a benign resync.

type Phase = "idle" | "passcode" | "open";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return "never";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function DiagnosticsPanel() {
  const [trigger, setTrigger] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const bufferRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    void window.khaliduo?.diagnosticsConfig().then((config) => {
      if (!cancelled && config.enabled && config.trigger) {
        setTrigger(config.trigger.toLowerCase());
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Watch for the trigger word. We only read keystrokes; we never preventDefault,
  // so normal typing is unaffected. The buffer is capped at the trigger length.
  useEffect(() => {
    if (!trigger) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.length !== 1) return;
      const next = (bufferRef.current + event.key.toLowerCase()).slice(
        -trigger.length,
      );
      bufferRef.current = next;
      if (next === trigger) {
        bufferRef.current = "";
        setPhase((current) => (current === "idle" ? "passcode" : current));
        setError(null);
        setPasscode("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trigger]);

  const close = useCallback(() => {
    setPhase("idle");
    setPasscode("");
    setError(null);
    setExportResult(null);
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, close]);

  const submitPasscode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.khaliduo?.diagnosticsUnlock(passcode);
      if (result?.ok && result.snapshot) {
        setSnapshot(result.snapshot);
        setPhase("open");
      } else {
        setError("Incorrect passcode.");
      }
    } finally {
      setBusy(false);
      setPasscode("");
    }
  }, [passcode]);

  const refresh = useCallback(async () => {
    const next = await window.khaliduo?.diagnosticsSnapshot();
    if (next) setSnapshot(next);
  }, []);

  const resync = useCallback(async () => {
    setBusy(true);
    setExportResult(null);
    try {
      const result = await window.khaliduo?.diagnosticsResync();
      if (result?.snapshot) setSnapshot(result.snapshot);
    } finally {
      setBusy(false);
    }
  }, []);

  const exportLogs = useCallback(async () => {
    setBusy(true);
    try {
      const result = await window.khaliduo?.diagnosticsExportLogs();
      setExportResult(
        result?.saved ? `Saved to ${result.path}` : "Export cancelled.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  if (phase === "idle") return null;

  return (
    <div className="diag-overlay" role="dialog" aria-modal="true" aria-label="Diagnostics">
      <div className="diag-card">
        {phase === "passcode" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitPasscode();
            }}
          >
            <h2 className="diag-title">Developer diagnostics</h2>
            <p className="diag-hint">Enter the passcode to continue.</p>
            <input
              className="diag-input"
              type="password"
              autoFocus
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              aria-label="Diagnostics passcode"
            />
            {error ? <p className="diag-error">{error}</p> : null}
            <div className="diag-actions">
              <button type="button" className="diag-btn" onClick={close}>
                Cancel
              </button>
              <button type="submit" className="diag-btn diag-btn-primary" disabled={busy}>
                {busy ? "Checking…" : "Unlock"}
              </button>
            </div>
          </form>
        ) : snapshot ? (
          <>
            <div className="diag-head">
              <h2 className="diag-title">Diagnostics · {snapshot.deviceName}</h2>
              <button type="button" className="diag-btn" onClick={close}>
                Close
              </button>
            </div>
            <dl className="diag-grid">
              <Item label="Employee" value={snapshot.employeeName} />
              <Item label="App version" value={`${snapshot.appVersion} (${snapshot.environment})`} />
              <Item label="Platform" value={snapshot.platform} />
              <Item
                label="Connection"
                value={snapshot.connectionStatus}
                tone={snapshot.connectionStatus === "online" ? "ok" : "bad"}
              />
              <Item label="Last sync" value={timeAgo(snapshot.lastSuccessfulSyncAt)} />
              <Item label="API" value={snapshot.apiBaseUrl} wide />
              <Item label="Requests" value={String(snapshot.network.requests)} />
              <Item
                label="Failures"
                value={String(snapshot.network.failures)}
                tone={snapshot.network.failures > 0 ? "warn" : "ok"}
              />
              <Item
                label="Retries / recovered"
                value={`${snapshot.network.retries} / ${snapshot.network.recoveredByRetry}`}
              />
              <Item label="Last error" value={snapshot.network.lastErrorCode ?? "none"} />
              <Item
                label="Queued (events / shots)"
                value={`${snapshot.unsynced.pendingEvents} / ${snapshot.unsynced.pendingScreenshots}`}
                tone={
                  snapshot.unsynced.pendingEvents + snapshot.unsynced.pendingScreenshots > 0
                    ? "warn"
                    : "ok"
                }
              />
              <Item label="Open sessions" value={String(snapshot.unsynced.openSessions)} />
            </dl>
            {exportResult ? <p className="diag-note">{exportResult}</p> : null}
            <div className="diag-actions">
              <button type="button" className="diag-btn" onClick={() => void refresh()} disabled={busy}>
                Refresh
              </button>
              <button type="button" className="diag-btn" onClick={() => void exportLogs()} disabled={busy}>
                Export logs
              </button>
              <button
                type="button"
                className="diag-btn diag-btn-primary"
                onClick={() => void resync()}
                disabled={busy}
              >
                {busy ? "Working…" : "Force resync"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Item({
  label,
  value,
  tone,
  wide,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
  wide?: boolean;
}) {
  return (
    <div className={`diag-item${wide ? " diag-item-wide" : ""}`}>
      <dt>{label}</dt>
      <dd data-tone={tone ?? undefined}>{value}</dd>
    </div>
  );
}
