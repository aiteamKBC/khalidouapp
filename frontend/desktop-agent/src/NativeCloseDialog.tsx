import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { WindowCloseChoice, WindowCloseRequest } from "../electron/services/windowClosePrompt";
import { TrackerIcon } from "./tracker-ui/TrackerIcon";
import "./native-close-dialog.css";

export default function NativeCloseDialog() {
  const [request, setRequest] = useState<WindowCloseRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const currentRequest = useRef(request);
  currentRequest.current = request;
  const requestId = request?.id;

  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = window.khaliduo?.onWindowCloseRequested?.(next => {
      receivedUpdate = true;
      if (active) setRequest(next);
    });
    void window.khaliduo?.getWindowCloseRequest?.().then(next => {
      if (active && !receivedUpdate) setRequest(next);
    }).catch(() => {});
    return () => { active = false; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (!requestId) return;
    setError(null);
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>(".native-close-primary")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [requestId]);

  async function choose(choice: WindowCloseChoice) {
    if (!request || submitting.current) return;
    const id = request.id;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await window.khaliduo?.respondWindowClose(id, choice);
      if (currentRequest.current?.id !== id) return;
      if (result?.success) setRequest(null);
      else setError(result?.message ?? "Could not complete this action. Please try again.");
    } catch {
      if (currentRequest.current?.id === id) setError("Could not complete this action. Please try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); void choose("cancel"); }
    if (event.key !== "Tab") return;
    const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const first = buttons[0], last = buttons.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  if (!request) return null;
  return createPortal(
    <div className="native-close-overlay" onKeyDown={onKeyDown}>
      <div ref={dialog} className="native-close-dialog" role="dialog" aria-modal="true" aria-labelledby="native-close-title" aria-describedby="native-close-description" aria-busy={busy}>
        <header className="native-close-heading">
          <span className="native-close-icon"><TrackerIcon className="ri-logout-box-line" aria-hidden="true" /></span>
          <button type="button" className="native-close-dismiss" aria-label="Keep app open" onClick={() => void choose("cancel")} disabled={busy}>×</button>
          <h2 id="native-close-title">Close Khaliduo?</h2>
          <p id="native-close-description">{request.paused ? "Your tracking is currently paused." : "Your work timer is currently running."} Choose what happens next.</p>
        </header>
        <div className="native-close-body">
          <button type="button" className="native-close-option native-close-primary" onClick={() => void choose("hide")} disabled={busy}>
            <span className="native-close-option-icon"><TrackerIcon className="ri-window-minimize-line" aria-hidden="true" /></span>
            <span><strong>{request.paused ? "Hide (Keep Paused)" : "Hide & Keep Tracking"}</strong><small>{request.paused ? "Your timer stays paused. The app stays in the system tray." : "Keep tracking in the background from the system tray."}</small></span>
            <TrackerIcon className="ri-arrow-right-line" aria-hidden="true" />
          </button>
          <button type="button" className="native-close-option" onClick={() => void choose("toggle")} disabled={busy}>
            <span className="native-close-option-icon"><TrackerIcon className={request.paused ? "ri-play-circle-line" : "ri-pause-circle-line"} aria-hidden="true" /></span>
            <span><strong>{request.paused ? "Resume Tracking & Hide" : "Pause & Hide"}</strong><small>{request.paused ? "Resume your work timer, then hide this window." : "Pause your work timer, then hide this window."}</small></span>
            <TrackerIcon className="ri-arrow-right-line" aria-hidden="true" />
          </button>
          <button type="button" className="native-close-option native-close-quit" onClick={() => void choose("quit")} disabled={busy}>
            <span className="native-close-option-icon"><TrackerIcon className="ri-shut-down-line" aria-hidden="true" /></span>
            <span><strong>Quit Khaliduo</strong><small>Stop tracking and close the application completely.</small></span>
            <TrackerIcon className="ri-arrow-right-line" aria-hidden="true" />
          </button>
          {error && <p className="native-close-error" role="alert">{error}</p>}
        </div>
        <footer className="native-close-footer"><span>{busy ? "Applying your choice…" : "You can reopen the app from the system tray."}</span><button type="button" onClick={() => void choose("cancel")} disabled={busy}>Cancel</button></footer>
      </div>
    </div>, document.body,
  );
}
