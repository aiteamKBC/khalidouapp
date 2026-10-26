// Keep one snapshot request in flight, and never let an older snapshot replace
// a newer native status event (for example Resume, End Shift or sign-out).
export function createStatusReader<T>(read: () => Promise<T>, publish: (status: T) => void) {
  let active = true;
  let reading = false;
  let revision = 0;
  return {
    push(status: T) {
      if (!active) return;
      revision++;
      publish(status);
    },
    async poll() {
      if (!active || reading) return;
      reading = true;
      const requestedRevision = revision;
      try {
        const status = await read();
        if (active && requestedRevision === revision) {
          revision++;
          publish(status);
        }
      } catch {
        // A transient IPC failure must not produce an unhandled rejection or
        // prevent the next poll from recovering.
      } finally {
        reading = false;
      }
    },
    stop() {
      active = false;
      revision++;
    },
  };
}
