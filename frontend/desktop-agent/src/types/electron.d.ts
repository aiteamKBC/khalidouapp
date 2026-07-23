export type AgentStatus = {
  enrolled: boolean;
  employeeName: string;
  employeeAvatarUrl: string | null;
  deviceName: string;
  trackingStatus:
    | "starting"
    | "active"
    | "idle"
    | "locked"
    | "sleeping"
    | "paused"
    | "offline"
    | "error";
  trackingPaused: boolean;
  sessionStartedAt: string | null;
  workedTodaySeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  eligibleIdleSeconds: number;
  connectionStatus: "online" | "offline";
  lastScreenshotAt: string | null;
  screenshotMonitoringEnabled: boolean;
  screenshotCaptureActive: boolean;
  powerSource: "ac" | "battery";
  lastSuccessfulSyncAt: string | null;
  agentVersion: string;
  privacyNotice: string;
  tasks: AgentTask[];
  projects: AgentProject[];
  selectedTask: AgentTask | null;
  timeAdjustmentRequests: TimeAdjustmentRequest[];
  leaveRequests: LeaveRequestsPayload | null;
  requestPolicy: RequestPolicy | null;
  timeSummary: {
    today: AgentPeriodSummary;
    week: AgentPeriodSummary;
    month: AgentPeriodSummary;
  } | null;
  dailyTargetSeconds: number;
  dailyTargetProgressPercent: number;
  activityPercent: number;
  normalSeconds: number;
  extraSeconds: number;
  overtimeEnabled: boolean;
  extraTimeStatus: "none" | "pending_overtime" | "recorded_not_counted";
  paidPauseEndsAt: string | null;
  paidPauseRemainingSeconds: number;
  paidPauseBalanceRemainingSeconds: number | null;
  recentTasks: AgentTask[];
  todayTimeline: WorkdayTimeline | null;
  lastIdleAlert: IdleAlert | null;
  updateStatus:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "up-to-date"
    | "error";
  updateVersion: string | null;
  updatePercent: number | null;
};

export type AgentPeriodSummary = {
  active_seconds: number;
  tracked_active_seconds: number;
  idle_seconds: number;
  tracked_seconds: number;
  adjustment_seconds: number;
  manual_approved_seconds: number;
  manual_pending_seconds: number;
  manual_rejected_seconds: number;
  deducted_seconds: number;
  screenshot_count: number;
  points: number;
};

export type WorkdayTimeline = {
  date: string;
  timezone: string;
  first_started_at: string | null;
  last_ended_at: string | null;
  last_activity_at: string | null;
  is_running: boolean;
  worked_seconds: number;
  idle_seconds: number;
  locked_seconds: number;
  sleeping_seconds: number;
  intervals: Array<{
    type: "worked" | "idle" | "locked" | "sleeping";
    started_at: string;
    ended_at: string | null;
    duration_seconds: number;
    session_id: string;
    project_name: string | null;
    task_name: string | null;
    is_current: boolean;
  }>;
};

export type AgentTask = {
  id: string;
  name: string;
  description: string | null;
  stage:
    | "new_requests"
    | "backlog"
    | "assigned"
    | "in_progress"
    | "ready_for_review"
    | "completed"
    | "blocked"
    | "rejected"
    | "cancelled";
  canUpdateStage: boolean;
  projectId: string;
  projectName: string;
  teamId: string;
  teamName: string;
  reviewNote: string | null;
  completionNote: string | null;
  checklist: Array<{
    id: string;
    title: string;
    completed: boolean;
    position: number;
    assigneeEmployeeId: string | null;
  }>;
  activeSeconds: number;
  idleSeconds: number;
  trackedSeconds: number;
};

export type RequestPolicy = {
  timezone: string;
  shift_start: string | null;
  shift_end: string | null;
  working_days: number[];
  break_rules?: Array<{
    name: string;
    minutes: number;
    paid: boolean;
    start_time?: string | null;
    end_time?: string | null;
  }>;
  approved_leave_today?: boolean;
  approved_early_leave_from?: string | null;
  weekly_early_leave_minutes: number;
  weekly_early_leave_used_minutes: number;
  weekly_early_leave_remaining_minutes: number;
};

export type AgentProject = {
  id: string;
  name: string;
  team_id: string;
  team_name: string;
};

