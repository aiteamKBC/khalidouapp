// Follow-up finding 2: a delayed heartbeat ERROR for a superseded session must
// not mutate the newer session. The success path already guards with
// sessionSnapshotIsApplicable; the catch branch did not, so a late 404 (or an
// identity mismatch) for session A cleared session B and scheduled a spurious
// restart. These tests drive the real heartbeatTick.
import assert from "node:assert/strict";
import test from "node:test";
import { context, functions, moduleSource } from "./support/mainHarness.ts";

function heartbeatContext(overrides: Record<string, unknown> = {}) {
  let rejectHeartbeat: ((error: unknown) => void) | null = null;
  let restarts = 0;
  let identityResets = 0;
  const c = context({
    sendHeartbeat: () =>
      new Promise((_resolve, reject) => {
        rejectHeartbeat = reject;
      }),
    recalculateWorkedTime: () => {},
    apiResponseStatus: (error: { response?: { status?: number } }) =>
      error.response?.status,
    isDeviceIdentityMismatch: () => false,
    resetForDeviceReenrollment: () => {
      identityResets += 1;
    },
    axios: { isAxiosError: () => true },
    beginLocalTrackingSession: () => {},
    enqueuePendingEvent: () => {},
    scheduleAutomaticTrackingRestart: () => {
      restarts += 1;
    },
    ...overrides,
  });
  moduleSource(c, "electron/services/runtimePolicies.ts");
  moduleSource(c, "electron/services/sessionSnapshotGuard.ts");
  functions(c, "heartbeatTick");
  return {
    c: c as Record<string, unknown> & {
      heartbeatTick: (o?: { refreshMetadata?: boolean }) => Promise<void>;
    },
    reject: (error: unknown) => rejectHeartbeat!(error),
    restarts: () => restarts,
    identityResets: () => identityResets,
  };
}

test("a delayed 404 for session A does not clear the newer session B", async () => {
  const h = heartbeatContext();
  const request = h.c.heartbeatTick({ refreshMetadata: false });
  // The user switched task/session while A's heartbeat was in flight.
  h.c.currentSessionId = "B";
  h.c.runtimeStatus.sessionStartedAt = "2026-09-10T11:59:00Z";
  h.reject(
    Object.assign(new Error("A not found"), { response: { status: 404 } }),
  );
  await request;
  assert.equal(h.c.currentSessionId, "B", "B's identity must survive");
  assert.equal(
    h.c.runtimeStatus.sessionStartedAt,
    "2026-09-10T11:59:00Z",
    "B's start time must survive",
  );
  assert.equal(h.restarts(), 0, "no spurious restart for a superseded session");
});

test("a delayed identity mismatch after re-enrollment does not reset the new enrollment", async () => {
  const h = heartbeatContext({ isDeviceIdentityMismatch: () => true });
  const request = h.c.heartbeatTick({ refreshMetadata: false });
  // A re-enrollment bumped the generation while A's heartbeat was in flight.
  h.c.enrollmentGeneration = 1;
  h.reject(
    Object.assign(new Error("identity"), { response: { status: 409 } }),
  );
  await request;
  assert.equal(
    h.identityResets(),
    0,
    "a stale identity error must not clear the newer enrollment",
  );
});

test("a 404 for the CURRENT session still recovers into a fresh session", async () => {
  const h = heartbeatContext();
  const request = h.c.heartbeatTick({ refreshMetadata: false });
  // No switch: the current session itself is gone server-side.
  h.reject(
    Object.assign(new Error("gone"), { response: { status: 404 } }),
  );
  await request;
  assert.equal(h.c.currentSessionId, null, "the dead current session is cleared");
  assert.equal(h.restarts(), 1, "a fresh session is scheduled");
});
