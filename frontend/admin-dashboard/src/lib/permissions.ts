export const permissions = {
  dashboardView: "dashboard.view",
  accessManage: "access.manage",
  auditView: "audit.view",
  settingsView: "settings.view",
  settingsManage: "settings.manage",
  teamsView: "teams.view",
  teamsManage: "teams.manage",
  peopleView: "people.view",
  peopleManage: "people.manage",
  peopleArchive: "people.archive",
  payrollView: "payroll.view",
  payrollManage: "payroll.manage",
  liveActivityView: "live_activity.view",
  screenshotsView: "screenshots.view",
  screenshotsManage: "screenshots.manage",
  timesheetsView: "timesheets.view",
  timesheetsManage: "timesheets.manage",
  timeRequestsView: "time_requests.view",
  timeRequestsManage: "time_requests.manage",
  breaksView: "breaks.view",
  leaveRequestsView: "leave_requests.view",
  leaveRequestsManage: "leave_requests.manage",
  devicesView: "devices.view",
  devicesManage: "devices.manage",
  projectsView: "projects.view",
  projectsManage: "projects.manage",
  notificationsView: "notifications.view",
  reportsView: "reports.view",
  reportsExport: "reports.export",
} as const;

export type PermissionKey = (typeof permissions)[keyof typeof permissions];

export function requiredPermissionForPath(pathname: string): PermissionKey | undefined {
  if (pathname.startsWith("/dashboard")) return permissions.dashboardView;
  if (pathname.startsWith("/teams")) return permissions.teamsView;
  if (pathname.startsWith("/projects")) return permissions.projectsView;
  if (pathname.startsWith("/screenshots")) return permissions.screenshotsView;
  if (pathname.startsWith("/timesheets")) return permissions.timesheetsView;
  if (pathname.startsWith("/time-adjustments")) return permissions.timeRequestsView;
  if (pathname.startsWith("/breaks")) return permissions.breaksView;
  if (pathname.startsWith("/holiday-requests")) return permissions.leaveRequestsView;
  if (pathname.startsWith("/payroll")) return permissions.payrollView;
  if (pathname.startsWith("/devices")) return permissions.devicesView;
  if (pathname.startsWith("/reports")) return permissions.reportsView;
  if (pathname.startsWith("/settings/tracking")) return permissions.settingsView;
  if (pathname.startsWith("/audit-log")) return permissions.auditView;
  if (pathname.startsWith("/users")) return permissions.accessManage;
  if (pathname.startsWith("/notifications")) return permissions.notificationsView;
  if (pathname.startsWith("/employees")) return permissions.peopleView;
  if (pathname.startsWith("/live-activity")) return permissions.liveActivityView;
  if (pathname.startsWith("/people")) return permissions.peopleView;
  return undefined;
}
