export type TrackingCounters = {
  activeSeconds: number;
  idleSeconds: number;
};

export type OpenLocalTrackingSnapshot = TrackingCounters & {
  startedAt: string;
  lastCheckpointAt: string;
  status: string;
};

export type RestoredLocalTrackingSnapshot = TrackingCounters & {
  startedAt: string;
  lastCheckpointAt: string;
  status: "active" | "idle" | "locked" | "sleeping";
};

function nonNegativeInteger(value: number) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

function safeTimestamp(value: string, fallback: Date, latest: Date) {
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getTime() > latest.getTime() + 30_000
  ) {
    return fallback.toISOString();
  }
  return parsed.toISOString();
}

export function restoreOpenLocalTrackingSnapshot(
  snapshot: OpenLocalTrackingSnapshot,
  now = new Date(),
): RestoredLocalTrackingSnapshot {
  const startedAt = safeTimestamp(snapshot.startedAt, now, now);
  const started = new Date(startedAt);
  const lastCheckpointAt = safeTimestamp(
    snapshot.lastCheckpointAt,
    started,
    now,
  );
  const status = ["active", "idle", "locked", "sleeping"].includes(
    snapshot.status,
  )
    ? (snapshot.status as RestoredLocalTrackingSnapshot["status"])
    : "active";
  return {
    startedAt,
    lastCheckpointAt,
    status,
    activeSeconds: nonNegativeInteger(snapshot.activeSeconds),
    idleSeconds: nonNegativeInteger(snapshot.idleSeconds),
  };
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
