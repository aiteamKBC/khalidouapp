import electronCommon from "electron/common";
import electronMain from "electron/main";
import log from "electron-log/main";
import electronUpdater from "electron-updater";
import dotenv from "dotenv";
import axios from "axios";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  enrollDeviceWithCredentials,
  endSession,
  getAgentConfig,
  getAgentSummary,
  getCurrentSession,
  completeScreenshot,
  createEmployeePortalHandoff,
  downloadAgentScreenshot,
  createAgentTask,
  createAgentTaskChecklistItem,
  createLeaveRequest,
  createTimeAdjustmentRequest,
  listAgentProjects,
  listLeaveRequests,
  listAgentRecentScreenshots,
  listAgentTasks,
  initiateScreenshot,
  reportScreenshotSkip,
  listTimeAdjustmentRequests,
  sendQueuedRequest,
  sendActivityEvent,
  sendHeartbeat,
  startPaidPause,
  startSession,
  type ScreenshotMetadata,
  type AgentTask as ApiAgentTask,
  type AgentProject,
  type AgentSummary,
  type PauseState,
  type WorkdayState,
  type LeaveRequestsPayload,
  type TimeAdjustmentRequest,
  uploadScreenshot,
  updateSessionTask,
  updateAgentTaskStage,
  updateAgentTaskChecklistItem,
  type TrackingConfig,
  type RequestPolicy,
  type WorkSession,
} from "./services/agentApi.js";
import {
  clearEnrollmentIdentity,
  isEnrolled,
  loadIdentity,
} from "./services/identityStore.js";
import type { StoredIdentity } from "./services/identityStore.js";
import {
  enqueuePendingEvent,
  enqueuePendingScreenshot,
  getDuePendingEvents,
  getDuePendingScreenshots,
  initializeLocalDatabase,
  markPendingEventFailed,
  markPendingEventUploaded,
  markPendingScreenshotFailed,
  markPendingScreenshotUploaded,
} from "./services/localDb.js";

const { nativeImage, shell } = electronCommon;
const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  screen,
  Tray,
} = electronMain;
const { autoUpdater } = electronUpdater;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type AgentRuntimeStatus = {
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
  screenshotMonitoringEnabled: boolean;
  screenshotCaptureActive: boolean;
  powerSource: "ac" | "battery";
  lastSuccessfulSyncAt: string | null;
  agentVersion: string;
  tasks: RuntimeTask[];
  projects: AgentProject[];
  selectedTask: RuntimeTask | null;
  timeAdjustmentRequests: TimeAdjustmentRequest[];
  leaveRequests: LeaveRequestsPayload | null;
  requestPolicy: RequestPolicy | null;
  timeSummary: Pick<AgentSummary, "today" | "week" | "month"> | null;
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
  recentTasks: RuntimeTask[];
  todayTimeline: AgentSummary["today_timeline"] | null;
  lastIdleAlert: IdleLossAlert | null;
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

type RuntimeTask = {
  id: string;
  name: string;
  description: string | null;
  projectId: string;
  projectName: string;
  teamId: string;
  teamName: string;
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

type IdleLossAlert = {
  id: string;
  lostSeconds: number;
  endedAt: string;
};

let mainWindow: Electron.BrowserWindow | null = null;
let tray: Electron.Tray | null = null;
let isQuitting = false;
let quitNotificationSent = false;
let currentSessionId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let durationTimer: ReturnType<typeof setInterval> | null = null;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let idleAttentionTimer: ReturnType<typeof setTimeout> | null = null;
let idleAlertAttentionActive = false;
let updateAttentionActive = false;
let screenshotTimer: ReturnType<typeof setTimeout> | null = null;
let screenshotQueue: number[] = [];
let screenshotWindowEndsAt: number | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let automaticTrackingRetryTimer: ReturnType<typeof setTimeout> | null = null;
let isStartingTrackingAutomatically = false;
let idleSecondsBeforeCurrentIdle = 0;
let lastDurationTickAt: number | null = null;
let workedTodayBaseSeconds = 0;
let trackingPausedByUser = false;
let isHandlingWindowClose = false;
let hasShownMinimizeBalloon = false;
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
let initialUpdateCheckTimer: ReturnType<typeof setTimeout> | null = null;
let manualUpdateCheckRequested = false;
let isUpdateCheckRunning = false;
let isInstallingUpdate = false;
let hasPromptedForDownloadedUpdate = false;
let lastFullSummaryRefreshAt = 0;
let lastMetadataRefreshAt = 0;
let paidPauseTimer: ReturnType<typeof setTimeout> | null = null;
let displaySleepBlockerId: number | null = null;
let onAcPower = true;
let trackingConfig: TrackingConfig = {
  screenshot_enabled: true,
  screenshot_interval_minutes: 10,
  screenshots_per_interval: 1,
  idle_threshold_minutes: 10,
  capture_during_idle: false,
  offline_threshold_minutes: 3,
  screenshot_retention_days: 30,
};

const runtimeStatus: AgentRuntimeStatus = {
  enrolled: false,
  employeeName: "Not enrolled",
  employeeAvatarUrl: null,
  deviceName: process.env.COMPUTERNAME ?? "Windows device",
  trackingStatus: "starting",
  trackingPaused: false,
  sessionStartedAt: null,
  workedTodaySeconds: 0,
  activeSeconds: 0,
  idleSeconds: 0,
  connectionStatus: "offline",
  lastScreenshotAt: null,
  screenshotMonitoringEnabled: true,
  screenshotCaptureActive: false,
  powerSource: "ac",
  lastSuccessfulSyncAt: null,
  agentVersion: app.getVersion(),
  tasks: [],
  projects: [],
  selectedTask: null,
  timeAdjustmentRequests: [],
  leaveRequests: null,
  requestPolicy: null,
  timeSummary: null,
  dailyTargetSeconds: 8 * 60 * 60,
  dailyTargetProgressPercent: 0,
  activityPercent: 0,
  normalSeconds: 0,
  extraSeconds: 0,
  overtimeEnabled: false,
  extraTimeStatus: "none",
  paidPauseEndsAt: null,
  paidPauseRemainingSeconds: 0,
  paidPauseBalanceRemainingSeconds: null,
  recentTasks: [],
  todayTimeline: null,
  lastIdleAlert: null,
  updateStatus: "idle",
  updateVersion: null,
  updatePercent: null,
};

const privacyNotice =
  "While this enrolled device is active, unlocked, and connected to AC power, company policy may capture periodic workplace screenshots even when no task timer is selected. It does not record typed text, passwords, webcam, microphone, or personal files.";

dotenv.config({
  path: app.isPackaged
    ? path.join(process.resourcesPath, "khaliduo-runtime.env")
    : path.join(app.getAppPath(), ".env"),
});

function normalizeTrackingConfig(config: TrackingConfig): TrackingConfig {
  return {
    ...config,
    screenshots_per_interval: Math.max(
      1,
      Math.min(2, config.screenshots_per_interval ?? 1),
    ),
  };
}

function mapTask(task: ApiAgentTask): RuntimeTask {
  return {
    id: task.id,
    name: task.name,
    description: task.description ?? null,
    projectId: task.project_id,
    projectName: task.project_name,
    teamId: task.team_id,
    teamName: task.team_name,
    stage: task.stage,
    canUpdateStage: task.can_update_stage,
    reviewNote: task.review_note ?? null,
    completionNote: task.completion_note ?? null,
    checklist: (task.checklist ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      completed: item.completed,
      position: item.position,
      assigneeEmployeeId: item.assignee_employee_id,
    })),
    activeSeconds: task.active_seconds ?? 0,
    idleSeconds: task.idle_seconds ?? 0,
    trackedSeconds: task.tracked_seconds ?? 0,
  };
}

function selectRuntimeTask(taskId?: string | null) {
  runtimeStatus.selectedTask = taskId
    ? (runtimeStatus.tasks.find((task) => task.id === taskId) ?? null)
    : null;
}

function getUserFacingError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      { error?: { message?: string }; detail?: string } | undefined;
    return data?.error?.message ?? data?.detail ?? error.message ?? fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function hydrateIdentityStatus() {
  const identity = loadIdentity();
  runtimeStatus.enrolled = isEnrolled(identity);
  runtimeStatus.employeeName = identity.employeeName ?? "Not enrolled";
  runtimeStatus.deviceName =
    identity.deviceName ?? process.env.COMPUTERNAME ?? "Windows device";
}

async function activateEnrolledDevice(identity: StoredIdentity) {
  runtimeStatus.enrolled = true;
  runtimeStatus.employeeName = identity.employeeName ?? "Enrolled employee";
  runtimeStatus.deviceName = identity.deviceName ?? runtimeStatus.deviceName;
  runtimeStatus.trackingStatus = "active";
  runtimeStatus.connectionStatus = "online";
  trackingPausedByUser = false;
  runtimeStatus.trackingPaused = false;
  saveTrackingPreferences();
  configureAutoStart(true);
  tray?.setImage(createTrayImage("#1f7a4d"));
  await startTrackingAutomatically();
  await refreshTasks();
  await refreshTimeAdjustmentRequests();
  await refreshLeaveRequests();
  rebuildTrayMenu();
}

