export function shouldReloadScreenshotsAfterRecovery(options: {
  previousConnectionStatus: "online" | "offline";
  connectionStatus: "online" | "offline";
  hasLoadError: boolean;
}) {
  return (
    options.hasLoadError &&
    options.previousConnectionStatus === "offline" &&
    options.connectionStatus === "online"
  );
}

export function screenshotSyncLabel(connectionStatus: "online" | "offline") {
  return connectionStatus === "online" ? "Synced" : "Last synced";
}
