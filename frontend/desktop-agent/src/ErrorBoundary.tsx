import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

// Last-resort UI safety net: any throw during render (e.g. a malformed value
// reaching a date/number formatter) is caught here and shown as a recoverable
// card instead of silently unmounting the whole tree into a blank window.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the main process log via the renderer console (electron-log
    // captures console output), so a render crash is diagnosable, not invisible.
    console.error("Renderer render error", error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            padding: "24px",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <p style={{ margin: 0, maxWidth: 360, opacity: 0.8 }}>
            The window hit an unexpected error. Your tracked time is saved
            locally and keeps syncing in the background.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: "#1f7a4d",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