function getAppIconPath() {
  const candidates = [
    path.join(__dirname, "..", "dist-khaliduo", "khaliduo-icon.png"),
    path.join(app.getAppPath(), "dist-khaliduo", "khaliduo-icon.png"),
    path.join(app.getAppPath(), "public", "khaliduo-icon.png"),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  );
}

function createTrayImage(color = "#342361") {
  const brandIcon = nativeImage.createFromPath(getAppIconPath());
  if (!brandIcon.isEmpty()) {
    return brandIcon.resize({ width: 24, height: 24, quality: "best" });
  }
  return nativeImage.createFromDataURL(
    "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="${color}"/><path d="M9 17l5 5 10-12" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      ),
  );
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function updateDisplaySleepBlocker() {
  const shouldKeepDisplayAwake =
    runtimeStatus.enrolled &&
    Boolean(currentSessionId) &&
    !trackingPausedByUser &&
    !runtimeStatus.trackingPaused &&
    !isQuitting;
  const blockerIsRunning =
    displaySleepBlockerId !== null &&
    powerSaveBlocker.isStarted(displaySleepBlockerId);

  if (shouldKeepDisplayAwake && !blockerIsRunning) {
    displaySleepBlockerId = powerSaveBlocker.start("prevent-display-sleep");
    log.info("Display sleep prevention enabled while tracking is running");
    return;
  }
  if (!shouldKeepDisplayAwake && blockerIsRunning && displaySleepBlockerId !== null) {
    powerSaveBlocker.stop(displaySleepBlockerId);
    displaySleepBlockerId = null;
    log.info("Display sleep prevention disabled");
  }
}

function rebuildTrayMenu() {
  if (!tray) {
    return;
  }

  updateDisplaySleepBlocker();

  const trackingActive = Boolean(currentSessionId) && !trackingPausedByUser;
  const updateLabel =
    runtimeStatus.updateStatus === "ready"
      ? `Update ${runtimeStatus.updateVersion ?? ""} ready to install`.trim()
      : runtimeStatus.updateStatus === "downloading"
        ? `Downloading update: ${Math.round(runtimeStatus.updatePercent ?? 0)}%`
        : runtimeStatus.updateStatus === "checking"
          ? "Checking for updates..."
          : runtimeStatus.updateStatus === "error"
            ? "Update check failed"
            : `Version: ${runtimeStatus.agentVersion}`;
  const menu = Menu.buildFromTemplate([
    { label: "Khaliduo — Kent Consultancy", enabled: false },
    {
      label: !runtimeStatus.enrolled
        ? "Enrollment Required"
        : trackingActive
          ? "Tracking Active"
          : "Tracking Paused",
      enabled: false,
    },
    {
      label: `Worked Today: ${formatDuration(runtimeStatus.workedTodaySeconds)}`,
      enabled: false,
    },
    { label: `Status: ${runtimeStatus.trackingStatus}`, enabled: false },
    { label: `Connection: ${runtimeStatus.connectionStatus}`, enabled: false },
    {
      label: `Last Sync: ${runtimeStatus.lastSuccessfulSyncAt ?? "Never"}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: trackingActive
        ? "Screenshots: Random schedule"
        : "Screenshots: Paused",
      enabled: false,
    },
    { type: "separator" },
    { label: "Open Khaliduo", click: () => showMainWindow() },
    runtimeStatus.enrolled
      ? trackingActive
        ? {
            label: "Pause Tracking & Screenshots",
            click: () => void pauseTracking("Paused from system tray"),
          }
        : { label: "Resume Tracking", click: () => void resumeTracking() }
      : { label: "Open to Enroll", click: () => showMainWindow() },
    {
      label: "Sync Now",
      enabled: runtimeStatus.enrolled && !trackingPausedByUser,
      click: () => void syncNow(),
    },
    runtimeStatus.enrolled
      ? {
          label: "Sign Out This Device",
          click: () => void logoutDevice(),
        }
      : { label: "Device Not Signed In", enabled: false },
    { type: "separator" },
    { label: updateLabel, enabled: false },
    runtimeStatus.updateStatus === "ready"
      ? {
          label: "Restart & Install Update",
          click: () => void installDownloadedUpdate(),
        }
      : {
          label: "Check for Updates",
          enabled: !isUpdateCheckRunning,
          click: () => void checkForUpdates(true),
        },
    { type: "separator" },
    { label: "Quit Khaliduo", click: () => app.quit() },
  ]);
  tray.setToolTip(
    !runtimeStatus.enrolled
      ? "Khaliduo — enrollment required"
      : trackingActive
        ? "Khaliduo — tracking active"
        : "Khaliduo — tracking paused",
  );
  tray.setContextMenu(menu);
}

function getTrackingPreferencesPath() {
  return path.join(app.getPath("userData"), "tracking-preferences.json");
}

function loadTrackingPreferences(resumeForWindowsStartup = false) {
  try {
    const preferences = JSON.parse(
      fs.readFileSync(getTrackingPreferencesPath(), "utf-8"),
    ) as {
      paused_by_user?: boolean;
    };
    trackingPausedByUser =
      !resumeForWindowsStartup && preferences.paused_by_user === true;
  } catch {
    trackingPausedByUser = false;
  }
  runtimeStatus.trackingPaused = trackingPausedByUser;
  if (resumeForWindowsStartup) {
    saveTrackingPreferences();
  }
  if (trackingPausedByUser && runtimeStatus.enrolled) {
    runtimeStatus.trackingStatus = "paused";
  }
}

function saveTrackingPreferences() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(
    getTrackingPreferencesPath(),
    JSON.stringify({ paused_by_user: trackingPausedByUser }, null, 2),
    "utf-8",
  );
}

function getScreenshotSchedulePath() {
  return path.join(app.getPath("userData"), "screenshot-schedule.json");
}

function saveScreenshotSchedule(nextAt: number | null) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(
    getScreenshotSchedulePath(),
    JSON.stringify(
      {
        mode: "random",
        interval_minutes: trackingConfig.screenshot_interval_minutes,
        captures_per_interval: trackingConfig.screenshots_per_interval,
        window_ends_at: screenshotWindowEndsAt
          ? new Date(screenshotWindowEndsAt).toISOString()
          : null,
        captures_remaining: screenshotQueue.length + (nextAt ? 1 : 0),
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function getPendingScreenshotDirectory() {
  return path.join(app.getPath("userData"), "pending-screenshots");
}

function syncRuntimeFromSession(session: WorkSession) {
  if (trackingPausedByUser) {
    return;
  }
  if (
    session.ended_at ||
    session.status === "ended" ||
    session.status === "offline"
  ) {
    if (currentSessionId === session.id) {
      currentSessionId = null;
    }
    runtimeStatus.sessionStartedAt = null;
    runtimeStatus.trackingStatus = "offline";
    runtimeStatus.activeSeconds = session.active_seconds;
    runtimeStatus.idleSeconds = session.idle_seconds;
    runtimeStatus.workedTodaySeconds =
      workedTodayBaseSeconds + runtimeStatus.activeSeconds;
    lastDurationTickAt = null;
    return;
  }
  const changedSession = currentSessionId !== session.id;
  const localActiveSeconds = changedSession ? 0 : runtimeStatus.activeSeconds;
  const localIdleSeconds = changedSession ? 0 : runtimeStatus.idleSeconds;
  currentSessionId = session.id;
  runtimeStatus.sessionStartedAt = session.started_at;
  runtimeStatus.trackingStatus = session.status;
  runtimeStatus.activeSeconds = Math.max(
    session.active_seconds,
    localActiveSeconds,
  );
  runtimeStatus.idleSeconds = Math.max(session.idle_seconds, localIdleSeconds);
  runtimeStatus.workedTodaySeconds =
    workedTodayBaseSeconds + runtimeStatus.activeSeconds;
  if (changedSession) {
    lastDurationTickAt = Date.now();
    idleSecondsBeforeCurrentIdle = session.idle_seconds;
  }
  selectRuntimeTask(session.task_id);
}

function applyWorkdayState(workday?: WorkdayState | null) {
  if (workday) {
    runtimeStatus.dailyTargetSeconds = workday.required_normal_seconds;
    runtimeStatus.normalSeconds = workday.normal_seconds;
    runtimeStatus.extraSeconds = workday.extra_seconds;
    runtimeStatus.overtimeEnabled = workday.overtime_enabled;
    runtimeStatus.extraTimeStatus = workday.extra_time_status;
    const trackedTodaySeconds = workday.normal_seconds + workday.extra_seconds;
    runtimeStatus.workedTodaySeconds = Math.max(
      runtimeStatus.workedTodaySeconds,
      trackedTodaySeconds,
    );
    workedTodayBaseSeconds = Math.max(
      0,
      trackedTodaySeconds - runtimeStatus.activeSeconds,
    );
    runtimeStatus.dailyTargetProgressPercent = Math.min(
      100,
      Math.round(
        (workday.normal_seconds /
          Math.max(1, workday.required_normal_seconds)) *
          100,
      ),
    );
    return;
  }
  const normalSeconds = Math.min(
    runtimeStatus.workedTodaySeconds,
    runtimeStatus.dailyTargetSeconds,
  );
  runtimeStatus.normalSeconds = normalSeconds;
  runtimeStatus.extraSeconds = Math.max(
    0,
    runtimeStatus.workedTodaySeconds - runtimeStatus.dailyTargetSeconds,
  );
  runtimeStatus.extraTimeStatus =
    runtimeStatus.extraSeconds > 0 ? "recorded_not_counted" : "none";
}

function timeToMinuteOfDay(value?: string | null) {
  if (!value) return null;
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function scheduledIdleIsCountable(at: Date) {
  const policy = runtimeStatus.requestPolicy;
  if (!policy) return true;
  if (policy.approved_leave_today) return false;
  if (
    runtimeStatus.paidPauseEndsAt &&
    new Date(runtimeStatus.paidPauseEndsAt).getTime() > at.getTime()
  ) {
    return false;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: policy.timezone || "UTC",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const weekday =
    (
      { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<
        string,
        number
      >
    )[part("weekday") ?? ""] ?? -1;
  if (!policy.working_days.includes(weekday)) return false;
  const minuteOfDay = Number(part("hour")) * 60 + Number(part("minute"));
  const shiftStart = timeToMinuteOfDay(policy.shift_start);
  const shiftEnd = timeToMinuteOfDay(policy.shift_end);
  if (
    shiftStart === null ||
    shiftEnd === null ||
    minuteOfDay < shiftStart ||
    minuteOfDay >= shiftEnd
  ) {
    return false;
  }
  const approvedEarlyLeave = timeToMinuteOfDay(
    policy.approved_early_leave_from,
  );
  if (approvedEarlyLeave !== null && minuteOfDay >= approvedEarlyLeave) {
    return false;
  }
  return !(policy.break_rules ?? []).some((rule) => {
    if (!rule.paid) return false;
    const start = timeToMinuteOfDay(rule.start_time);
    const end = timeToMinuteOfDay(rule.end_time);
    return (
      start !== null &&
      end !== null &&
      minuteOfDay >= start &&
      minuteOfDay < end
    );
  });
}

function recalculateWorkedTime() {
  if (
    !currentSessionId ||
    !runtimeStatus.sessionStartedAt ||
    !runtimeStatus.enrolled ||
    trackingPausedByUser
  ) {
    lastDurationTickAt = null;
    return;
  }

  const now = Date.now();
  if (lastDurationTickAt === null) {
    lastDurationTickAt = now;
    return;
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((now - lastDurationTickAt) / 1000),
  );
  if (elapsedSeconds === 0) {
    return;
  }
  lastDurationTickAt += elapsedSeconds * 1000;

  if (runtimeStatus.paidPauseEndsAt) {
    runtimeStatus.paidPauseRemainingSeconds = Math.max(
      0,
      Math.ceil(
        (new Date(runtimeStatus.paidPauseEndsAt).getTime() - now) / 1000,
      ),
    );
  }

  if (runtimeStatus.trackingStatus === "idle") {
    if (scheduledIdleIsCountable(new Date(now))) {
      runtimeStatus.idleSeconds += elapsedSeconds;
    }
  } else if (
    runtimeStatus.trackingStatus === "active" ||
    runtimeStatus.trackingStatus === "starting"
  ) {
    runtimeStatus.activeSeconds += elapsedSeconds;
  }
  runtimeStatus.workedTodaySeconds =
    workedTodayBaseSeconds + runtimeStatus.activeSeconds;
  applyWorkdayState();
  rebuildTrayMenu();
}

async function refreshWorkedTodayTotal() {
  if (!runtimeStatus.enrolled) {
    workedTodayBaseSeconds = 0;
    runtimeStatus.workedTodaySeconds = 0;
    return;
  }
  try {
    const previousTimelineDate = runtimeStatus.todayTimeline?.date ?? null;
    const summary = await getAgentSummary();
    runtimeStatus.employeeName = summary.employee.name;
    runtimeStatus.employeeAvatarUrl = summary.employee.avatar_url;
    runtimeStatus.timeSummary = {
      today: summary.today,
      week: summary.week,
      month: summary.month,
    };
    runtimeStatus.dailyTargetSeconds =
      summary.daily_target_seconds ?? 8 * 60 * 60;
    runtimeStatus.dailyTargetProgressPercent =
      summary.daily_target_progress_percent ?? 0;
    runtimeStatus.activityPercent = summary.activity_percent ?? 0;
    runtimeStatus.todayTimeline = summary.today_timeline;
    const trackedTodaySeconds = Math.max(
      summary.today.tracked_active_seconds,
      summary.today_timeline?.worked_seconds ?? 0,
    );
    const serverBaseSeconds = Math.max(
      0,
      trackedTodaySeconds - runtimeStatus.activeSeconds,
    );
    workedTodayBaseSeconds =
      previousTimelineDate === summary.today_timeline?.date
        ? Math.max(workedTodayBaseSeconds, serverBaseSeconds)
        : serverBaseSeconds;
    runtimeStatus.workedTodaySeconds = Math.max(
      trackedTodaySeconds,
      workedTodayBaseSeconds + runtimeStatus.activeSeconds,
    );
    const countedTodaySeconds =
      runtimeStatus.workedTodaySeconds + summary.today.manual_approved_seconds;
    runtimeStatus.normalSeconds = Math.min(
      countedTodaySeconds,
      runtimeStatus.dailyTargetSeconds,
    );
    runtimeStatus.extraSeconds = Math.max(
      0,
      countedTodaySeconds - runtimeStatus.dailyTargetSeconds,
    );
  } catch (error) {
    log.warn("Failed to refresh today's worked time", error);
  }
}

function showIdleLossAlert(lostSeconds: number) {
  if (lostSeconds <= 0) {
    return;
  }

  runtimeStatus.lastIdleAlert = {
    id: randomUUID(),
    lostSeconds,
    endedAt: new Date().toISOString(),
  };
  setIdleAlertAttention(true);
  showMainWindow({ forceForeground: true, centerOnPointerDisplay: true });
  mainWindow?.webContents.send("agent:idle-alert", runtimeStatus.lastIdleAlert);
}

async function refreshTimeAdjustmentRequests() {
  if (!runtimeStatus.enrolled) {
    runtimeStatus.timeAdjustmentRequests = [];
    return;
  }
  try {
    runtimeStatus.timeAdjustmentRequests = await listTimeAdjustmentRequests();
  } catch (error) {
    log.warn("Failed to refresh time adjustment requests", error);
  }
}

async function refreshLeaveRequests() {
  if (!runtimeStatus.enrolled) {
    runtimeStatus.leaveRequests = null;
    return;
  }
  try {
    runtimeStatus.leaveRequests = await listLeaveRequests();
  } catch (error) {
    log.warn("Failed to refresh leave requests", error);
  }
}

async function refreshTasks() {
  if (!runtimeStatus.enrolled) {
    runtimeStatus.tasks = [];
    runtimeStatus.selectedTask = null;
    runtimeStatus.recentTasks = [];
    return;
  }
  try {
    const [tasks, projects] = await Promise.all([
      listAgentTasks(),
      listAgentProjects(),
    ]);
    const runtimeTasks = tasks.map(mapTask);
    runtimeStatus.tasks = runtimeTasks;
    runtimeStatus.projects = projects;
    runtimeStatus.recentTasks = [...runtimeTasks]
      .sort(
        (a, b) =>
          b.trackedSeconds - a.trackedSeconds ||
          b.activeSeconds - a.activeSeconds ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 3);
    selectRuntimeTask(runtimeStatus.selectedTask?.id ?? null);
  } catch (error) {
    log.warn("Failed to refresh tasks", error);
  }
}

async function sendStateEvent(
  eventType: string,
  status: AgentRuntimeStatus["trackingStatus"],
) {
  runtimeStatus.trackingStatus = status;
  rebuildTrayMenu();
  if (!currentSessionId || !runtimeStatus.enrolled) {
    return;
  }

  const eventId = randomUUID();
  const endpoint = `/agent/sessions/${currentSessionId}/events`;
  const payload = {
    event_id: eventId,
    event_type: eventType,
    event_timestamp: new Date().toISOString(),
    payload: {
      status,
      idle_seconds: runtimeStatus.idleSeconds,
      agent_version: runtimeStatus.agentVersion,
    },
  };

  try {
    const result = await sendActivityEvent({
      sessionId: currentSessionId,
      eventId,
      eventType,
      payload: payload.payload,
    });
    const latestLocalStatus = runtimeStatus.trackingStatus;
    syncRuntimeFromSession(result.session);
    applyWorkdayState(result.workday);
    if (latestLocalStatus !== status) {
      runtimeStatus.trackingStatus = latestLocalStatus;
    }
    await refreshWorkedTodayTotal();
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
  } catch (error) {
    runtimeStatus.connectionStatus = "offline";
    enqueuePendingEvent({
      id: eventId,
      method: "POST",
      endpoint,
      payload,
      idempotencyKey: eventId,
    });
    log.warn(`Failed to send ${eventType}`, error);
  } finally {
    if (!isQuitting) {
      void refreshTrackingConfig();
      void refreshTasks();
    }
    rebuildTrayMenu();
  }
}

function startIdleMonitor() {
  if (idleTimer) {
    return;
  }

  idleTimer = setInterval(() => {
    if (
      !runtimeStatus.enrolled ||
      runtimeStatus.trackingStatus === "locked" ||
      runtimeStatus.trackingStatus === "sleeping"
    ) {
      return;
    }

    const idleSeconds = powerMonitor.getSystemIdleTime();
    const thresholdSeconds = trackingConfig.idle_threshold_minutes * 60;
    if (
      idleSeconds >= thresholdSeconds &&
      runtimeStatus.trackingStatus !== "idle"
    ) {
      recalculateWorkedTime();
      idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
      void sendStateEvent("idle_started", "idle");
    } else if (
      idleSeconds < thresholdSeconds &&
      runtimeStatus.trackingStatus === "idle"
    ) {
      recalculateWorkedTime();
      const lostSeconds = Math.max(
        0,
        runtimeStatus.idleSeconds - idleSecondsBeforeCurrentIdle,
      );
      idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
      showIdleLossAlert(lostSeconds);
      void sendStateEvent("idle_ended", "active");
    }
  }, 1000);
}

async function heartbeatTick() {
  if (!currentSessionId || !runtimeStatus.enrolled) {
    return;
  }

  recalculateWorkedTime();
  const eventId = randomUUID();
  const status =
    runtimeStatus.trackingStatus === "idle" ||
    runtimeStatus.trackingStatus === "locked" ||
    runtimeStatus.trackingStatus === "sleeping"
      ? runtimeStatus.trackingStatus
      : "active";
  const payload = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    status,
    idle_seconds: runtimeStatus.idleSeconds,
    active_seconds: runtimeStatus.activeSeconds,
    agent_version: runtimeStatus.agentVersion,
  };

  try {
    const result = await sendHeartbeat({
      sessionId: currentSessionId,
      eventId,
      status,
      idleSeconds: runtimeStatus.idleSeconds,
      activeSeconds: runtimeStatus.activeSeconds,
      agentVersion: runtimeStatus.agentVersion,
    });
    const latestLocalStatus = runtimeStatus.trackingStatus;
    syncRuntimeFromSession(result.session);
    applyWorkdayState(result.workday);
    if (latestLocalStatus !== status) {
      runtimeStatus.trackingStatus = latestLocalStatus;
    }
    applyPauseState(result.pause);
    if (Date.now() - lastFullSummaryRefreshAt > 5 * 60 * 1000) {
      lastFullSummaryRefreshAt = Date.now();
      await refreshWorkedTodayTotal();
    }
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
  } catch (error) {
    runtimeStatus.connectionStatus = "offline";
    enqueuePendingEvent({
      id: eventId,
      method: "POST",
      endpoint: `/agent/sessions/${currentSessionId}/heartbeat`,
      payload,
      idempotencyKey: eventId,
    });
    log.warn("Heartbeat failed", error);
  } finally {
    if (Date.now() - lastMetadataRefreshAt > 5 * 60 * 1000) {
      lastMetadataRefreshAt = Date.now();
      void refreshTrackingConfig();
      void refreshTasks();
    }
    rebuildTrayMenu();
  }
}

function startTimers() {
  if (lastDurationTickAt === null) {
    lastDurationTickAt = Date.now();
  }
  if (!durationTimer) {
    durationTimer = setInterval(recalculateWorkedTime, 1000);
  }
  if (!heartbeatTimer) {
    const heartbeatSeconds = Number(
      process.env.HEARTBEAT_INTERVAL_SECONDS ?? "60",
    );
    heartbeatTimer = setInterval(
      () => void heartbeatTick(),
      Math.max(10, heartbeatSeconds) * 1000,
    );
  }
  startIdleMonitor();
  startScreenshotMonitoring();
}

function startScreenshotMonitoring() {
  scheduleNextScreenshot();
  if (!syncTimer) {
    syncTimer = setInterval(() => void syncPendingQueues(), 30_000);
  }
}

function clearRuntimeTimers() {
  lastDurationTickAt = null;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  if (screenshotTimer) {
    clearTimeout(screenshotTimer);
    screenshotTimer = null;
  }
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (automaticTrackingRetryTimer) {
    clearTimeout(automaticTrackingRetryTimer);
    automaticTrackingRetryTimer = null;
  }
}

function screenshotCaptureBlockReason(): string | null {
  if (!runtimeStatus.enrolled) return "device_not_enrolled";
  if (!trackingConfig.screenshot_enabled) return "capture_disabled";
  if (!onAcPower) return "battery_power";
  if (
    runtimeStatus.trackingStatus === "locked" ||
    runtimeStatus.trackingStatus === "sleeping"
  ) {
    return runtimeStatus.trackingStatus === "locked" ? "screen_locked" : "system_sleeping";
  }
  const systemIdleSeconds = powerMonitor.getSystemIdleTime();
  if (
    runtimeStatus.trackingStatus === "idle" ||
    systemIdleSeconds >= Math.max(60, trackingConfig.idle_threshold_minutes * 60)
  ) {
    return "no_user_activity";
  }
  return null;
}

async function refreshTrackingConfig() {
  if (!runtimeStatus.enrolled) {
    return;
  }
  try {
    const rawConfig = await getAgentConfig();
    const nextConfig = normalizeTrackingConfig(rawConfig);
    runtimeStatus.requestPolicy = rawConfig.request_policy ?? null;
    const scheduleChanged =
      nextConfig.screenshot_enabled !== trackingConfig.screenshot_enabled ||
      nextConfig.screenshot_interval_minutes !==
        trackingConfig.screenshot_interval_minutes ||
      nextConfig.screenshots_per_interval !==
        trackingConfig.screenshots_per_interval;

    trackingConfig = nextConfig;

    if (scheduleChanged) {
      if (screenshotTimer) {
        clearTimeout(screenshotTimer);
        screenshotTimer = null;
      }
      screenshotQueue = [];
      screenshotWindowEndsAt = null;
      scheduleNextScreenshot();
    }
  } catch (error) {
    log.warn("Failed to refresh tracking config", error);
  }
}

async function captureAndUploadScreenshot() {
  const blockReason = screenshotCaptureBlockReason();
  if (blockReason) {
    log.info("Screenshot skipped", { reason: blockReason });
    if (runtimeStatus.enrolled) {
      try {
        await reportScreenshotSkip({
          eventId: randomUUID(),
          sessionId: currentSessionId,
          occurredAt: new Date().toISOString(),
          reason: blockReason,
          powerSource: onAcPower ? "ac" : "battery",
          trackingStatus: runtimeStatus.trackingStatus,
        });
      } catch (error) {
        log.warn("Failed to report screenshot skip reason", error);
      }
    }
    return;
  }

  const displays = screen.getAllDisplays();
  const maxThumbnailSize = displays.reduce(
    (size, display) => ({
      width: Math.max(size.width, display.size.width),
      height: Math.max(size.height, display.size.height),
    }),
    { width: 1, height: 1 },
  );
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: maxThumbnailSize,
  });
  if (sources.length === 0) {
    throw new Error("No screen sources were available.");
  }

  const capturedAt = new Date().toISOString();
  let uploaded = 0;
  let queued = 0;
  for (const [index, source] of sources.entries()) {
    if (source.thumbnail.isEmpty()) {
      log.warn("Screen source was empty", {
        displayId: source.display_id,
        sourceName: source.name,
      });
      continue;
    }
    const screenshotId = randomUUID();
    const jpeg = source.thumbnail.toJPEG(72);
    const checksum = createHash("sha256").update(jpeg).digest("hex");
    const size = source.thumbnail.getSize();
    const metadata: ScreenshotMetadata = {
      screenshotId,
      sessionId: currentSessionId,
      capturedAt,
      width: size.width,
      height: size.height,
      fileSize: jpeg.length,
      mimeType: "image/jpeg",
      checksum,
      displayId: source.display_id || String(displays[index]?.id ?? index + 1),
      displayName: source.name || `Screen ${index + 1}`,
      displayCount: sources.length,
      powerSource: onAcPower ? "ac" : "battery",
    };

    try {
      await initiateScreenshot(metadata);
      await uploadScreenshot(screenshotId, jpeg, "image/jpeg");
      await completeScreenshot({
        screenshotId,
        checksum,
        fileSize: jpeg.length,
      });
      uploaded += 1;
    } catch (error) {
      const pendingDirectory = getPendingScreenshotDirectory();
      fs.mkdirSync(pendingDirectory, { recursive: true });
      const filePath = path.join(pendingDirectory, `${screenshotId}.jpg`);
      fs.writeFileSync(filePath, jpeg);
      enqueuePendingScreenshot({ screenshotId, metadata, filePath });
      queued += 1;
      log.warn("Screen capture queued for retry", {
        displayId: metadata.displayId,
        error,
      });
    }
  }

  runtimeStatus.lastScreenshotAt = capturedAt;
  if (uploaded > 0)
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
  if (uploaded > 0) {
    runtimeStatus.connectionStatus = "online";
  } else if (queued > 0 && runtimeStatus.lastSuccessfulSyncAt === null) {
    runtimeStatus.connectionStatus = "offline";
  }
  rebuildTrayMenu();
  if (uploaded + queued > 0) {
    showScreenshotCapturedNotification();
  }
  log.info("Display screenshots processed", {
    displays: sources.length,
    uploaded,
    queued,
  });
}

function showScreenshotCapturedNotification() {
  const title = "Screenshot captured";
  const body = "Khaliduo took a screenshot to document your work and effort.";

  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      icon: path.join(__dirname, "..", "dist-khaliduo", "khaliduo-icon.png"),
      silent: true,
    });
    notification.on("click", () => showMainWindow());
    notification.show();
    return;
  }

  if (process.platform === "win32") {
    tray?.displayBalloon({ title, content: body, iconType: "info" });
  }
}

async function syncPendingQueues(forcePendingEvents = false) {
  if (!runtimeStatus.enrolled) {
    return;
  }

  for (const event of getDuePendingEvents(25, { force: forcePendingEvents })) {
    try {
      await sendQueuedRequest(
        event.method,
        event.endpoint,
        JSON.parse(event.payloadJson) as Record<string, unknown>,
      );
      markPendingEventUploaded(event.id);
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    } catch (error) {
      markPendingEventFailed(event.id, event.attempts);
      runtimeStatus.connectionStatus = "offline";
      log.warn("Pending event sync failed", error);
      continue;
    }
  }

  for (const screenshot of getDuePendingScreenshots()) {
    try {
      const metadata = JSON.parse(
        screenshot.metadataJson,
      ) as ScreenshotMetadata;
      const content = fs.readFileSync(screenshot.filePath);
      await initiateScreenshot(metadata);
      await uploadScreenshot(
        screenshot.screenshotId,
        content,
        metadata.mimeType,
      );
      await completeScreenshot({
        screenshotId: screenshot.screenshotId,
        checksum: metadata.checksum,
        fileSize: metadata.fileSize,
      });
      markPendingScreenshotUploaded(screenshot.screenshotId);
      fs.rmSync(screenshot.filePath, { force: true });
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    } catch (error) {
      markPendingScreenshotFailed(screenshot.screenshotId, screenshot.attempts);
      runtimeStatus.connectionStatus = "offline";
      log.warn("Pending screenshot sync failed", error);
      continue;
    }
  }
  rebuildTrayMenu();
}

function scheduleNextScreenshot() {
  if (screenshotTimer) {
    return;
  }
  if (
    !runtimeStatus.enrolled ||
    !trackingConfig.screenshot_enabled
  ) {
    screenshotQueue = [];
    screenshotWindowEndsAt = null;
    saveScreenshotSchedule(null);
    return;
  }

  const intervalMs =
    Math.max(1, trackingConfig.screenshot_interval_minutes) * 60 * 1000;
  const capturesPerInterval = Math.max(
    1,
    Math.min(2, trackingConfig.screenshots_per_interval ?? 1),
  );
  const now = Date.now();

  if (!screenshotWindowEndsAt || now >= screenshotWindowEndsAt) {
    screenshotWindowEndsAt = now + intervalMs;
    const randomSegmentMs = intervalMs / capturesPerInterval;
    screenshotQueue = Array.from(
      { length: capturesPerInterval },
      (_, index) =>
        now +
        Math.floor(
          index * randomSegmentMs +
            randomSegmentMs * (0.1 + Math.random() * 0.8),
        ),
    ).sort((a, b) => a - b);
  }

  screenshotQueue = screenshotQueue.filter((scheduledAt) => scheduledAt >= now);
  if (screenshotQueue.length === 0) {
    saveScreenshotSchedule(null);
    screenshotTimer = setTimeout(
      () => {
        screenshotTimer = null;
        scheduleNextScreenshot();
      },
      Math.max(0, screenshotWindowEndsAt - now),
    );
    return;
  }

  const nextAt = screenshotQueue.shift()!;
  const delayMs = Math.max(0, nextAt - now);
  saveScreenshotSchedule(nextAt);

  screenshotTimer = setTimeout(() => {
    screenshotTimer = null;
    captureAndUploadScreenshot()
      .catch((error) => {
        runtimeStatus.connectionStatus = "offline";
        log.warn("Screenshot capture/upload failed", error);
      })
      .finally(() => scheduleNextScreenshot());
  }, delayMs);
}

async function startTrackingAutomatically() {
  if (
    !runtimeStatus.enrolled ||
    trackingPausedByUser ||
    currentSessionId ||
    isStartingTrackingAutomatically
  ) {
    return;
  }

  isStartingTrackingAutomatically = true;
  if (automaticTrackingRetryTimer) {
    clearTimeout(automaticTrackingRetryTimer);
    automaticTrackingRetryTimer = null;
  }
  try {
    await syncPendingQueues(true);
    const rawConfig = await getAgentConfig();
    trackingConfig = normalizeTrackingConfig(rawConfig);
    runtimeStatus.requestPolicy = rawConfig.request_policy ?? null;
    await refreshTasks();
    const current = await getCurrentSession();
    if (current.session) {
      await endSession({
        sessionId: current.session.id,
        activeSeconds: current.session.active_seconds,
        idleSeconds: current.session.idle_seconds,
        reason: "Previous Khaliduo run closed before automatic restart",
      });
    }
    const started = await startSession();
    syncRuntimeFromSession(started.session);
    applyWorkdayState(started.workday);
    await refreshWorkedTodayTotal();
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    startTimers();
    void heartbeatTick();
    void refreshTimeAdjustmentRequests();
    void refreshLeaveRequests();
  } catch (error) {
    runtimeStatus.connectionStatus = "offline";
    runtimeStatus.trackingStatus = "offline";
    log.error("Automatic tracking start failed", error);
    if (!isQuitting && runtimeStatus.enrolled && !trackingPausedByUser) {
      automaticTrackingRetryTimer = setTimeout(() => {
        automaticTrackingRetryTimer = null;
        void startTrackingAutomatically();
      }, 15_000);
    }
  } finally {
    isStartingTrackingAutomatically = false;
    rebuildTrayMenu();
  }
}

function clearPaidPauseTimer() {
  if (paidPauseTimer) {
    clearTimeout(paidPauseTimer);
    paidPauseTimer = null;
  }
}

function schedulePaidPauseAutoResume(endsAt: string) {
  clearPaidPauseTimer();
  runtimeStatus.paidPauseEndsAt = endsAt;
  runtimeStatus.trackingPaused = true;
  const delayMs = Math.max(0, new Date(endsAt).getTime() - Date.now());
  runtimeStatus.paidPauseRemainingSeconds = Math.ceil(delayMs / 1000);
  paidPauseTimer = setTimeout(() => {
    runtimeStatus.trackingPaused = false;
    runtimeStatus.paidPauseEndsAt = null;
    runtimeStatus.paidPauseRemainingSeconds = 0;
    runtimeStatus.trackingStatus = currentSessionId
      ? "active"
      : runtimeStatus.trackingStatus;
    rebuildTrayMenu();
    void heartbeatTick();
  }, delayMs);
}

function applyPauseState(pause?: PauseState | null) {
  if (!pause) return;
  runtimeStatus.paidPauseBalanceRemainingSeconds = pause.remaining_seconds;
  if (pause.active_pause) {
    schedulePaidPauseAutoResume(pause.active_pause.scheduled_end_at);
    return;
  }
  if (runtimeStatus.trackingPaused && runtimeStatus.paidPauseEndsAt) {
    runtimeStatus.trackingPaused = false;
    runtimeStatus.paidPauseEndsAt = null;
    runtimeStatus.paidPauseRemainingSeconds = 0;
    clearPaidPauseTimer();
  }
}

async function stopTrackingSession(reason = "Stopped by employee") {
  recalculateWorkedTime();
  trackingPausedByUser = true;
  runtimeStatus.trackingPaused = true;
  saveTrackingPreferences();
  clearRuntimeTimers();
  // Task/work-time tracking may pause, but workplace screenshot monitoring is
  // an independent company policy and continues for an enrolled active device.
  startScreenshotMonitoring();

  const sessionId = currentSessionId;
  const eventId = randomUUID();
  const endedAt = new Date().toISOString();
  const activeSeconds = runtimeStatus.activeSeconds;
  const idleSeconds = runtimeStatus.idleSeconds;
  currentSessionId = null;
  runtimeStatus.sessionStartedAt = null;
  runtimeStatus.trackingStatus = "paused";
  rebuildTrayMenu();

  if (!sessionId) {
    return { success: true };
  }

  try {
    await endSession({
      sessionId,
      activeSeconds,
      idleSeconds,
      reason,
      endedAt,
      eventId,
    });
    await refreshWorkedTodayTotal();
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    return { success: true };
  } catch (error) {
    enqueuePendingEvent({
      id: eventId,
      method: "POST",
      endpoint: `/agent/sessions/${sessionId}/end`,
      payload: {
        event_id: eventId,
        ended_at: endedAt,
        active_seconds: activeSeconds,
        idle_seconds: idleSeconds,
        reason,
      },
      idempotencyKey: eventId,
    });
    if (!syncTimer) {
      syncTimer = setInterval(() => void syncPendingQueues(), 30_000);
    }
    runtimeStatus.connectionStatus = "offline";
    log.warn(
      "Tracking paused locally, but session end could not be synced",
      error,
    );
    return {
      success: true,
      message:
        "Tracking and screenshots are paused on this device. The server will update when the connection returns.",
    };
  } finally {
    rebuildTrayMenu();
  }
}

async function pauseTracking(
  options?: string | { requestedMinutes?: number; reason?: string },
) {
  if (!runtimeStatus.enrolled || !currentSessionId) {
    return {
      success: false,
      message: "Start your shift before using paid pause.",
    };
  }
  const requestedMinutes =
    typeof options === "object" && options?.requestedMinutes
      ? options.requestedMinutes
      : 10;
  const reason =
    typeof options === "string"
      ? options
      : typeof options === "object"
        ? options.reason
        : undefined;

  try {
    const result = await startPaidPause({
      sessionId: currentSessionId,
      requestedMinutes,
      reason,
    });
    syncRuntimeFromSession(result.session);
    applyWorkdayState(result.workday);
    applyPauseState(result.pause);
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    rebuildTrayMenu();
    return {
      success: true,
      message: `Paid pause started for ${requestedMinutes} minute(s). Auto resume will happen when it ends.`,
    };
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? (error.response?.data as { message?: string } | undefined)?.message
      : undefined;
    return {
      success: false,
      message: message ?? "Paid pause could not be started.",
    };
  }
}

async function resumeTracking() {
  if (!runtimeStatus.enrolled) {
    return {
      success: false,
      message: "Enroll this device before starting tracking.",
    };
  }
  trackingPausedByUser = false;
  runtimeStatus.trackingPaused = false;
  runtimeStatus.paidPauseEndsAt = null;
  runtimeStatus.paidPauseRemainingSeconds = 0;
  clearPaidPauseTimer();
  runtimeStatus.trackingStatus = "starting";
  saveTrackingPreferences();
  await startTrackingAutomatically();
  const success = Boolean(currentSessionId);
  return {
    success,
    message: success
      ? undefined
      : "Khaliduo could not start tracking. Check the backend connection and try again.",
  };
}

async function logoutDevice() {
  if (runtimeStatus.enrolled) {
    try {
      await syncPendingQueues(true);
    } catch (error) {
      log.warn("Final sync before sign-out failed", error);
    }
    await stopTrackingSession("Employee signed out from this device");
  }

  clearRuntimeTimers();
  clearEnrollmentIdentity();
  configureAutoStart(false);
  trackingPausedByUser = false;
  saveTrackingPreferences();
  currentSessionId = null;
  workedTodayBaseSeconds = 0;
  idleSecondsBeforeCurrentIdle = 0;
  screenshotQueue = [];
  screenshotWindowEndsAt = null;
  saveScreenshotSchedule(null);
  Object.assign(runtimeStatus, {
    enrolled: false,
    employeeName: "Not enrolled",
    employeeAvatarUrl: null,
    deviceName: process.env.COMPUTERNAME ?? "Windows device",
    trackingStatus: "starting",
    trackingPaused: false,
    sessionStartedAt: null,
    workedTodaySeconds: 0,
    activeSeconds: 0,
    idleSeconds: 0,
    connectionStatus: "offline",
    lastScreenshotAt: null,
    lastSuccessfulSyncAt: null,
    tasks: [],
    projects: [],
    selectedTask: null,
    timeAdjustmentRequests: [],
    timeSummary: null,
    todayTimeline: null,
    lastIdleAlert: null,
  } satisfies Partial<AgentRuntimeStatus>);
  tray?.setImage(createTrayImage("#b7791f"));
  rebuildTrayMenu();
  showMainWindow();
  return { success: true };
}

async function syncNow() {
  await syncPendingQueues();
  if (currentSessionId && !trackingPausedByUser) {
    await heartbeatTick();
  }
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: "Khaliduo Status",
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload is an ESM bundle; Electron sandboxed preloads cannot load
      // ESM imports. Context isolation and disabled Node integration still
      // keep application APIs behind the narrow contextBridge surface.
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });

  mainWindow.on("minimize", () => {
    mainWindow?.hide();
    rebuildTrayMenu();
    if (process.platform === "win32" && !hasShownMinimizeBalloon) {
      hasShownMinimizeBalloon = true;
      tray?.displayBalloon({
        title: "Khaliduo is running in the background",
        content:
          "Open it from the Khaliduo icon beside the Wi-Fi and sound icons.",
        iconType: "info",
      });
    }
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    if (!runtimeStatus.enrolled || !currentSessionId) {
      event.preventDefault();
      app.quit();
      return;
    }
    event.preventDefault();
    if (isHandlingWindowClose) {
      return;
    }
    isHandlingWindowClose = true;
    void dialog
      .showMessageBox(mainWindow!, {
        type: "question",
        title: "Close Khaliduo",
        message: trackingPausedByUser
          ? "Khaliduo is currently paused."
          : runtimeStatus.trackingPaused
            ? "Khaliduo is currently in paid pause."
            : "Tracking and screenshots are currently active.",
        detail:
          "Choose whether Khaliduo should keep tracking, hide, or quit completely.",
        buttons: trackingPausedByUser
          ? ["Hide (Keep Paused)", "Resume Tracking & Hide", "Quit Khaliduo"]
          : runtimeStatus.trackingPaused
            ? [
                "Hide (Keep Paid Pause)",
                "Resume Tracking & Hide",
                "Quit Khaliduo",
              ]
            : [
                "Hide & Keep Tracking",
                "Start 10m Paid Pause & Hide",
                "Quit Khaliduo",
              ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(async ({ response }) => {
        if (response === 1) {
          if (trackingPausedByUser || runtimeStatus.trackingPaused) {
            await resumeTracking();
          } else {
            await pauseTracking("Paused while closing the status window");
          }
          mainWindow?.hide();
        } else if (response === 2) {
          app.quit();
        } else {
          mainWindow?.hide();
          if (process.platform === "win32") {
            tray?.displayBalloon({
              title: "Khaliduo is still running",
              content:
                "Tracking continues in the notification area. Right-click the Khaliduo icon to pause or reopen it.",
              iconType: "info",
            });
          }
        }
      })
      .finally(() => {
        isHandlingWindowClose = false;
      });
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, "..", "dist-khaliduo", "index.html"),
    );
  }
}

function showMainWindow(
  options: {
    forceForeground?: boolean;
    centerOnPointerDisplay?: boolean;
  } = {},
) {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  if (options.centerOnPointerDisplay) {
    const { workArea } = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const bounds = window.getBounds();
    window.setPosition(
      Math.round(workArea.x + Math.max(0, (workArea.width - bounds.width) / 2)),
      Math.round(
        workArea.y + Math.max(0, (workArea.height - bounds.height) / 2),
      ),
    );
  }

  const useTransientForeground =
    options.forceForeground &&
    !idleAlertAttentionActive &&
    !updateAttentionActive;
  if (useTransientForeground) {
    window.setAlwaysOnTop(true, "screen-saver");
  }

  window.show();
  window.moveTop();
  window.focus();

  if (useTransientForeground) {
    if (idleAttentionTimer) {
      clearTimeout(idleAttentionTimer);
    }
    idleAttentionTimer = setTimeout(() => {
      idleAttentionTimer = null;
      if (!window.isDestroyed()) {
        window.setAlwaysOnTop(false);
      }
    }, 1500);
  }
}

function setIdleAlertAttention(active: boolean) {
  idleAlertAttentionActive = active;
  if (!active) {
    runtimeStatus.lastIdleAlert = null;
  }
  if (idleAttentionTimer) {
    clearTimeout(idleAttentionTimer);
    idleAttentionTimer = null;
  }

  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    return;
  }
  window.setAlwaysOnTop(active, "screen-saver");
  window.setMinimizable(!active);
  window.setClosable(!active);
  window.flashFrame(active);
  if (active) {
    window.show();
    window.moveTop();
    window.focus();
  }
}

function setUpdateAttention(active: boolean) {
  updateAttentionActive = active;
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    return;
  }
  window.setAlwaysOnTop(active || idleAlertAttentionActive, "screen-saver");
  window.setMinimizable(!active && !idleAlertAttentionActive);
  window.setClosable(!active && !idleAlertAttentionActive);
  window.flashFrame(active);
  if (active) {
    showMainWindow({ forceForeground: true, centerOnPointerDisplay: true });
  }
}

function showRequiredUpdatePrompt(version: string | null) {
  setUpdateAttention(true);
  showMainWindow({ forceForeground: true, centerOnPointerDisplay: true });
  mainWindow?.webContents.send("agent:update-required", {
    version,
  });
}

function runtimeStatusPayload() {
  const screenshotBlockReason = screenshotCaptureBlockReason();
  return {
    ...runtimeStatus,
    screenshotMonitoringEnabled: runtimeStatus.enrolled && trackingConfig.screenshot_enabled,
    screenshotCaptureActive: screenshotBlockReason === null,
    powerSource: onAcPower ? "ac" : "battery",
    privacyNotice,
  };
}

function configureAutoStart(enabled = runtimeStatus.enrolled) {
  if (process.platform !== "win32" || !app.isPackaged) {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    name: "Khaliduo",
    path: process.execPath,
    args: ["--autostart"],
  });

  const startupSettings = app.getLoginItemSettings({
    path: process.execPath,
    args: ["--autostart"],
  });
  log.info(
    `Windows automatic startup is ${startupSettings.openAtLogin ? "enabled" : "disabled"}${runtimeStatus.enrolled ? " for the enrolled device" : " until enrollment is completed"}`,
  );
}

function setUpdateStatus(
  status: AgentRuntimeStatus["updateStatus"],
  options: { version?: string | null; percent?: number | null } = {},
) {
  runtimeStatus.updateStatus = status;
  if ("version" in options) {
    runtimeStatus.updateVersion = options.version ?? null;
  }
  if ("percent" in options) {
    runtimeStatus.updatePercent = options.percent ?? null;
  }
  rebuildTrayMenu();
}

async function showUpdateMessage(options: Electron.MessageBoxOptions) {
  if (mainWindow) {
    showMainWindow();
    return dialog.showMessageBox(mainWindow, options);
  }
  return dialog.showMessageBox(options);
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) {
      await dialog.showMessageBox({
        type: "info",
        title: "Khaliduo Updates",
        message: "Automatic updates run in the installed Khaliduo app.",
        detail: "The development preview does not install updates.",
      });
    }
    return;
  }
  if (
    isUpdateCheckRunning ||
    runtimeStatus.updateStatus === "downloading" ||
    runtimeStatus.updateStatus === "ready"
  ) {
    return;
  }

  manualUpdateCheckRequested = manual;
  isUpdateCheckRunning = true;
  setUpdateStatus("checking", { percent: null });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setUpdateStatus("error", { percent: null });
    log.error("Khaliduo update check failed", error);
    if (manual) {
      await showUpdateMessage({
        type: "error",
        title: "Khaliduo Updates",
        message: "Khaliduo could not check for updates.",
        detail:
          "Check the internet connection and try again from the notification-area icon.",
      });
    }
  } finally {
    isUpdateCheckRunning = false;
    rebuildTrayMenu();
  }
}

async function finishTrackingBeforeUpdate() {
  recalculateWorkedTime();
  clearRuntimeTimers();
  const sessionId = currentSessionId;
  currentSessionId = null;
  runtimeStatus.sessionStartedAt = null;
  updateDisplaySleepBlocker();

  if (sessionId) {
    try {
      await endSession({
        sessionId,
        activeSeconds: runtimeStatus.activeSeconds,
        idleSeconds: runtimeStatus.idleSeconds,
        reason: "Khaliduo update installation",
      });
    } catch (error) {
      log.warn(
        "Could not close the active work session before installing the update",
        error,
      );
    }
  }
}

async function installDownloadedUpdate() {
  if (runtimeStatus.updateStatus !== "ready" || isInstallingUpdate) {
    return;
  }
  isInstallingUpdate = true;
  setUpdateAttention(false);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (initialUpdateCheckTimer) clearTimeout(initialUpdateCheckTimer);
  await finishTrackingBeforeUpdate();
  isQuitting = true;
  quitNotificationSent = true;
  autoUpdater.quitAndInstall(true, true);
}

function configureAutoUpdater() {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus("checking", { percent: null });
  });
  autoUpdater.on("update-available", (info) => {
    setUpdateStatus("available", { version: info.version, percent: 0 });
    log.info(`Khaliduo update ${info.version} is available`);
    if (process.platform === "win32") {
      tray?.displayBalloon({
        title: "Required Khaliduo update",
        content: `Version ${info.version} is downloading and will be installed automatically.`,
        iconType: "info",
      });
    }
    void showUpdateMessage({
      type: "info",
      title: "Required Khaliduo Update",
      message: `Khaliduo ${info.version} is available.`,
      detail:
        "The required update is downloading now. Khaliduo will ask you to install it as soon as the download finishes.",
      buttons: ["OK"],
      defaultId: 0,
      noLink: true,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    setUpdateStatus("downloading", {
      version: runtimeStatus.updateVersion,
      percent: progress.percent,
    });
  });
  autoUpdater.on("update-not-available", async () => {
    setUpdateStatus("up-to-date", { version: null, percent: null });
    if (manualUpdateCheckRequested) {
      manualUpdateCheckRequested = false;
      await showUpdateMessage({
        type: "info",
        title: "Khaliduo Updates",
        message: "Khaliduo is up to date.",
        detail: `You are using version ${app.getVersion()}.`,
      });
    }
  });
  autoUpdater.on("update-downloaded", async (event) => {
    setUpdateStatus("ready", { version: event.version, percent: 100 });
    if (hasPromptedForDownloadedUpdate) {
      return;
    }
    hasPromptedForDownloadedUpdate = true;
    showRequiredUpdatePrompt(event.version);
  });
  autoUpdater.on("error", (error) => {
    setUpdateStatus("error", { percent: null });
    manualUpdateCheckRequested = false;
    log.error("Khaliduo automatic update error", error);
  });

  initialUpdateCheckTimer = setTimeout(() => void checkForUpdates(), 10_000);
  const configuredInterval = Number.parseInt(
    process.env.UPDATE_CHECK_INTERVAL_MINUTES ?? "15",
    10,
  );
  const updateCheckIntervalMinutes = Number.isFinite(configuredInterval)
    ? Math.max(5, Math.min(1_440, configuredInterval))
    : 15;
  updateCheckTimer = setInterval(
    () => void checkForUpdates(),
    updateCheckIntervalMinutes * 60 * 1000,
  );
  log.info(
    `Khaliduo will check for updates every ${updateCheckIntervalMinutes} minutes`,
  );
}

function wireSystemEvents() {
  onAcPower = !powerMonitor.isOnBatteryPower();
  powerMonitor.on("on-ac", () => {
    onAcPower = true;
    log.info("AC power detected; screenshot capture is eligible");
  });
  powerMonitor.on("on-battery", () => {
    onAcPower = false;
    log.info("Battery power detected; screenshot capture is paused");
  });
  powerMonitor.on("lock-screen", () => {
    recalculateWorkedTime();
    void sendStateEvent("screen_locked", "locked");
    log.info("Windows lock detected");
  });

  powerMonitor.on("unlock-screen", () => {
    lastDurationTickAt = Date.now();
    idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
    void sendStateEvent("screen_unlocked", "active");
    log.info("Windows unlock detected");
  });

  powerMonitor.on("suspend", () => {
    recalculateWorkedTime();
    void sendStateEvent("system_suspended", "sleeping");
    log.info("System suspend detected");
  });

  powerMonitor.on("resume", () => {
    lastDurationTickAt = Date.now();
    idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
    void sendStateEvent("system_resumed", "active");
    log.info("System resume detected");
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => showMainWindow());

app.on("before-quit", (event) => {
  isQuitting = true;
  updateDisplaySleepBlocker();
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (initialUpdateCheckTimer) clearTimeout(initialUpdateCheckTimer);

  if (quitNotificationSent) {
    clearRuntimeTimers();
    return;
  }

  event.preventDefault();
  quitNotificationSent = true;
  recalculateWorkedTime();
  const sessionId = currentSessionId;
  const eventId = randomUUID();
  const endedAt = new Date().toISOString();
  const activeSeconds = runtimeStatus.activeSeconds;
  const idleSeconds = runtimeStatus.idleSeconds;
  clearRuntimeTimers();
  currentSessionId = null;
  runtimeStatus.sessionStartedAt = null;
  runtimeStatus.trackingStatus = "offline";

  const finishSession = sessionId
    ? endSession({
        sessionId,
        activeSeconds,
        idleSeconds,
        reason: "Khaliduo quit",
        endedAt,
        eventId,
      })
    : Promise.resolve();

  void finishSession
    .catch((error) => {
      if (sessionId) {
        enqueuePendingEvent({
          id: eventId,
          method: "POST",
          endpoint: `/agent/sessions/${sessionId}/end`,
          payload: {
            event_id: eventId,
            ended_at: endedAt,
            active_seconds: activeSeconds,
            idle_seconds: idleSeconds,
            reason: "Khaliduo quit",
          },
          idempotencyKey: eventId,
        });
      }
      log.warn("Failed to close the work session before quitting", error);
    })
    .finally(() => {
      app.quit();
    });
});

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.kentconsultancy.khaliduo");
  }
  log.initialize();
  log.info("Khaliduo agent starting");
  await initializeLocalDatabase();
  hydrateIdentityStatus();
  const launchedByWindowsStartup =
    process.argv.includes("--autostart") || process.argv.includes("--hidden");
  loadTrackingPreferences(launchedByWindowsStartup);
  configureAutoStart();
  wireSystemEvents();

  tray = new Tray(
    createTrayImage(runtimeStatus.enrolled ? "#1f7a4d" : "#b7791f"),
  );
  tray.on("click", () => showMainWindow());
  tray.on("double-click", () => showMainWindow());
  rebuildTrayMenu();

  await createMainWindow();
  configureAutoUpdater();
  showMainWindow();
  if (runtimeStatus.enrolled) {
    await refreshTrackingConfig();
    startScreenshotMonitoring();
    if (!trackingPausedByUser) {
      await startTrackingAutomatically();
    }
  }
  rebuildTrayMenu();
});

app.on("window-all-closed", () => undefined);

ipcMain.handle("agent:get-status", () => runtimeStatusPayload());

ipcMain.on("agent:set-idle-alert-attention", (_, active: boolean) => {
  setIdleAlertAttention(Boolean(active));
});

ipcMain.on("agent:set-update-attention", (_, active: boolean) => {
  setUpdateAttention(Boolean(active));
});

ipcMain.handle("agent:check-for-updates", async () => {
  try {
    await checkForUpdates(true);
    return { success: true };
  } catch (error) {
    log.error("Manual update check failed", error);
    return {
      success: false,
      message: getUserFacingError(error, "Could not check for updates."),
    };
  }
});

ipcMain.handle("agent:install-update", async () => {
  try {
    await installDownloadedUpdate();
    return { success: true };
  } catch (error) {
    log.error("Update installation failed", error);
    setUpdateAttention(true);
    return {
      success: false,
      message: getUserFacingError(error, "Could not install the update."),
    };
  }
});

ipcMain.handle(
  "agent:enroll-with-credentials",
  async (_, email: string, password: string) => {
    try {
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        !email.trim() ||
        !password
      ) {
        return { success: false, message: "Email and password are required." };
      }

      const identity = await enrollDeviceWithCredentials(
        email,
        password,
        app.getVersion(),
      );
      await activateEnrolledDevice(identity);
      return { success: true };
    } catch (error) {
      runtimeStatus.trackingStatus = "error";
      tray?.setImage(createTrayImage("#b42318"));
      rebuildTrayMenu();
      log.error("Credential device enrollment failed", {
        message: error instanceof Error ? error.message : "Unknown error",
        code: axios.isAxiosError(error) ? error.code : undefined,
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
      });
      const unavailable =
        axios.isAxiosError(error) &&
        [404, 405, 501].includes(error.response?.status ?? 0);
      return {
        success: false,
        message: unavailable
          ? "Automatic device linking is not enabled on the server yet. Ask an administrator to activate this device, then try again."
          : getUserFacingError(error, "Sign-in and device setup failed."),
      };
    }
  },
);

ipcMain.handle("agent:pause-tracking", (_event, options) =>
  pauseTracking(options),
);

ipcMain.handle("agent:resume-tracking", () => resumeTracking());

ipcMain.handle("agent:logout", () => logoutDevice());

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:toggle-maximize", () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("agent:open-employee-dashboard", async (_, section?: string) => {
  try {
    const { handoff_token: handoffToken } = await createEmployeePortalHandoff();
    const portalUrl = new URL(
      process.env.KHALIDUO_EMPLOYEE_PORTAL_URL ??
        "http://localhost:5174/employee",
    );
    portalUrl.searchParams.set("handoff", handoffToken);
    if (section === "screenshots") {
      portalUrl.searchParams.set("view", "screenshots");
    }
    await shell.openExternal(portalUrl.toString());
    return { success: true };
  } catch (error) {
    log.error("Employee dashboard handoff failed", error);
    return {
      success: false,
      message: getUserFacingError(
        error,
        "The employee dashboard could not be opened.",
      ),
    };
  }
});

ipcMain.handle("agent:get-recent-screenshots", async () => {
  try {
    const screenshots = await listAgentRecentScreenshots(4);
    const data = [];
    for (const screenshot of screenshots) {
      const image = await downloadAgentScreenshot(screenshot.id);
      data.push({
        id: screenshot.id,
        capturedAt: screenshot.captured_at,
        displayName: screenshot.display_name,
        dataUrl: `data:${image.mimeType};base64,${image.content.toString("base64")}`,
      });
    }
    return { success: true, screenshots: data };
  } catch (error) {
    log.error("Recent screenshots could not be loaded", error);
    return {
      success: false,
      message: getUserFacingError(
        error,
        "Recent screenshots could not be loaded.",
      ),
      screenshots: [],
    };
  }
});

ipcMain.handle("agent:set-current-task", async (_, taskId: string | null) => {
  try {
    if (!currentSessionId || !runtimeStatus.enrolled) {
      return { success: false, message: "No active session is available." };
    }
    recalculateWorkedTime();
    await heartbeatTick();
    const result = await updateSessionTask(currentSessionId, taskId);
    await refreshTasks();
    syncRuntimeFromSession(result.session);
    applyWorkdayState(result.workday);
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    rebuildTrayMenu();
    return { success: true, status: runtimeStatusPayload() };
  } catch (error) {
    runtimeStatus.connectionStatus = "offline";
    rebuildTrayMenu();
    log.error("Task selection failed", error);
    return {
      success: false,
      message: getUserFacingError(error, "Task selection failed."),
    };
  }
});

ipcMain.handle(
  "agent:create-task",
  async (_, options: Parameters<typeof createAgentTask>[0]) => {
    try {
      if (!runtimeStatus.enrolled || !currentSessionId) {
        return {
          success: false,
          message: "Start tracking before creating a task.",
        };
      }
      const task = await createAgentTask(options);
      const runtimeTask = mapTask(task);
      runtimeStatus.tasks = [
        runtimeTask,
        ...runtimeStatus.tasks.filter((item) => item.id !== task.id),
      ];
      runtimeStatus.recentTasks = [
        runtimeTask,
        ...runtimeStatus.recentTasks.filter((item) => item.id !== task.id),
      ].slice(0, 3);
      void refreshTasks();
      rebuildTrayMenu();
      return {
        success: true,
        message: `${task.name} was submitted for manager approval.`,
        status: runtimeStatusPayload(),
      };
    } catch (error) {
      log.error("Task creation failed", error);
      return {
        success: false,
        message: getUserFacingError(error, "Task creation failed."),
      };
    }
  },
);

ipcMain.handle(
  "agent:update-task-stage",
  async (_, taskId: string, stage: string, note?: string) => {
    try {
      const task = runtimeStatus.tasks.find((item) => item.id === taskId);
      if (!task?.canUpdateStage) {
        return {
          success: false,
          message: "Only the primary assignee can change this task's status.",
        };
      }
      await updateAgentTaskStage(taskId, stage, note);
      await refreshTasks();
      rebuildTrayMenu();
      return { success: true, status: runtimeStatusPayload() };
    } catch (error) {
      log.error("Task stage update failed", error);
      return {
        success: false,
        message: getUserFacingError(error, "Task stage update failed."),
      };
    }
  },
);

ipcMain.handle(
  "agent:create-task-checklist-item",
  async (_, taskId: string, title: string) => {
    try {
      const task = runtimeStatus.tasks.find((item) => item.id === taskId);
      if (!task?.canUpdateStage) {
        return {
          success: false,
          message: "Only the primary assignee can edit this task checklist.",
        };
      }
      await createAgentTaskChecklistItem(taskId, title);
      await refreshTasks();
      return { success: true, status: runtimeStatusPayload() };
    } catch (error) {
      log.error("Task checklist creation failed", error);
      return {
        success: false,
        message: getUserFacingError(error, "Checklist update failed."),
      };
    }
  },
);

ipcMain.handle(
  "agent:update-task-checklist-item",
  async (_, taskId: string, itemId: string, completed: boolean) => {
    try {
      const task = runtimeStatus.tasks.find((item) => item.id === taskId);
      if (!task?.canUpdateStage) {
        return {
          success: false,
          message: "Only the primary assignee can edit this task checklist.",
        };
      }
      await updateAgentTaskChecklistItem(taskId, itemId, completed);
      await refreshTasks();
      return { success: true, status: runtimeStatusPayload() };
    } catch (error) {
      log.error("Task checklist update failed", error);
      return {
        success: false,
        message: getUserFacingError(error, "Checklist update failed."),
      };
    }
  },
);

ipcMain.handle(
  "agent:create-time-adjustment-request",
  async (
    _,
    input: {
      requestedMinutes: number;
      reason: string;
      requestType?: "idle_time" | "early_leave" | "manual_time";
      requestedDate?: string;
      workSessionId?: string;
      sourceStartAt?: string;
      sourceEndAt?: string;
      requestedLeaveTime?: string;
    },
  ) => {
    try {
      const request = await createTimeAdjustmentRequest(input);
      await refreshTimeAdjustmentRequests();
      await refreshTrackingConfig();
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
      rebuildTrayMenu();
      return { success: true, request, status: runtimeStatusPayload() };
    } catch (error) {
      runtimeStatus.connectionStatus = "offline";
      rebuildTrayMenu();
      log.error("Time adjustment request failed", error);
      return {
        success: false,
        message: getUserFacingError(error, "Time adjustment request failed."),
      };
    }
  },
);

ipcMain.handle(
  "agent:create-leave-request",
  async (
    _,
    input: {
      startDate: string;
      endDate: string;
      leaveType?: "annual" | "sick" | "unpaid";
      reason?: string;
    },
  ) => {
    try {
      const request = await createLeaveRequest({
        startDate: input.startDate,
        endDate: input.endDate,
        leaveType: input.leaveType ?? "annual",
        reason: input.reason,
      });
      await refreshLeaveRequests();
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
      rebuildTrayMenu();
      return { success: true, request, status: runtimeStatusPayload() };
    } catch (error) {
      runtimeStatus.connectionStatus = "offline";
      rebuildTrayMenu();
      log.error("Holiday request failed", error);
      return {
        success: false,
        message: getUserFacingError(error, "Holiday request failed."),
      };
    }
  },
);