export type TimeAdjustmentRequest = {
  id: string;
  request_type: "idle_time" | "early_leave" | "manual_time";
  requested_date: string;
  source_start_at: string | null;
  source_end_at: string | null;
  work_session_id: string | null;
  requested_minutes: number;
  approved_minutes: number | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  admin_note: string | null;
  created_at: string;
};

export type LeaveRequest = {
  id: string;
  start_date: string;
  end_date: string;
  requested_days: number;
  leave_type: "annual" | "sick" | "unpaid";
  reason?: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  created_at?: string;
};

export type LeaveBalance = {
  year: number;
  credit_days: number;
  used_days: number;
  pending_days: number;
  remaining_days: number;
};

export type LeaveRequestsPayload = {
  balance: LeaveBalance;
  requests: LeaveRequest[];
};

export type IdleAlert = {
  id: string;
  lostSeconds: number;
  eligibleLostSeconds: number;
  outsideScheduledShift: boolean;
  endedAt: string;
};

export type RecentScreenshot = {
  id: string;
  capturedAt: string;
  displayName: string | null;
  dataUrl: string;
};

declare global {
  interface Window {
    khaliduo?: {
      getAgentStatus: () => Promise<AgentStatus>;
      onStatusChanged: (callback: (status: AgentStatus) => void) => () => void;
      enrollWithCredentials: (
        email: string,
        password: string,
      ) => Promise<{ success: boolean; message?: string }>;
      pauseTracking: (options?: {
        requestedMinutes?: number;
        reason?: string;
      }) => Promise<{ success: boolean; message?: string }>;
      resumeTracking: () => Promise<{ success: boolean; message?: string }>;
      logout: () => Promise<{ success: boolean; message?: string }>;
      openEmployeeDashboard: (section?: "screenshots") => Promise<{
        success: boolean;
        message?: string;
      }>;
      getRecentScreenshots: () => Promise<{
        success: boolean;
        message?: string;
        screenshots: RecentScreenshot[];
      }>;
      setCurrentTask: (taskId: string | null) => Promise<{
        success: boolean;
        message?: string;
        status?: AgentStatus;
      }>;
      createTask: (options: {
        name: string;
        projectId?: string;
        description?: string;
        stage?: "assigned";
        startDate?: string;
        deadline?: string;
        estimatedMinutes?: number;
      }) => Promise<{
        success: boolean;
        message?: string;
        status?: AgentStatus;
      }>;
      updateTaskStage: (
        taskId: string,
        stage: "assigned" | "in_progress" | "ready_for_review" | "blocked",
        note?: string,
      ) => Promise<{
        success: boolean;
        message?: string;
        status?: AgentStatus;
      }>;
      createTaskChecklistItem: (
        taskId: string,
        title: string,
      ) => Promise<{
        success: boolean;
        message?: string;
        status?: AgentStatus;
      }>;
      updateTaskChecklistItem: (
        taskId: string,
        itemId: string,
        completed: boolean,
      ) => Promise<{
        success: boolean;
        message?: string;
        status?: AgentStatus;
      }>;
      deleteTaskChecklistItems: (
        taskId: string,
        itemIds: string[],
      ) => Promise<{
        success: boolean;
        message?: string;
        status?: AgentStatus;
      }>;
      onIdleAlert: (callback: (alert: IdleAlert) => void) => () => void;
      onRequiredUpdate: (
        callback: (update: { version: string | null }) => void,
      ) => () => void;
      installUpdate: () => Promise<{ success: boolean; message?: string }>;
      createTimeAdjustmentRequest: (input: {
        requestedMinutes: number;
        reason: string;
        requestType?: "idle_time" | "early_leave" | "manual_time";
        requestedDate?: string;
        workSessionId?: string;
        sourceStartAt?: string;
        sourceEndAt?: string;
        requestedLeaveTime?: string;
      }) => Promise<{
        success: boolean;
        message?: string;
        request?: TimeAdjustmentRequest;
        status?: AgentStatus;
      }>;
      createLeaveRequest: (input: {
        startDate: string;
        endDate: string;
        leaveType?: "annual" | "sick" | "unpaid";
        reason?: string;
      }) => Promise<{
        success: boolean;
        message?: string;
        request?: LeaveRequest;
        status?: AgentStatus;
      }>;
      setIdleAlertAttention: (active: boolean) => void;
      setUpdateAttention: (active: boolean) => void;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      checkForUpdates: () => Promise<{ success: boolean; message?: string }>;
    };
  }
}
