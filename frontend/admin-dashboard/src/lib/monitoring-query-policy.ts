export type MonitoringDetailSection = "attendance" | "screenshots" | "applications";

export function monitoringScopeKey(userId: string | undefined, scopedTeamIds?: string[]) {
  return [userId ?? "anonymous", [...(scopedTeamIds ?? [])].sort().join("|")].join(":");
}

export function monitoringRosterQueryKey(section: "employees" | "teams", scopeKey: string) {
  return ["monitoring", section, scopeKey] as const;
}

export function monitoringDetailQueryKey(
  section: MonitoringDetailSection,
  scopeKey: string,
  employeeId: string,
  day: string,
  page?: number,
) {
  return [
    "monitoring",
    section,
    scopeKey,
    employeeId,
    day,
    section,
    ...(page === undefined ? [] : [page]),
  ] as const;
}

export function monitoringDetailEnabled(sectionIsActive: boolean, employeeId: string, day: string) {
  return sectionIsActive && Boolean(employeeId && day);
}

export function monitoringDetailPolicy(day: string, today = localIsoDate()) {
  const historical = day !== today;
  return {
    staleTime: historical ? 5 * 60_000 : 30_000,
    refetchInterval: historical ? false : 60_000,
  } as const;
}

export function localIsoDate(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
