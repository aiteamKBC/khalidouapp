// A heartbeat / state-event request is sent for one session, but its response
// arrives asynchronously. Between send and response the current session can
// change — a task switch ends session A and opens B, or the employee logs out /
// re-enrolls. Applying the stale snapshot for A over the newer session B reverts
// its id, counters, start time, task, and pause state.
//
// This decides whether an in-flight session snapshot may still be applied: only
// when the session the request was sent for is still current AND enrollment has
// not changed. A legitimate server rollover / long-idle restart is still applied
// because in that case no concurrent local change moved the current session, so
// it remains equal to the request's session at response time.

export function sessionSnapshotIsApplicable(input: {
  // The session id the request was issued for.
  requestSessionId: string;
  // runtimeStatus's current session id when the response arrives.
  currentSessionId: string | null;
  // Enrollment generation captured when the request was issued.
  requestEnrollmentGeneration: number;
  // Enrollment generation now (bumped on logout / re-enrollment).
  currentEnrollmentGeneration: number;
}): boolean {
  return (
    input.requestEnrollmentGeneration === input.currentEnrollmentGeneration &&
    input.currentSessionId === input.requestSessionId
  );
}
