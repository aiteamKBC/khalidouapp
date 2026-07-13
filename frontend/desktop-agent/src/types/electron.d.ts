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
  connectionStatus: "online" | "offline";
  lastScreenshotAt: string | null;
  lastSuccessfulSyncAt: string | null;
  agentVersion: string;
  privacyNotice: string;
  tasks: AgentTask[];
  projects: AgentProject[];
  selectedTask: AgentTask | null;
  timeAdjustmentRequests: TimeAdjustmentRequest[];
  timeSummary: {
    today: AgentPeriodSummary;
    week: AgentPeriodSummary;
    month: AgentPeriodSummary;
  } | null;
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

export type AgentTask = {
  id: string;
  name: string;
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
};

export type AgentProject = {
  id: string;
  name: string;
  team_id: string;
  team_name: string;
};

export type TimeAdjustmentRequest = {
  id: string;
  requested_date: string;
  requested_minutes: number;
  approved_minutes: number | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  admin_note: string | null;
  created_at: string;
};

export type IdleAlert = {
  id: string;
  lostSeconds: number;
  endedAt: string;
};

declare global {
  interface Window {
    khaliduo?: {
      getAgentStatus: () => Promise<AgentStatus>;
      enrollDevice: (
        enrollmentCode: string,
      ) => Promise<{ success: boolean; message?: string }>;
      enrollWithCredentials: (
        email: string,
        password: string,
      ) => Promise<{ success: boolean; message?: string }>;
      pauseTracking: () => Promise<{ success: boolean; message?: string }>;
      resumeTracking: () => Promise<{ success: boolean; message?: string }>;
      openEmployeeDashboard: () => Promise<{
        success: boolean;
        message?: string;
      }>;
      setCurrentTask: (
        taskId: string | null,
      ) => Promise<{ success: boolean; message?: string }>;
      createTask: (options: {
        name: string;
        projectId?: string;
        description?: string;
        stage?: "assigned";
        startDate?: string;
        deadline?: string;
        estimatedMinutes?: number;
      }) => Promise<{ success: boolean; message?: string }>;
      updateTaskStage: (
        taskId: string,
        stage: "assigned" | "in_progress" | "ready_for_review" | "blocked",
        note?: string,
      ) => Promise<{ success: boolean; message?: string }>;
      onIdleAlert: (callback: (alert: IdleAlert) => void) => () => void;
      createTimeAdjustmentRequest: (
        requestedMinutes: number,
        reason: string,
      ) => Promise<{
        success: boolean;
        message?: string;
        request?: TimeAdjustmentRequest;
      }>;
    };
  }
}
