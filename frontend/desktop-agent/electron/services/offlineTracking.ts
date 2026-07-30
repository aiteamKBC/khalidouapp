export type TrackingCounters = {
  activeSeconds: number;
  idleSeconds: number;
};

function nonNegativeInteger(value: number) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

export function mergeRecoveredCounters(
  server: TrackingCounters,
  local: TrackingCounters,
): TrackingCounters {
  return {
    activeSeconds:
      nonNegativeInteger(server.activeSeconds) +
      nonNegativeInteger(local.activeSeconds),
    idleSeconds:
      nonNegativeInteger(server.idleSeconds) +
      nonNegativeInteger(local.idleSeconds),
  };
}

export function offsetRecoveredEventPayload(
  payload: Record<string, unknown>,
  serverIdleSeconds: number,
) {
  const offset = nonNegativeInteger(serverIdleSeconds);
  const adjusted = { ...payload };
  for (const key of ["idle_seconds", "idle_seconds_before_gap"]) {
    const value = adjusted[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      adjusted[key] = offset + nonNegativeInteger(value);
    }
  }
  return adjusted;
}
