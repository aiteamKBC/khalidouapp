export type AttendanceTab = "daily" | "employee-history";

export function attendanceTabIsActive(activeTab: AttendanceTab, queryTab: AttendanceTab) {
  return activeTab === queryTab;
}

export function attendanceRefetchInterval(options: {
  active: boolean;
  pendingRefreshCount: number;
  isToday: boolean;
}): number | false {
  if (!options.active) return false;
  if (options.pendingRefreshCount > 0) return 2_000;
  return options.isToday ? 60_000 : false;
}
