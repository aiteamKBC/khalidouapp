export type Role = "general_admin" | "team_owner" | "hr";
export type PermissionMode = "role" | "custom";
export type DataScope = "company" | "assigned_teams";

export type EmployeeStatus = "active" | "idle" | "locked" | "sleeping" | "offline";
export type EmployeeAccountStatus = "invited" | "active" | "inactive";
export type DeviceStatus = "online" | "offline" | "revoked";
export type TeamStatus = "active" | "archived";
export type UserStatus = "active" | "inactive";
export type TeamMemberRole = "team_manager" | "team_lead" | "senior" | "member" | "trainee";

export interface User {
  id: string;
  employeeId?: string;
  name: string;
  email: string;
  jobTitle?: string;
  role: Role;
  isSuperAdmin: boolean;
  permissions: string[];
  assignedTeamIds: string[];
  permissionMode: PermissionMode;
  dataScope: DataScope;
  teamLeadTeamIds: string[];
  trackAsEmployee: boolean;
  trackedEmployeeId?: string;
  status: UserStatus;
  lastLogin?: string;
  avatarUrl?: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  status: TeamStatus;
  ownerIds: string[];
  employeeIds: string[];
  createdAt: string;
}

export interface Project {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  projectName: string;
  teamId: string;
  teamName: string;
  assigneeEmployeeId?: string;
  collaboratorEmployeeIds: string[];
  position: number;
  completedAt?: string;
  startDate?: string;
  deadline?: string;
  estimatedMinutes?: number;
  labels: string[];
  recurrenceRule?: string;
  priority: "low" | "medium" | "high" | "urgent";
  createdByEmployeeId?: string;
  blockedReason?: string;
  blockedAt?: string;
  blockedByEmployeeId?: string;
  blockedByAdminUserId?: string;
  blockResolutionNote?: string;
  reviewNote?: string;
  completionNote?: string;
  reviewedAt?: string;
  isSystemDefault?: boolean;
  checklist: TaskChecklistItem[];
  name: string;
  description?: string;
  status: "active" | "archived";
  stage: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskChecklistItem {
  id: string;
  title: string;
  completed: boolean;
  position: number;
  assigneeEmployeeId?: string;
}

export interface Employee {
  id: string;
  name: string;
  code: string;
  email: string;
  jobTitle: string;
  teamRole?: TeamMemberRole;
  teamIds: string[];
  status: EmployeeStatus;
  sessionStart?: string;
  workedTodayMinutes: number;
  activeMinutes: number;
  idleMinutes: number;
  lastHeartbeat?: string;
  lastScreenshotAt?: string;
  currentDeviceId?: string;
  currentDeviceName?: string;
  currentTeamId?: string;
  currentProjectId?: string;
  currentTaskId?: string;
  active: boolean;
  accountStatus: EmployeeAccountStatus;
  invitation?: {
    id: string;
    status: "pending" | "accepted" | "expired" | "revoked";
    expiresAt: string;
  };
  portalAccessEnabled: boolean;
  portalLastLoginAt?: string;
  portalLastLoginIp?: string;
  portalLastUserAgent?: string;
  weeklyCapacityMinutes: number;
}

export interface Device {
  id: string;
  name: string;
  employeeId: string;
  os: string;
  agentVersion: string;
  status: DeviceStatus;
  lastSeen?: string;
  registeredAt: string;
  tokenStatus: "valid" | "revoked";
  windowsUsername?: string;
  lastIpAddress?: string;
}

export interface WorkSession {
  id: string;
  employeeId: string;
  deviceId: string;
  teamId?: string;
  projectId?: string;
  taskId?: string;
  startedAt: string;
  endedAt?: string;
  activeMinutes: number;
  idleMinutes: number;
  screenshotCount: number;
}

export interface ActivityEvent {
  id: string;
  employeeId: string;
  type: string;
  at: string;
  meta?: Record<string, string>;
}

export type WorkdayIntervalType = "worked" | "idle" | "locked" | "sleeping";

export interface WorkdayInterval {
  type: WorkdayIntervalType;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  sessionId: string;
  projectName?: string;
  taskName?: string;
  isCurrent: boolean;
}

export interface WorkdayTimeline {
  date: string;
  timezone: string;
  firstStartedAt?: string;
  lastEndedAt?: string;
  isRunning: boolean;
  workedSeconds: number;
  idleSeconds: number;
  lockedSeconds: number;
  sleepingSeconds: number;
  intervals: WorkdayInterval[];
}

export interface Screenshot {
  id: string;
  employeeId: string;
  teamId: string;
  projectId?: string;
  taskId?: string;
  sessionId: string;
  deviceId: string;
  capturedAt: string;
  thumbnailUrl: string;
  fullUrl: string;
  isIdle: boolean;
  displayId?: string;
  displayName?: string;
}

export interface Timesheet {
  id: string;
  employeeId: string;
  teamId: string;
  date: string;
  startTime?: string;
  endTime?: string;
  totalMinutes: number;
  activeMinutes: number;
  idleMinutes: number;
  adjustmentMinutes: number;
  deductedMinutes: number;
  points: number;
  screenshotCount: number;
  status: "complete" | "in_progress" | "missing";
}

export interface TrackingSettings {
  screenshotsEnabled: boolean;
  screenshotIntervalMinutes: 5 | 10 | 15 | 20 | 30;
  screenshotsPerInterval: number;
  idleThresholdMinutes: number;
  captureDuringIdle: boolean;
  offlineThresholdMinutes: number;
  screenshotRetentionDays: number;
}

export interface DashboardSummary {
  totalEmployees: number;
  onlineEmployees: number;
  activeEmployees: number;
  idleEmployees: number;
  offlineEmployees: number;
  teams: number;
  hoursTrackedToday: number;
  screenshotsToday: number;
}

export interface AuditLogEntry {
  id: string;
  at: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityName: string;
  ip: string;
  details?: string;
}

export type TimeAdjustmentStatus = "pending" | "approved" | "rejected";

export interface TimeAdjustmentRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  deviceId?: string;
  workSessionId?: string;
  requestType?: string;
  requestedDate: string;
  sourceStartAt?: string;
  sourceEndAt?: string;
  requestedMinutes: number;
  approvedMinutes?: number;
  reason: string;
  status: TimeAdjustmentStatus;
  reviewedByName?: string;
  reviewedAt?: string;
  adminNote?: string;
  createdAt: string;
}
