import electronCommon from "electron/common";
import electronMain from "electron/main";
import log from "electron-log/main";
import electronUpdater from "electron-updater";
import dotenv from "dotenv";
import axios from "axios";
import { execFile, fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  enrollDeviceWithCredentials,
  getLocalNetworkInfo,
  endSession,
  getAgentConfig,
  getAgentSummary,
  getCurrentSession,
  completeScreenshot,
  createEmployeePortalHandoff,
  downloadAgentScreenshot,
  createAgentTask,
  createAgentTaskChecklistItem,
  deleteAgentTaskChecklistItem,
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
  resumePaidPause,
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
  getDeviceToken,
  isEnrolled,
  loadIdentity,
} from "./services/identityStore.js";
import type { StoredIdentity } from "./services/identityStore.js";
import {
  appendLocalTrackingEvent,
  checkpointLocalTrackingSession,
  closeLocalTrackingSession,
  createLocalTrackingSession,
  enqueuePendingEvent,
  enqueuePendingScreenshot,
  getDuePendingEvents,
  getDuePendingScreenshots,
  getLocalTrackingEvents,
  getOpenLocalTrackingSession,
  getPendingLocalTrackingSession,
  getPendingLocalTrackingSessions,
  getRecoveryBaseline,
  getServerSessionIdForLocalSession,
  hasPendingEventsForSession,
  initializeLocalDatabase,
  listTerminalPendingScreenshots,
  markLocalTrackingSessionSynced,
  setRecoveryBaseline,
  markPendingEventFailed,
  markPendingEventIgnored,
  markPendingEventPermanentlyRejected,
  markPendingEventUploaded,
  markPendingScreenshotFailed,
  markPendingScreenshotUploaded,
  purgeTerminalPendingEvents,
  purgeTerminalScreenshotRows,
  type LocalTrackingSession,
} from "./services/localDb.js";
import {
  automaticIdleReturnAction,
  hasReachedIdleThreshold,
  IDLE_THRESHOLD_MINUTES,
  idleDurationAfterThreshold,
  idleReturnInputDetected,
  inputResumedAfterIdle,
  reclassifyVerifiedReturnCounters,
  shouldWaitForInputBeforeRestart,
} from "./services/idlePolicy.js";
import { createCoalescedRefresh } from "./services/coalescedRefresh.js";
import { getUserFacingError } from "./services/userFacingError.js";
import { trackingTick } from "./services/trackingTick.js";
import { reconcileTrackingStatusAfterSync } from "./services/trackingStatusReconcile.js";
import {
  physicalResumeShouldResumeWork,
  shouldAccrueTrackedTime,
} from "./services/powerTransitionPolicy.js";
import { captureRemainsEligible } from "./services/screenshotCaptureGuard.js";
import { sessionSnapshotIsApplicable } from "./services/sessionSnapshotGuard.js";
import {
  mergeRecoveredCounters,
  offsetRecoveredEventPayload,
  recoveryResponseCredited,
  restoreOpenLocalTrackingSnapshot,
} from "./services/offlineTracking.js";
import {
  endOfPreviousLocalDayIso,
  recoveryEndTimestampIso,
} from "./services/localDayBoundary.js";
import {
  InputIntegrityMonitor,
  type InputIntegrityObservation,
} from "./services/inputIntegrity.js";
import {
  connectionStatusAfterApiFailure,
  isPermanentScreenshotSyncFailure,
} from "./services/runtimePolicies.js";
import {
  canAdoptPromotedLocalSession,
  isSessionCounterToday,
  promotableLocalSessionIds,
  reconcileWorkedToday,
  resolveSessionCounterSeconds,
  shouldRolloverRestoredLocalSession,
  shouldResetDailyCountersForSession,
} from "./services/dailyCounters.js";
import { requiresExplicitFreshSessionStart } from "./services/trackingStartPolicy.js";
import {
  CRASH_RECOVERY_STABLE_MS,
  crashRecoveryAttempt,
  crashRecoveryShouldContinue,
  isCrashRecoveryLaunch,
} from "./services/crashRecovery.js";
import {
  isWhatsAppScreenshotActivity,
  privacyBlurSampleSize,
} from "./services/screenshotPrivacy.js";
import {
  isAuthPendingEventSyncFailure,
  isPermanentPendingEventSyncFailure,
} from "./services/pendingSyncPolicy.js";
import {
  shouldClearInstallRecoveryOnBeforeQuit,
  UPDATE_INSTALL_RECOVERY_MS,
} from "./services/updateInstallPolicy.js";

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
  employeeEmail: string | null;
  employeeAvatarUrl: string | null;
  deviceName: string;
  deviceId: string | null;
  macAddress: string | null;
  localIpAddress: string | null;
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
  idleRequestPeriods: NonNullable<AgentSummary["idle_request_periods"]>;
  lastIdleAlert: IdleLossAlert | null;
  locallyEndedIdleAt: string | null;
  updateStatus:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
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
  kind: "idle_return" | "tracking_start";
  lostSeconds: number;
  eligibleLostSeconds: number;
  outsideScheduledShift: boolean;
  endedAt: string;
};

type IdleReturnVerification = {
  startedAt: number;
  eventTimestamp: string;
  counterDate: string | null;
  idleSecondsAtStart: number;
  eligibleIdleSecondsAtStart: number;
};

type ForegroundActivity = {
  applicationName: string;
  processName: string;
  siteDomain: string | null;
};

type ForegroundActivitySegment = ForegroundActivity & {
  sessionId: string;
  startedAt: number;
  lastObservedAt: number;
};

const execFileAsync = promisify(execFile);
const FOREGROUND_SAMPLE_INTERVAL_MS = 15_000;
const FOREGROUND_SEGMENT_MAX_MS = 60_000;
const LONG_IDLE_SESSION_SPLIT_SECONDS = 4 * 60 * 60;

let mainWindow: Electron.BrowserWindow | null = null;
let tray: Electron.Tray | null = null;
let isQuitting = false;
let crashRecoveryWatchdog: ChildProcess | null = null;
let crashRecoveryStableTimer: ReturnType<typeof setTimeout> | null = null;
let crashRecoveryRestartTimer: ReturnType<typeof setTimeout> | null = null;
let quitNotificationSent = false;
let currentSessionId: string | null = null;
let localTrackingSessionId: string | null = null;
// Bumped whenever the device identity changes (logout / re-enrollment). An
// in-flight session snapshot captured before the change is discarded so it
// cannot contaminate a newly-enrolled identity's state.
let enrollmentGeneration = 0;
let isPromotingLocalTrackingSessions = false;
let lastLocalTrackingCheckpointAt = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let durationTimer: ReturnType<typeof setInterval> | null = null;
let foregroundActivityTimer: ReturnType<typeof setInterval> | null = null;
let foregroundActivityTickRunning = false;
let foregroundActivitySegment: ForegroundActivitySegment | null = null;
// The most recent foreground-activity flush kicked off by clearRuntimeTimers.
// Its upload posts a foreground_activity event to the same /events endpoint as a
// session End, so shutdown/sign-out finalization must be able to order End behind
// it (and behind any durable row it enqueues on failure) rather than closing the
// session first (F1).
let pendingForegroundActivityFlush: Promise<void> | null = null;
const inputIntegrityMonitor = new InputIntegrityMonitor();
let lastInputProbeStartAttemptAt = 0;
let inputProbeMissingWasLogged = false;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let idleAttentionTimer: ReturnType<typeof setTimeout> | null = null;
let idleAlertAttentionActive = false;
let isFinishingAutomaticIdle = false;
let automaticIdleStartPromise: Promise<boolean> | null = null;
let automaticIdleFinishPromise: Promise<boolean> | null = null;
let manualPauseTransitionPromise: Promise<boolean> | null = null;
let updateAttentionActive = false;
let screenshotTimer: ReturnType<typeof setTimeout> | null = null;
let screenshotQueue: number[] = [];
let screenshotWindowEndsAt: number | null = null;
// Bumped whenever screenshot-capture eligibility is lost (pause, lock, sleep,
// battery, logout, re-enrollment). An in-flight capture snapshots this value and
// aborts if it changes across an await, so a Pause that lands mid-capture — even
// a full pause→resume cycle within one await — cannot yield a new image.
let screenshotCaptureGeneration = 0;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let pendingQueueSyncPromise: Promise<void> | null = null;
let automaticTrackingRetryTimer: ReturnType<typeof setTimeout> | null = null;
let trackingWatchdogTimer: ReturnType<typeof setInterval> | null = null;
let isStartingTrackingAutomatically = false;
let idleSecondsBeforeCurrentIdle = 0;
let eligibleIdleSecondsBeforeCurrentIdle = 0;
let idleWallClockStartedAt: number | null = null;
let automaticIdleStartedDuringBreak = false;
let lastObservedSystemIdleSeconds: number | null = null;
let lastObservedOperatingSystemIdleSeconds: number | null = null;
let lastHandledIdleReturnInputAt = 0;
let idleReturnVerification: IdleReturnVerification | null = null;
let waitingForInputAfterIdleSessionClose = false;
let freshSessionStartConfirmed = false;
let freshSessionStartPromptActive = false;
let lastDurationTickAt: number | null = null;
let workedTodayBaseSeconds = 0;
let activeCounterDate: string | null = null;
let trackingPausedByUser = false;
let unpaidPauseActive = false;
let isHandlingWindowClose = false;
let hasShownMinimizeBalloon = false;
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
let initialUpdateCheckTimer: ReturnType<typeof setTimeout> | null = null;
let updateRetryTimer: ReturnType<typeof setTimeout> | null = null;
let updateInstallRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let manualUpdateCheckRequested = false;
let isUpdateCheckRunning = false;
let isInstallingUpdate = false;
let consecutiveUpdateFailures = 0;
let lastFullSummaryRefreshAt = 0;
let lastMetadataRefreshAt = 0;
let isRefreshingTrackingConfig = false;
let isRefreshingTasks = false;
let isRefreshingTimeAdjustments = false;
let isRefreshingLeaveRequests = false;
let paidPauseTimer: ReturnType<typeof setTimeout> | null = null;
let displaySleepBlockerId: number | null = null;
let onAcPower = true;
// Physical screen-lock / system-sleep state, tracked independently of the
// employee's work-intent status. A deliberately stopped or paused session leaves
// trackingStatus at "paused" across a lock/unlock cycle, so screenshot
// eligibility and displayed state must consult these physical flags — not the
// work status — to know whether the machine is actually locked or asleep (D5).
let screenLocked = false;
let systemSleeping = false;
// True from the synchronous start of sign-out until the runtime has been reset.
// Sign-out is local-first: accrual and screenshot acquisition stop immediately,
// before any network flush is awaited, and this gate keeps capture blocked while
// the enrolled-but-stopped screenshot policy would otherwise still apply (D6).
let isSigningOut = false;
// Exclusive ownership of the credential-enrollment operation, kept DISTINCT from
// the identity `enrollmentGeneration` (which activation itself increments). A
// unique token is reserved synchronously at the IPC entry and released when the
// operation completes; only the reserving operation may persist, activate and
// report success, so two overlapping enrollments cannot both write credentials
// before either activates (I1).
let enrollmentOperationSeq = 0;
let activeEnrollmentToken: number | null = null;
// A durable finalization End is written to the pending-events outbox BEFORE its
// in-flight predecessors are awaited, so it survives a process kill during that
// wait (O1). Enqueuing it with this sentinel created_at makes it sort LAST within
// its session group (delivery is ordered by created_at asc), so a kill-then-restart
// still replays predecessor evidence first and closes the session with End last —
// preserving causal order without the naive "insert End earlier" inversion.
const FINALIZATION_ORDER_SENTINEL = "9999-12-31T23:59:59.999Z";
// Upper bound on the ENTIRE shutdown finalization (all predecessor + foreground +
// queue-flush waits together), not each request. Because the final End is made
// durable BEFORE those waits (O1), exceeding this deadline is safe: the process
// can exit and next-launch queue replay delivers End in causal order. Without the
// bound, a hung predecessor or stalled sync could keep the app from ever quitting.
const SHUTDOWN_FINALIZATION_DEADLINE_MS = 15_000;
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
  employeeEmail: null,
  employeeAvatarUrl: null,
  deviceName: process.env.COMPUTERNAME ?? "Windows device",
  deviceId: null,
  macAddress: null,
  localIpAddress: null,
  trackingStatus: "starting",
  trackingPaused: false,
  sessionStartedAt: null,
  workedTodaySeconds: 0,
  activeSeconds: 0,
  idleSeconds: 0,
  eligibleIdleSeconds: 0,
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
  idleRequestPeriods: [],
  lastIdleAlert: null,
  locallyEndedIdleAt: null,
  updateStatus: "idle",
  updateVersion: null,
  updatePercent: null,
};

const privacyNotice =
  "While work tracking is active, Khaliduo records the foreground application name and, for supported browsers, the website domain. Company policy may also capture periodic workplace screenshots while this enrolled device is active, unlocked, and connected to AC power. To protect attendance integrity, the Windows agent counts real versus software-injected input events; it never records keys, typed text, click coordinates, passwords, webcam, microphone, full URLs, or personal files.";

const FOREGROUND_WINDOW_POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KhaliduoForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@ -ErrorAction SilentlyContinue

$handle = [KhaliduoForegroundWindow]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) {
  [PSCustomObject]@{ processName = $null; url = $null } | ConvertTo-Json -Compress
  exit 0
}

$processId = [uint32]0
[void][KhaliduoForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
$processInfo = Get-Process -Id $processId -ErrorAction Stop
$processName = $processInfo.ProcessName.ToLowerInvariant()
$url = $null
$browserProcesses = @('chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi')

if ($browserProcesses -contains $processName) {
  try {
    Add-Type -AssemblyName UIAutomationClient
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $rootBounds = $root.Current.BoundingRectangle
    $editCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
    $edits = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      $editCondition
    )
    foreach ($element in $edits) {
      try {
        $rectangle = $element.Current.BoundingRectangle
        if ($rectangle.Top -gt ($rootBounds.Top + 240)) { continue }
        $pattern = $element.GetCurrentPattern(
          [System.Windows.Automation.ValuePattern]::Pattern
        )
        $candidate = $pattern.Current.Value.Trim()
        if (
          $candidate -match '^(https?://|[a-z0-9][a-z0-9.-]+\.[a-z]{2,}([/:]|$))'
        ) {
          $url = $candidate
          break
        }
      } catch {
        continue
      }
    }
  } catch {
    $url = $null
  }
}

[PSCustomObject]@{ processName = $processName; url = $url } | ConvertTo-Json -Compress
`;

dotenv.config({
  path: app.isPackaged
    ? path.join(process.resourcesPath, "khaliduo-runtime.env")
    : path.join(app.getAppPath(), ".env"),
});

function normalizeTrackingConfig(config: TrackingConfig): TrackingConfig {
  return {
    ...config,
    idle_threshold_minutes: IDLE_THRESHOLD_MINUTES,
    screenshot_interval_minutes: Math.max(
      1,
      Math.min(240, config.screenshot_interval_minutes ?? 10),
    ),
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

type ApiErrorPayload = {
  error?: { code?: string; message?: string };
  detail?: string;
};

function apiResponseStatus(error: unknown) {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

function apiErrorCode(error: unknown) {
  if (!axios.isAxiosError(error)) return undefined;
  return (error.response?.data as ApiErrorPayload | undefined)?.error?.code;
}

/** Keep credentials and request headers out of persistent desktop logs. */
function safeErrorForLog(error: unknown) {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as ApiErrorPayload | undefined;
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      status: error.response?.status,
      apiCode: payload?.error?.code,
      apiMessage: payload?.error?.message ?? payload?.detail,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

function isDeviceIdentityMismatch(error: unknown) {
  if (!axios.isAxiosError(error) || error.response?.status !== 401) {
    return false;
  }
  const data = error.response.data as
    { error?: { message?: string }; detail?: string } | undefined;
  const message = String(
    data?.error?.message ?? data?.detail ?? "",
  ).toLowerCase();
  return message.includes("device token identity does not match");
}

// Single source of truth for clearing every employee/session-specific field of
// runtimeStatus back to its signed-out defaults. Both sign-out and re-enrollment
// reset paths use it so no personal field (leave requests, recent tasks, request
// policy, avatar, summary, counters, ...) can survive by being forgotten in one
// hand-maintained object but not the other (D4). Deliberately device-global
// settings (e.g. dailyTargetSeconds default, screenshot monitoring toggle) are
// intentionally not cleared here.
function clearedPersonalRuntimeStatus(): Partial<AgentRuntimeStatus> {
  return {
    enrolled: false,
    employeeName: "Not enrolled",
    employeeEmail: null,
    employeeAvatarUrl: null,
    deviceName: process.env.COMPUTERNAME ?? "Windows device",
    deviceId: null,
    macAddress: null,
    localIpAddress: null,
    trackingStatus: "starting",
    trackingPaused: false,
    sessionStartedAt: null,
    workedTodaySeconds: 0,
    activeSeconds: 0,
    idleSeconds: 0,
    eligibleIdleSeconds: 0,
    connectionStatus: "offline",
    lastScreenshotAt: null,
    lastSuccessfulSyncAt: null,
    tasks: [],
    projects: [],
    selectedTask: null,
    recentTasks: [],
    timeAdjustmentRequests: [],
    leaveRequests: null,
    requestPolicy: null,
    timeSummary: null,
    todayTimeline: null,
    idleRequestPeriods: [],
    lastIdleAlert: null,
    locallyEndedIdleAt: null,
    activityPercent: 0,
    normalSeconds: 0,
    extraSeconds: 0,
    overtimeEnabled: false,
    extraTimeStatus: "none",
    dailyTargetProgressPercent: 0,
    paidPauseEndsAt: null,
    paidPauseRemainingSeconds: 0,
    paidPauseBalanceRemainingSeconds: null,
  } satisfies Partial<AgentRuntimeStatus>;
}

function resetForDeviceReenrollment() {
  // Keep pending local screenshots/events on disk. They can be retried after
  // the employee signs in again; only the invalid local credential is cleared.
  recalculateWorkedTime();
  invalidateInFlightScreenshotCaptures();
  closeActiveLocalTrackingSession(
    new Date().toISOString(),
    "device_identity_mismatch",
  );
  clearRuntimeTimers();
  inputIntegrityMonitor.stop();
  clearEnrollmentIdentity();
  enrollmentGeneration += 1;
  configureAutoStart(false);
  trackingPausedByUser = false;
  unpaidPauseActive = false;
  currentSessionId = null;
  workedTodayBaseSeconds = 0;
  activeCounterDate = null;
  idleSecondsBeforeCurrentIdle = 0;
  eligibleIdleSecondsBeforeCurrentIdle = 0;
  idleWallClockStartedAt = null;
  automaticIdleStartedDuringBreak = false;
  automaticIdleStartPromise = null;
  automaticIdleFinishPromise = null;
  manualPauseTransitionPromise = null;
  isFinishingAutomaticIdle = false;
  lastObservedSystemIdleSeconds = null;
  lastObservedOperatingSystemIdleSeconds = null;
  lastHandledIdleReturnInputAt = 0;
  clearIdleReturnVerification();
  waitingForInputAfterIdleSessionClose = false;
  freshSessionStartConfirmed = false;
  freshSessionStartPromptActive = false;
  Object.assign(runtimeStatus, clearedPersonalRuntimeStatus());
  tray?.setImage(createTrayImage("#b7791f"));
  rebuildTrayMenu();
  showMainWindow({ forceForeground: true });
  notifyRendererStatus();
}

function hydrateIdentityStatus() {
  const identity = loadIdentity();
  runtimeStatus.enrolled = isEnrolled(identity);
  runtimeStatus.employeeName = identity.employeeName ?? "Not enrolled";
  runtimeStatus.employeeEmail = identity.employeeEmail ?? null;
  runtimeStatus.deviceName =
    identity.deviceName ?? process.env.COMPUTERNAME ?? "Windows device";
  runtimeStatus.deviceId = identity.deviceId ?? null;
  const network = getLocalNetworkInfo();
  runtimeStatus.macAddress = network.macAddress;
  runtimeStatus.localIpAddress = network.ipAddress;
}

async function activateEnrolledDevice(identity: StoredIdentity) {
  // If a sign-out is still draining (e.g. an enrollment response that started
  // before logout is only now resolving), adopting here would let that logout's
  // teardown finally erase this identity — and clearing isSigningOut would
  // reopen work/capture admission mid-teardown. Do not adopt over, or clear,
  // another operation's teardown gate (G2). The IPC entry already rejects
  // enrollments that begin during sign-out; this guards the in-flight response.
  if (isSigningOut) {
    return;
  }
  enrollmentGeneration += 1;
  const activationGeneration = enrollmentGeneration;
  isSigningOut = false;
  runtimeStatus.enrolled = true;
  runtimeStatus.employeeName = identity.employeeName ?? "Enrolled employee";
  runtimeStatus.employeeEmail = identity.employeeEmail ?? null;
  runtimeStatus.deviceName = identity.deviceName ?? runtimeStatus.deviceName;
  runtimeStatus.deviceId = identity.deviceId ?? null;
  const network = getLocalNetworkInfo();
  runtimeStatus.macAddress = network.macAddress;
  runtimeStatus.localIpAddress = network.ipAddress;
  runtimeStatus.trackingStatus = "active";
  runtimeStatus.connectionStatus = "online";
  trackingPausedByUser = false;
  unpaidPauseActive = false;
  runtimeStatus.trackingPaused = false;
  saveTrackingPreferences();
  configureAutoStart(true);
  tray?.setImage(createTrayImage("#1f7a4d"));
  await startTrackingAutomatically();
  // A logout / re-enrollment during any of these awaits invalidates this
  // activation. Stop applying its refresh chain rather than repopulating a
  // now-signed-out or newer identity's runtime (D2).
  if (enrollmentGeneration !== activationGeneration || !runtimeStatus.enrolled) {
    return;
  }
  await refreshTasks();
  if (enrollmentGeneration !== activationGeneration || !runtimeStatus.enrolled) {
    return;
  }
  await refreshTimeAdjustmentRequests();
  if (enrollmentGeneration !== activationGeneration || !runtimeStatus.enrolled) {
    return;
  }
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
    hasTrackingSession() &&
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
  if (
    !shouldKeepDisplayAwake &&
    blockerIsRunning &&
    displaySleepBlockerId !== null
  ) {
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

  const trackingActive =
    hasTrackingSession() &&
    !trackingPausedByUser &&
    !runtimeStatus.trackingPaused;
  const normalTodaySeconds = Math.min(
    runtimeStatus.dailyTargetSeconds,
    runtimeStatus.normalSeconds +
      (runtimeStatus.timeSummary?.today.manual_approved_seconds ?? 0),
  );
  const updateLabel =
    runtimeStatus.updateStatus === "installing"
      ? `Installing update ${runtimeStatus.updateVersion ?? ""}`.trim()
      : runtimeStatus.updateStatus === "ready"
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
      label: `Normal Today: ${formatDuration(normalTodaySeconds)}`,
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
      label: runtimeStatus.screenshotCaptureActive
        ? "Screenshots: Active"
        : "Screenshots: Waiting for next capture",
      enabled: false,
    },
    { type: "separator" },
    { label: "Open Khaliduo", click: () => showMainWindow() },
    runtimeStatus.enrolled
      ? trackingActive
        ? {
            label: "Pause",
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
          enabled:
            !isUpdateCheckRunning &&
            !["available", "downloading", "installing"].includes(
              runtimeStatus.updateStatus,
            ),
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
      unpaid_pause_active?: boolean;
      request_policy?: RequestPolicy | null;
    };
    trackingPausedByUser =
      !resumeForWindowsStartup && preferences.paused_by_user === true;
    unpaidPauseActive =
      !resumeForWindowsStartup && preferences.unpaid_pause_active === true;
    runtimeStatus.requestPolicy = preferences.request_policy ?? null;
  } catch {
    trackingPausedByUser = false;
    unpaidPauseActive = false;
  }
  runtimeStatus.trackingPaused = trackingPausedByUser || unpaidPauseActive;
  if (resumeForWindowsStartup) {
    saveTrackingPreferences();
  }
  if ((trackingPausedByUser || unpaidPauseActive) && runtimeStatus.enrolled) {
    runtimeStatus.trackingStatus = "paused";
  }
}

function loadLaunchTrackingPreferences(options: {
  launchedByWindowsStartup: boolean;
  launchedForCrashRecovery: boolean;
}): boolean {
  // Only a Windows-login (autostart) launch resets a saved Pause/Stop so the
  // employee begins the day tracking. A crash-recovery relaunch must load the
  // saved intent verbatim — passing crash recovery here would wipe an explicit
  // Stop/Pause and let the watchdog silently resume work the employee had ended.
  loadTrackingPreferences(options.launchedByWindowsStartup);
  if (!options.launchedForCrashRecovery) {
    return true;
  }
  return crashRecoveryShouldContinue({
    enrolled: runtimeStatus.enrolled,
    hasDeviceId: Boolean(runtimeStatus.deviceId),
    trackingStoppedByUser: trackingPausedByUser,
  });
}

function saveTrackingPreferences() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(
    getTrackingPreferencesPath(),
    JSON.stringify(
      {
        paused_by_user: trackingPausedByUser,
        unpaid_pause_active: unpaidPauseActive,
        request_policy: runtimeStatus.requestPolicy,
      },
      null,
      2,
    ),
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

function currentTimezone() {
  return (
    runtimeStatus.requestPolicy?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC"
  );
}

function localDateKey(at = new Date()) {
  const timezone = currentTimezone();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function inputProbeExecutablePath() {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        "input-integrity",
        "KhaliduoInputProbe.exe",
      )
    : path.join(app.getAppPath(), "native-bin", "KhaliduoInputProbe.exe");
}

function startInputIntegrityMonitoring() {
  if (process.platform !== "win32" || inputIntegrityMonitor.running) {
    return;
  }
  const now = Date.now();
  if (now - lastInputProbeStartAttemptAt < 30_000) {
    return;
  }
  lastInputProbeStartAttemptAt = now;
  const executablePath = inputProbeExecutablePath();
  if (!fs.existsSync(executablePath)) {
    if (!inputProbeMissingWasLogged) {
      inputProbeMissingWasLogged = true;
      log.warn("Input-integrity probe is unavailable", { executablePath });
    }
    return;
  }
  if (
    !inputIntegrityMonitor.start(
      executablePath,
      powerMonitor.getSystemIdleTime(),
    )
  ) {
    log.warn("Input-integrity probe could not be started");
  }
}

function observedIdleSeconds(
  systemIdleSeconds = powerMonitor.getSystemIdleTime(),
) {
  startInputIntegrityMonitoring();
  return inputIntegrityMonitor.idleSeconds(systemIdleSeconds);
}

function inputIntegrityObservation(): InputIntegrityObservation | undefined {
  if (process.platform !== "win32") return undefined;
  startInputIntegrityMonitoring();
  return inputIntegrityMonitor.takeObservation();
}

function hasTrackingSession() {
  return Boolean(currentSessionId || localTrackingSessionId);
}

function heartbeatStatus(
  status: string,
): "active" | "idle" | "locked" | "offline" | "sleeping" {
  return ["idle", "locked", "offline", "sleeping"].includes(status)
    ? (status as "idle" | "locked" | "offline" | "sleeping")
    : "active";
}

function checkpointActiveLocalTrackingSession(force = false) {
  if (!localTrackingSessionId) {
    return;
  }
  const now = Date.now();
  if (!force && now - lastLocalTrackingCheckpointAt < 5_000) {
    return;
  }
  lastLocalTrackingCheckpointAt = now;
  checkpointLocalTrackingSession({
    sessionId: localTrackingSessionId,
    status: runtimeStatus.trackingStatus,
    activeSeconds: runtimeStatus.activeSeconds,
    idleSeconds: runtimeStatus.idleSeconds,
    checkpointAt: new Date(now).toISOString(),
  });
}

function closeActiveLocalTrackingSession(
  endedAt = new Date().toISOString(),
  status = "ended",
) {
  const sessionId = localTrackingSessionId;
  if (!sessionId) {
    return;
  }
  checkpointActiveLocalTrackingSession(true);
  closeLocalTrackingSession({
    sessionId,
    endedAt,
    status,
    activeSeconds: runtimeStatus.activeSeconds,
    idleSeconds: runtimeStatus.idleSeconds,
  });
  localTrackingSessionId = null;
  lastLocalTrackingCheckpointAt = 0;
}

function beginLocalTrackingSession(startedAt = new Date()) {
  if (
    currentSessionId ||
    localTrackingSessionId ||
    !runtimeStatus.enrolled ||
    !runtimeStatus.deviceId ||
    trackingPausedByUser ||
    unpaidPauseActive ||
    isQuitting
  ) {
    return false;
  }

  const staleOpen = getOpenLocalTrackingSession(runtimeStatus.deviceId);
  if (staleOpen) {
    const restored = restoreOpenLocalTrackingSnapshot(staleOpen, startedAt);
    const checkpointCounterDate = localDateKey(
      new Date(restored.lastCheckpointAt),
    );
    const todayCounterDate = localDateKey(startedAt);
    if (
      shouldRolloverRestoredLocalSession({
        checkpointCounterDate,
        todayCounterDate,
      })
    ) {
      // A previous-day local session has no evidence after its last durable
      // checkpoint. Bound it there before starting today so historical replay
      // can never temporarily own today's live timer.
      closeLocalTrackingSession({
        sessionId: staleOpen.sessionId,
        endedAt: restored.lastCheckpointAt,
        status: "daily_rollover",
        activeSeconds: restored.activeSeconds,
        idleSeconds: restored.idleSeconds,
      });
      log.info("Previous-day local session bounded at its checkpoint", {
        localSessionId: staleOpen.sessionId,
        startedAt: restored.startedAt,
        endedAt: restored.lastCheckpointAt,
      });
    } else {
      localTrackingSessionId = staleOpen.sessionId;
      lastLocalTrackingCheckpointAt = startedAt.getTime();
      activeCounterDate = checkpointCounterDate;
      runtimeStatus.sessionStartedAt = restored.startedAt;
      runtimeStatus.activeSeconds = restored.activeSeconds;
      runtimeStatus.idleSeconds = restored.idleSeconds;
      runtimeStatus.eligibleIdleSeconds = restored.idleSeconds;
      runtimeStatus.workedTodaySeconds = Math.max(
        runtimeStatus.workedTodaySeconds,
        workedTodayBaseSeconds + restored.activeSeconds,
      );
      runtimeStatus.trackingStatus = restored.status;
      runtimeStatus.trackingPaused = false;
      lastDurationTickAt = startedAt.getTime();
      startTimers();
      startScreenshotMonitoring();
      notifyRendererStatus();
      rebuildTrayMenu();
      log.info("Open local tracking session resumed after app restart", {
        localSessionId: staleOpen.sessionId,
        startedAt: restored.startedAt,
        lastCheckpointAt: restored.lastCheckpointAt,
      });
      return true;
    }
  }

  const preservedWorkedToday = runtimeStatus.workedTodaySeconds;
  const localSessionId = randomUUID();
  const startedAtIso = startedAt.toISOString();
  createLocalTrackingSession({
    sessionId: localSessionId,
    deviceId: runtimeStatus.deviceId,
    startedAt: startedAtIso,
    status: "active",
  });
  localTrackingSessionId = localSessionId;
  lastLocalTrackingCheckpointAt = startedAt.getTime();
  activeCounterDate = localDateKey(startedAt);
  workedTodayBaseSeconds = Math.max(
    workedTodayBaseSeconds,
    preservedWorkedToday,
  );
  runtimeStatus.sessionStartedAt = startedAtIso;
  runtimeStatus.activeSeconds = 0;
  runtimeStatus.idleSeconds = 0;
  runtimeStatus.eligibleIdleSeconds = 0;
  runtimeStatus.trackingStatus = "active";
  runtimeStatus.trackingPaused = false;
  lastDurationTickAt = startedAt.getTime();
  startTimers();
  startScreenshotMonitoring();
  notifyRendererStatus();
  rebuildTrayMenu();
  log.info("Local tracking session started before API recovery", {
    localSessionId,
    startedAt: startedAtIso,
  });
  return true;
}

async function replayLocalTrackingEvents(
  localSession: LocalTrackingSession,
  serverSessionId: string,
  serverIdleSeconds: number,
  deliveredIds = new Set<string>(),
) {
  while (true) {
    const pending = getLocalTrackingEvents(localSession.sessionId).filter(
      (event) => !deliveredIds.has(event.id),
    );
    if (pending.length === 0) {
      return deliveredIds;
    }
    for (const event of pending) {
      const payload = offsetRecoveredEventPayload(
        JSON.parse(event.payloadJson) as Record<string, unknown>,
        serverIdleSeconds,
      );
      await sendActivityEvent({
        sessionId: serverSessionId,
        eventId: event.id,
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp,
        payload,
      });
      deliveredIds.add(event.id);
    }
  }
}

async function promotePendingLocalTrackingSessions(
  options: { hasOpenServerSession?: boolean } = {},
) {
  if (
    !runtimeStatus.enrolled ||
    !runtimeStatus.deviceId ||
    isPromotingLocalTrackingSessions
  ) {
    return false;
  }
  checkpointActiveLocalTrackingSession(true);
  const allPendingSessions = getPendingLocalTrackingSessions(
    runtimeStatus.deviceId,
  );
  if (allPendingSessions.length === 0) {
    return false;
  }
  const promotableIds = new Set(
    promotableLocalSessionIds({
      pendingSessions: allPendingSessions,
      activeLocalSessionId: localTrackingSessionId,
      hasOpenServerSession:
        options.hasOpenServerSession ?? Boolean(currentSessionId),
    }),
  );
  const pendingSessions = allPendingSessions.filter((session) =>
    promotableIds.has(session.sessionId),
  );
  if (pendingSessions.length === 0) {
    log.info(
      "Deferred closed local-session recovery while a server session is running",
      { count: allPendingSessions.length },
    );
    return false;
  }

  isPromotingLocalTrackingSessions = true;
  try {
    for (const pendingSession of pendingSessions) {
      const started = await startSession({
        startedAt: pendingSession.startedAt,
        offlineRecovery: true,
        offlineRecoveryId: pendingSession.sessionId,
      });
      const serverSessionId = started.session.id;
      if (pendingSession.endedAt && started.session.ended_at) {
        markLocalTrackingSessionSynced(
          pendingSession.sessionId,
          undefined,
          serverSessionId,
        );
        continue;
      }
      // Idempotency: capture the server session's counters the FIRST time this
      // local session is promoted and reuse that durable baseline on every
      // retry. Re-reading the live server counters (which already include a
      // previous attempt's heartbeat) and adding the full local record again was
      // what doubled recovered work. The backend heartbeat is monotonic/absolute,
      // so submitting `baseline + local` repeatedly converges to one total, while
      // genuine pre-existing *server* work in the baseline is still preserved
      // additively. If the baseline was persisted before but a later step failed,
      // getRecoveryBaseline returns it; otherwise we capture and persist it now,
      // before any heartbeat runs.
      let serverCounters = getRecoveryBaseline(pendingSession.sessionId);
      if (!serverCounters) {
        serverCounters = {
          activeSeconds: started.session.active_seconds,
          idleSeconds: started.session.idle_seconds,
        };
        setRecoveryBaseline(pendingSession.sessionId, serverCounters);
      }
      const deliveredLocalEventIds = await replayLocalTrackingEvents(
        pendingSession,
        serverSessionId,
        serverCounters.idleSeconds,
      );
      let latestPendingSession =
        getPendingLocalTrackingSession(pendingSession.sessionId) ??
        pendingSession;
      let ownsLiveRuntime = canAdoptPromotedLocalSession({
        promotedSessionId: pendingSession.sessionId,
        activeLocalSessionId: localTrackingSessionId,
      });
      if (!ownsLiveRuntime && !latestPendingSession.endedAt) {
        // The active local ID changed while network replay was in flight (most
        // commonly at midnight). Bound the detached session at its own last
        // checkpoint; never let it clear or borrow counters from the new day.
        closeLocalTrackingSession({
          sessionId: latestPendingSession.sessionId,
          endedAt: latestPendingSession.lastCheckpointAt,
          status: "daily_rollover",
          activeSeconds: latestPendingSession.activeSeconds,
          idleSeconds: latestPendingSession.idleSeconds,
        });
        latestPendingSession = {
          ...latestPendingSession,
          endedAt: latestPendingSession.lastCheckpointAt,
          status: "daily_rollover",
        };
      }
      const recovered = mergeRecoveredCounters(serverCounters, {
        activeSeconds: ownsLiveRuntime
          ? runtimeStatus.activeSeconds
          : latestPendingSession.activeSeconds,
        idleSeconds: ownsLiveRuntime
          ? runtimeStatus.idleSeconds
          : latestPendingSession.idleSeconds,
      });
      const heartbeatAt =
        latestPendingSession.endedAt ??
        latestPendingSession.lastCheckpointAt ??
        new Date().toISOString();
      const heartbeat = await sendHeartbeat({
        sessionId: serverSessionId,
        eventId: randomUUID(),
        status: heartbeatStatus(latestPendingSession.status),
        activeSeconds: recovered.activeSeconds,
        idleSeconds: recovered.idleSeconds,
        counterDate: localDateKey(new Date(heartbeatAt)),
        agentVersion: runtimeStatus.agentVersion,
        timestamp: heartbeatAt,
      });

      if (latestPendingSession.endedAt) {
        if (
          !recoveryResponseCredited(
            heartbeat as { restarted?: boolean; ignored?: boolean },
          )
        ) {
          // The server rolled this historical session over or ignored the
          // evidence, so the counters were NOT credited to it. Do not end or
          // retire the local row — leave it for a later pass rather than marking
          // unverified work as synchronized (which is how midnight work was
          // silently lost).
          log.warn(
            "Historical recovery was not credited to its session; will retry",
            {
              localSessionId: pendingSession.sessionId,
              heartbeatAt,
            },
          );
          continue;
        }
        await endSession({
          sessionId: serverSessionId,
          activeSeconds: recovered.activeSeconds,
          idleSeconds: recovered.idleSeconds,
          reason: "Recovered from offline device storage",
          // The heartbeat above stayed inside the previous day; the END is bounded
          // to the day boundary so a midnight-rollover session credits its final
          // whole second instead of losing it to the integer wall-clock cap.
          endedAt: recoveryEndTimestampIso(
            latestPendingSession.endedAt,
            currentTimezone(),
          ),
          eventId: randomUUID(),
        });
        markLocalTrackingSessionSynced(pendingSession.sessionId, undefined, serverSessionId);
        continue;
      }

      // A lock/idle transition may have been recorded locally while the
      // recovery heartbeat was in flight. Replay once more before atomically
      // switching this live session from local storage to the server ID.
      await replayLocalTrackingEvents(
        pendingSession,
        serverSessionId,
        serverCounters.idleSeconds,
        deliveredLocalEventIds,
      );
      ownsLiveRuntime = canAdoptPromotedLocalSession({
        promotedSessionId: pendingSession.sessionId,
        activeLocalSessionId: localTrackingSessionId,
      });
      if (!ownsLiveRuntime) {
        latestPendingSession =
          getPendingLocalTrackingSession(pendingSession.sessionId) ??
          latestPendingSession;
        const detachedEndAt =
          latestPendingSession.endedAt ?? latestPendingSession.lastCheckpointAt;
        if (!latestPendingSession.endedAt) {
          closeLocalTrackingSession({
            sessionId: latestPendingSession.sessionId,
            endedAt: detachedEndAt,
            status: "daily_rollover",
            activeSeconds: latestPendingSession.activeSeconds,
            idleSeconds: latestPendingSession.idleSeconds,
          });
        }
        const detachedCounters = mergeRecoveredCounters(serverCounters, {
          activeSeconds: latestPendingSession.activeSeconds,
          idleSeconds: latestPendingSession.idleSeconds,
        });
        await sendHeartbeat({
          sessionId: serverSessionId,
          eventId: randomUUID(),
          status: heartbeatStatus(latestPendingSession.status),
          activeSeconds: detachedCounters.activeSeconds,
          idleSeconds: detachedCounters.idleSeconds,
          counterDate: localDateKey(new Date(detachedEndAt)),
          agentVersion: runtimeStatus.agentVersion,
          timestamp: detachedEndAt,
        });
        await endSession({
          sessionId: serverSessionId,
          activeSeconds: detachedCounters.activeSeconds,
          idleSeconds: detachedCounters.idleSeconds,
          reason: "Recovered from offline device storage",
          // The heartbeat above kept detachedEndAt inside its day; the END is
          // bounded to the day boundary so a midnight rollover credits its final
          // whole second (no-op for a mid-day checkpoint bound).
          endedAt: recoveryEndTimestampIso(detachedEndAt, currentTimezone()),
          eventId: randomUUID(),
        });
        markLocalTrackingSessionSynced(pendingSession.sessionId, undefined, serverSessionId);
        continue;
      }
      const latestLocalActiveSeconds = runtimeStatus.activeSeconds;
      const latestLocalIdleSeconds = runtimeStatus.idleSeconds;
      const latestStatus = runtimeStatus.trackingStatus;
      const latestRecovered = mergeRecoveredCounters(serverCounters, {
        activeSeconds: latestLocalActiveSeconds,
        idleSeconds: latestLocalIdleSeconds,
      });
      const finalHeartbeat =
        latestRecovered.activeSeconds !== recovered.activeSeconds ||
        latestRecovered.idleSeconds !== recovered.idleSeconds ||
        latestStatus !== latestPendingSession.status
          ? await sendHeartbeat({
              sessionId: serverSessionId,
              eventId: randomUUID(),
              status: heartbeatStatus(latestStatus),
              activeSeconds: latestRecovered.activeSeconds,
              idleSeconds: latestRecovered.idleSeconds,
              counterDate: localDateKey(),
              agentVersion: runtimeStatus.agentVersion,
            })
          : heartbeat;
      if (localTrackingSessionId !== pendingSession.sessionId) {
        // The final heartbeat crossed a rollover. Leave the newer local ID
        // untouched; the next promotion pass will safely finish this row.
        continue;
      }
      localTrackingSessionId = null;
      lastLocalTrackingCheckpointAt = 0;
      syncRuntimeFromSession(finalHeartbeat.session);
      runtimeStatus.activeSeconds = Math.max(
        runtimeStatus.activeSeconds,
        latestRecovered.activeSeconds,
      );
      runtimeStatus.idleSeconds = Math.max(
        runtimeStatus.idleSeconds,
        latestRecovered.idleSeconds,
      );
      runtimeStatus.eligibleIdleSeconds = Math.max(
        runtimeStatus.eligibleIdleSeconds,
        latestRecovered.idleSeconds,
      );
      runtimeStatus.trackingStatus = latestStatus;
      runtimeStatus.workedTodaySeconds =
        workedTodayBaseSeconds + runtimeStatus.activeSeconds;
      markLocalTrackingSessionSynced(pendingSession.sessionId, undefined, serverSessionId);
    }
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    log.info("Local tracking sessions synchronized with the API", {
      count: pendingSessions.length,
    });
    return true;
  } finally {
    isPromotingLocalTrackingSessions = false;
  }
}

function resetDailyRuntimeCounters(nextCounterDate: string, now = new Date()) {
  activeCounterDate = nextCounterDate;
  workedTodayBaseSeconds = 0;
  runtimeStatus.activeSeconds = 0;
  runtimeStatus.idleSeconds = 0;
  runtimeStatus.eligibleIdleSeconds = 0;
  runtimeStatus.normalSeconds = 0;
  runtimeStatus.extraSeconds = 0;
  runtimeStatus.workedTodaySeconds = 0;
  runtimeStatus.dailyTargetProgressPercent = 0;
  runtimeStatus.activityPercent = 0;
  runtimeStatus.timeSummary = null;
  runtimeStatus.todayTimeline = null;
  runtimeStatus.idleRequestPeriods = [];
  runtimeStatus.locallyEndedIdleAt = null;
  clearIdleReturnVerification();
  lastHandledIdleReturnInputAt = now.getTime();
  idleSecondsBeforeCurrentIdle = 0;
  eligibleIdleSecondsBeforeCurrentIdle = 0;
  lastDurationTickAt = now.getTime();
}

function ensureCurrentCounterDate(now = new Date()) {
  const nextCounterDate = localDateKey(now);
  if (activeCounterDate === null) {
    activeCounterDate = nextCounterDate;
    return;
  }
  if (activeCounterDate === nextCounterDate) {
    return;
  }

  const restartLocalTracking = Boolean(localTrackingSessionId);
  // Close yesterday's local session at the last instant of the PREVIOUS local
  // day, not at this next-day tick. Recovery replays its counters at this
  // timestamp; using a next-day timestamp made the backend roll the session over
  // and discard all of yesterday's offline work. Bounding it to the previous day
  // keeps the work in yesterday's ledger.
  closeActiveLocalTrackingSession(
    endOfPreviousLocalDayIso(now, currentTimezone()),
    "daily_rollover",
  );
  resetDailyRuntimeCounters(nextCounterDate, now);
  if (restartLocalTracking && automaticTrackingIsExpected()) {
    beginLocalTrackingSession(now);
  }
  notifyRendererStatus();
  rebuildTrayMenu();
}

function getPendingScreenshotDirectory() {
  return path.join(app.getPath("userData"), "pending-screenshots");
}

type ScreenshotFileRemoval = "removed" | "refused" | "failed";

function removeOwnedScreenshotFile(filePath: string): ScreenshotFileRemoval {
  // Only ever delete files inside our own pending-screenshot directory. A queue
  // row's persisted path must never be trusted to delete an arbitrary file.
  // Returns an explicit outcome so the caller can decide whether the owning row
  // is safe to retire: only when the owned file is gone.
  if (!filePath) return "removed";
  const directory = getPendingScreenshotDirectory();
  const resolved = path.resolve(filePath);
  const relative = path.relative(directory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    log.warn("Refused to delete a screenshot file outside the owned directory", {
      filePath,
    });
    // The path is not one of our files, so retiring the row orphans nothing of
    // ours; treat it as safe to retire rather than looping on it forever.
    return "refused";
  }
  try {
    // force:true also succeeds when the file is already absent.
    fs.rmSync(resolved, { force: true });
    return "removed";
  } catch (error) {
    // The owned file is still on disk (e.g. EPERM / in use). Report failure so
    // the caller keeps the row for a later retry instead of orphaning the JPEG.
    log.warn("Could not remove a terminal screenshot file", safeErrorForLog(error));
    return "failed";
  }
}

function cleanupTerminalScreenshotFiles() {
  // Remove owned files for screenshots in a terminal state before their rows are
  // purged, so a permanently-rejected or already-synced image never lingers on
  // disk. Only rows whose owned file was actually removed (or was never ours) are
  // retired; a row whose file could not be deleted is kept so a later pass —
  // including after a restart — retries the deletion instead of orphaning the
  // file with no queue record.
  const removableIds: string[] = [];
  for (const terminal of listTerminalPendingScreenshots()) {
    if (removeOwnedScreenshotFile(terminal.filePath) !== "failed") {
      removableIds.push(terminal.screenshotId);
    }
  }
  purgeTerminalScreenshotRows(removableIds);
  purgeTerminalPendingEvents();
}

function syncRuntimeFromSession(session: WorkSession) {
  if (trackingPausedByUser) {
    return;
  }
  const todayCounterDate = localDateKey();
  const sessionCounterDate = localDateKey(new Date(session.started_at));
  const previousSessionCounterDate = runtimeStatus.sessionStartedAt
    ? localDateKey(new Date(runtimeStatus.sessionStartedAt))
    : null;
  const changedSession = currentSessionId !== session.id;
  if (
    shouldResetDailyCountersForSession({
      activeCounterDate,
      todayCounterDate,
      previousSessionCounterDate,
      nextSessionCounterDate: sessionCounterDate,
      changedSession,
    })
  ) {
    resetDailyRuntimeCounters(todayCounterDate);
  }
  const belongsToToday = isSessionCounterToday({
    sessionCounterDate,
    todayCounterDate,
  });
  // Today's portion of the session. For a session continued from a previous day
  // the server reports a multi-day total, so today's counters are only what we
  // accrued locally since the midnight reset — not the server total, not 0.
  const localActiveSeconds = changedSession ? 0 : runtimeStatus.activeSeconds;
  const localIdleSeconds = changedSession ? 0 : runtimeStatus.idleSeconds;
  if (
    session.ended_at ||
    session.status === "ended" ||
    session.status === "offline"
  ) {
    // A newer session was adopted (resume/start) while this ended snapshot was in
    // flight. Applying its offline status and multi-day counters would clobber the
    // live session's id, status, start time, and counters. Ignore the stale
    // closed-session snapshot entirely — defense in depth for the caller-level
    // ownership check in stopTrackingSession (D3).
    if (currentSessionId !== null && currentSessionId !== session.id) {
      return;
    }
    if (currentSessionId === session.id) {
      currentSessionId = null;
    }
    runtimeStatus.sessionStartedAt = null;
    runtimeStatus.trackingStatus = "offline";
    runtimeStatus.activeSeconds = belongsToToday
      ? session.active_seconds
      : localActiveSeconds;
    runtimeStatus.idleSeconds = belongsToToday
      ? session.idle_seconds
      : localIdleSeconds;
    runtimeStatus.workedTodaySeconds =
      workedTodayBaseSeconds + runtimeStatus.activeSeconds;
    lastDurationTickAt = null;
    return;
  }
  const wasIdle = runtimeStatus.trackingStatus === "idle";
  activeCounterDate = todayCounterDate;
  currentSessionId = session.id;
  runtimeStatus.sessionStartedAt = session.started_at;
  runtimeStatus.trackingStatus = session.status;
  if (session.status === "idle" && (changedSession || !wasIdle)) {
    automaticIdleStartedDuringBreak = isInsideScheduledBreak(new Date());
    lastObservedSystemIdleSeconds = null;
    lastObservedOperatingSystemIdleSeconds = null;
  } else if (session.status !== "idle") {
    automaticIdleStartedDuringBreak = false;
  }
  runtimeStatus.activeSeconds = resolveSessionCounterSeconds({
    belongsToToday,
    serverSeconds: session.active_seconds,
    localSeconds: localActiveSeconds,
  });
  runtimeStatus.idleSeconds = resolveSessionCounterSeconds({
    belongsToToday,
    serverSeconds: session.idle_seconds,
    localSeconds: localIdleSeconds,
  });
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
    if (
      workday.work_date &&
      activeCounterDate &&
      workday.work_date !== activeCounterDate
    ) {
      return;
    }
    activeCounterDate = workday.work_date ?? activeCounterDate;
    runtimeStatus.dailyTargetSeconds = workday.required_normal_seconds;
    runtimeStatus.normalSeconds = workday.normal_seconds;
    runtimeStatus.extraSeconds = workday.extra_seconds;
    runtimeStatus.overtimeEnabled = workday.overtime_enabled;
    runtimeStatus.extraTimeStatus = workday.extra_time_status;
    const trackedTodaySeconds = workday.normal_seconds + workday.extra_seconds;
    const reconciled = reconcileWorkedToday({
      trackedTodaySeconds,
      activeSeconds: runtimeStatus.activeSeconds,
      previousBaseSeconds: workedTodayBaseSeconds,
      preservePreviousBase: true,
    });
    workedTodayBaseSeconds = reconciled.baseSeconds;
    runtimeStatus.workedTodaySeconds = reconciled.workedTodaySeconds;
    runtimeStatus.dailyTargetProgressPercent = Math.min(
      100,
      Math.round(
        (workday.normal_seconds /
          Math.max(1, workday.required_normal_seconds)) *
          100,
      ),
    );
  }
}

function timeToMinuteOfDay(value?: string | null) {
  if (!value) return null;
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function waitForInputAfterIdleSessionClose(
  status: "idle" | "locked" | "sleeping",
) {
  clearIdleReturnVerification();
  waitingForInputAfterIdleSessionClose = true;
  runtimeStatus.trackingStatus = status;
  lastObservedOperatingSystemIdleSeconds = powerMonitor.getSystemIdleTime();
  lastObservedSystemIdleSeconds = observedIdleSeconds(
    lastObservedOperatingSystemIdleSeconds,
  );
  notifyRendererStatus();
  rebuildTrayMenu();
}

function resumeAfterIdleSessionClose() {
  if (!waitingForInputAfterIdleSessionClose) {
    return false;
  }
  waitingForInputAfterIdleSessionClose = false;
  clearIdleReturnVerification();
  lastObservedSystemIdleSeconds = null;
  lastObservedOperatingSystemIdleSeconds = null;
  runtimeStatus.trackingStatus = "starting";
  scheduleAutomaticTrackingRestart(0);
  notifyRendererStatus();
  rebuildTrayMenu();
  return true;
}

function isInsideScheduledBreak(at: Date) {
  const policy = runtimeStatus.requestPolicy;
  if (!policy || policy.approved_leave_today) return false;
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
  return (policy.break_rules ?? []).some((rule) => {
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

function activeTimeBucket(at: Date): "normal" | "extra" {
  const policy = runtimeStatus.requestPolicy;
  if (!policy) return "normal";
  if (policy.approved_leave_today) return "extra";
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
  const shiftStart = timeToMinuteOfDay(policy.shift_start);
  const shiftEnd = timeToMinuteOfDay(policy.shift_end);
  if (
    !policy.working_days.includes(weekday) ||
    shiftStart === null ||
    shiftEnd === null ||
    shiftEnd <= shiftStart
  ) {
    return "extra";
  }
  const minuteOfDay = Number(part("hour")) * 60 + Number(part("minute"));
  const approvedEarlyLeave = timeToMinuteOfDay(
    policy.approved_early_leave_from,
  );
  return minuteOfDay >= shiftStart &&
    minuteOfDay < shiftEnd &&
    (approvedEarlyLeave === null || minuteOfDay < approvedEarlyLeave)
    ? "normal"
    : "extra";
}

function recalculateWorkedTime(options?: { finalCheckpoint?: boolean }) {
  // A teardown (Stop/sign-out/Quit) banks the interval that elapsed BEFORE the
  // user requested it exactly once, at the synchronous intent boundary, then
  // freezes further accrual. That single call passes finalCheckpoint so it is
  // not swallowed by the sign-out/quit guard the periodic tick relies on (G3).
  const finalCheckpoint = options?.finalCheckpoint === true;
  ensureCurrentCounterDate();
  if (
    !hasTrackingSession() ||
    !runtimeStatus.sessionStartedAt ||
    !runtimeStatus.enrolled ||
    // A sign-out or quit in progress must never bank time via the periodic tick,
    // independent of the pause flags — a raced Resume could clear those flags
    // while teardown drains, so this defensive check does not rely on them (F3).
    // The one exception is the final checkpoint above, which banks the pre-intent
    // second once before the freeze takes hold.
    (!finalCheckpoint && (isSigningOut || isQuitting)) ||
    // Defensive accrual guard: never credit active/idle time while the employee
    // has explicitly stopped (trackingPausedByUser) OR paused (unpaidPauseActive).
    // A physical unlock/resume can flip status to "active" while a pause is still
    // in effect; this guard is independent of that transition so a single missed
    // transition cannot bank paid time for a paused employee.
    !shouldAccrueTrackedTime({
      trackingStoppedByUser: trackingPausedByUser,
      manualPauseActive: unpaidPauseActive,
    })
  ) {
    lastDurationTickAt = null;
    return;
  }

  const now = Date.now();
  if (lastDurationTickAt === null) {
    lastDurationTickAt = now;
    return;
  }

  // Discard oversized deltas: a gap far larger than the tick interval means the
  // process was frozen (sleep/hibernate/stall), not that the user worked. This
  // makes correctness independent of whether powerMonitor "suspend"/"resume"
  // fire — hibernate often does not deliver "resume", which previously let the
  // whole frozen span be banked as active time.
  const { elapsedSeconds, nextTickMs } = trackingTick(lastDurationTickAt, now);
  lastDurationTickAt = nextTickMs;
  if (elapsedSeconds === 0) {
    return;
  }

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
      runtimeStatus.eligibleIdleSeconds += elapsedSeconds;
    }
  } else if (
    runtimeStatus.trackingStatus === "active" ||
    runtimeStatus.trackingStatus === "starting"
  ) {
    runtimeStatus.activeSeconds += elapsedSeconds;
    if (activeTimeBucket(new Date(now)) === "normal") {
      runtimeStatus.normalSeconds += elapsedSeconds;
    } else {
      runtimeStatus.extraSeconds += elapsedSeconds;
      runtimeStatus.extraTimeStatus = runtimeStatus.overtimeEnabled
        ? "pending_overtime"
        : "recorded_not_counted";
    }
  }
  runtimeStatus.workedTodaySeconds =
    workedTodayBaseSeconds + runtimeStatus.activeSeconds;
  runtimeStatus.dailyTargetProgressPercent = Math.min(
    100,
    Math.round(
      (runtimeStatus.normalSeconds /
        Math.max(1, runtimeStatus.dailyTargetSeconds)) *
        100,
    ),
  );
  checkpointActiveLocalTrackingSession();
  rebuildTrayMenu();
}

async function refreshWorkedTodayTotalOnce() {
  if (!runtimeStatus.enrolled) {
    workedTodayBaseSeconds = 0;
    runtimeStatus.workedTodaySeconds = 0;
    return;
  }
  const requestGeneration = enrollmentGeneration;
  try {
    const previousTimelineDate = runtimeStatus.todayTimeline?.date ?? null;
    const summary = await getAgentSummary();
    // Discard a summary that arrives after logout / re-enrollment; applying its
    // employee name, avatar, timeline and counters would restore signed-out or
    // cross-identity personal data (D4).
    if (enrollmentGeneration !== requestGeneration || !runtimeStatus.enrolled) {
      return;
    }
    runtimeStatus.employeeName = summary.employee.name;
    runtimeStatus.employeeAvatarUrl = summary.employee.avatar_url;
    runtimeStatus.timeSummary = {
      today: summary.today,
      week: summary.week,
      month: summary.month,
    };
    runtimeStatus.eligibleIdleSeconds =
      summary.today.eligible_idle_seconds ?? summary.today.idle_seconds;
    runtimeStatus.dailyTargetSeconds =
      summary.daily_target_seconds ?? 8 * 60 * 60;
    runtimeStatus.dailyTargetProgressPercent =
      summary.daily_target_progress_percent ?? 0;
    runtimeStatus.activityPercent = summary.activity_percent ?? 0;
    runtimeStatus.todayTimeline = summary.today_timeline;
    runtimeStatus.idleRequestPeriods = summary.idle_request_periods ?? [];
    if (
      !summary.today_timeline.intervals.some(
        (interval) => interval.type === "idle" && interval.is_current,
      )
    ) {
      runtimeStatus.locallyEndedIdleAt = null;
    }
    const trackedTodaySeconds = Math.max(
      summary.today.tracked_active_seconds,
      summary.today_timeline?.worked_seconds ?? 0,
    );
    const reconciled = reconcileWorkedToday({
      trackedTodaySeconds,
      activeSeconds: runtimeStatus.activeSeconds,
      previousBaseSeconds: workedTodayBaseSeconds,
      preservePreviousBase:
        previousTimelineDate === summary.today_timeline?.date,
    });
    workedTodayBaseSeconds = reconciled.baseSeconds;
    runtimeStatus.workedTodaySeconds = reconciled.workedTodaySeconds;
  } catch (error) {
    log.warn("Failed to refresh today's worked time", safeErrorForLog(error));
  }
}

const refreshWorkedTodayTotal = createCoalescedRefresh(
  refreshWorkedTodayTotalOnce,
);

function showIdleLossAlert(lostSeconds: number, eligibleLostSeconds: number) {
  if (lostSeconds <= 0) {
    return;
  }

  runtimeStatus.lastIdleAlert = {
    id: randomUUID(),
    kind: "idle_return",
    lostSeconds,
    eligibleLostSeconds,
    outsideScheduledShift: eligibleLostSeconds <= 0,
    endedAt: new Date().toISOString(),
  };
  setIdleAlertAttention(true);
  showMainWindow({ forceForeground: true, centerOnPointerDisplay: true });
  mainWindow?.webContents.send("agent:idle-alert", runtimeStatus.lastIdleAlert);
}

function showFreshSessionStartConfirmation(outsideScheduledShift: boolean) {
  if (freshSessionStartPromptActive || trackingPausedByUser || isQuitting) {
    return;
  }
  freshSessionStartPromptActive = true;
  runtimeStatus.trackingPaused = true;
  runtimeStatus.trackingStatus = "paused";
  runtimeStatus.lastIdleAlert = {
    id: randomUUID(),
    kind: "tracking_start",
    lostSeconds: 0,
    eligibleLostSeconds: 0,
    outsideScheduledShift,
    endedAt: new Date().toISOString(),
  };
  setIdleAlertAttention(true);
  showMainWindow({ forceForeground: true, centerOnPointerDisplay: true });
  mainWindow?.webContents.send("agent:idle-alert", runtimeStatus.lastIdleAlert);
  notifyRendererStatus();
  rebuildTrayMenu();
}

async function confirmFreshSessionStart() {
  if (!runtimeStatus.enrolled) {
    return {
      success: false,
      message: "Enroll this device before starting tracking.",
    };
  }
  const outsideScheduledShift = activeTimeBucket(new Date()) === "extra";
  freshSessionStartPromptActive = false;
  freshSessionStartConfirmed = true;
  trackingPausedByUser = false;
  runtimeStatus.lastIdleAlert = null;
  runtimeStatus.trackingPaused = false;
  runtimeStatus.trackingStatus = "starting";
  saveTrackingPreferences();
  // The employee explicitly confirmed that work is starting, so local-first
  // tracking is safe even if the API is temporarily unavailable.
  beginLocalTrackingSession();
  await startTrackingAutomatically();
  notifyRendererStatus();
  rebuildTrayMenu();
  return {
    success: hasTrackingSession(),
    message: hasTrackingSession()
      ? outsideScheduledShift
        ? "Extra-time tracking started."
        : "Work tracking started."
      : "Tracking could not start. Check the connection and try again.",
  };
}

function declineFreshSessionStart() {
  freshSessionStartPromptActive = false;
  freshSessionStartConfirmed = false;
  trackingPausedByUser = true;
  runtimeStatus.lastIdleAlert = null;
  runtimeStatus.trackingPaused = true;
  runtimeStatus.trackingStatus = "paused";
  runtimeStatus.sessionStartedAt = null;
  saveTrackingPreferences();
  notifyRendererStatus();
  rebuildTrayMenu();
  return { success: true, message: "Work tracking was not started." };
}

async function refreshTimeAdjustmentRequests() {
  if (!runtimeStatus.enrolled) {
    runtimeStatus.timeAdjustmentRequests = [];
    return;
  }
  if (isRefreshingTimeAdjustments) {
    return;
  }
  isRefreshingTimeAdjustments = true;
  const requestGeneration = enrollmentGeneration;
  try {
    const result = await listTimeAdjustmentRequests();
    // Drop a response that arrives after logout / re-enrollment: it belongs to a
    // prior identity and must not repopulate the signed-out or newer runtime (D4).
    if (enrollmentGeneration !== requestGeneration || !runtimeStatus.enrolled) {
      return;
    }
    runtimeStatus.timeAdjustmentRequests = result;
  } catch (error) {
    log.warn(
      "Failed to refresh time adjustment requests",
      safeErrorForLog(error),
    );
  } finally {
    isRefreshingTimeAdjustments = false;
  }
}

async function refreshLeaveRequests() {
  if (!runtimeStatus.enrolled) {
    runtimeStatus.leaveRequests = null;
    return;
  }
  if (isRefreshingLeaveRequests) {
    return;
  }
  isRefreshingLeaveRequests = true;
  const requestGeneration = enrollmentGeneration;
  try {
    const result = await listLeaveRequests();
    // A late leave response must not restore personal data after sign-out or leak
    // it into a newer enrollment (D4).
    if (enrollmentGeneration !== requestGeneration || !runtimeStatus.enrolled) {
      return;
    }
    runtimeStatus.leaveRequests = result;
  } catch (error) {
    log.warn("Failed to refresh leave requests", safeErrorForLog(error));
  } finally {
    isRefreshingLeaveRequests = false;
  }
}

async function refreshTasks() {
  if (!runtimeStatus.enrolled) {
    runtimeStatus.tasks = [];
    runtimeStatus.selectedTask = null;
    runtimeStatus.recentTasks = [];
    return;
  }
  if (isRefreshingTasks) {
    return;
  }
  isRefreshingTasks = true;
  const requestGeneration = enrollmentGeneration;
  try {
    const [tasks, projects] = await Promise.all([
      listAgentTasks(),
      listAgentProjects(),
    ]);
    // Ignore a task/project response that lands after logout / re-enrollment so a
    // prior employee's tasks and recent-task list cannot repopulate the runtime (D4).
    if (enrollmentGeneration !== requestGeneration || !runtimeStatus.enrolled) {
      return;
    }
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
    log.warn("Failed to refresh tasks", safeErrorForLog(error));
  } finally {
    isRefreshingTasks = false;
  }
}

async function sendStateEvent(
  eventType: string,
  status: AgentRuntimeStatus["trackingStatus"],
  extraPayload: Record<string, unknown> = {},
  options: {
    eventTimestamp?: string;
    waitForDelivery?: Promise<boolean> | null;
  } = {},
) {
  clearIdleReturnVerification();
  runtimeStatus.trackingStatus = status;
  notifyRendererStatus();
  rebuildTrayMenu();
  if (!runtimeStatus.enrolled) {
    return false;
  }

  const eventId = randomUUID();
  const eventTimestamp = options.eventTimestamp ?? new Date().toISOString();
  const eventPayload = {
    status,
    idle_seconds: runtimeStatus.idleSeconds,
    agent_version: runtimeStatus.agentVersion,
    ...extraPayload,
  };
  if (
    localTrackingSessionId &&
    (!currentSessionId || isPromotingLocalTrackingSessions)
  ) {
    appendLocalTrackingEvent({
      id: eventId,
      localSessionId: localTrackingSessionId,
      eventType,
      eventTimestamp,
      payload: eventPayload,
    });
    checkpointActiveLocalTrackingSession(true);
    return false;
  }
  const sessionId = currentSessionId;
  if (!sessionId) {
    return false;
  }
  const requestEnrollmentGeneration = enrollmentGeneration;
  const endpoint = `/agent/sessions/${sessionId}/events`;
  const payload = {
    event_id: eventId,
    event_type: eventType,
    event_timestamp: eventTimestamp,
    payload: eventPayload,
  };

  // Durable BEFORE the network send: persist this transition to the outbox up
  // front so it survives a process kill or a shutdown-deadline exit during the
  // attempt, and so a concurrent finalization End — ordered last within the
  // session group via FINALIZATION_ORDER_SENTINEL — is head-of-line blocked
  // behind it instead of overtaking a predecessor that otherwise exists only as
  // an in-memory promise (J1/J2). On direct-send success the row is removed; the
  // event id is the idempotency key, so a concurrent queue replay of the same row
  // is deduplicated server-side rather than double-applied.
  enqueuePendingEvent({
    id: eventId,
    method: "POST",
    endpoint,
    payload,
    idempotencyKey: eventId,
  });

  try {
    const priorEventDelivered = options.waitForDelivery
      ? await options.waitForDelivery
      : true;
    if (!priorEventDelivered) {
      // The earlier offline transition is queued; this event stays durably queued
      // behind it (it was persisted above) for ordered replay.
      log.info(
        `Queued ${eventType} behind an earlier offline state transition`,
      );
      return false;
    }
    const result = await sendActivityEvent({
      sessionId,
      eventId,
      eventType,
      eventTimestamp,
      payload: payload.payload,
    });
    // Delivered directly — drop the now-redundant durable row (a concurrent queue
    // worker may have already removed it; markPendingEventUploaded is idempotent).
    markPendingEventUploaded(eventId);
    if (
      !sessionSnapshotIsApplicable({
        requestSessionId: sessionId,
        currentSessionId,
        requestEnrollmentGeneration,
        currentEnrollmentGeneration: enrollmentGeneration,
      })
    ) {
      // The current session changed (task switch, logout, re-enrollment) while
      // this state event was in flight. Do not apply the stale snapshot over the
      // newer session; the event itself was still accepted for its own session.
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
      return true;
    }
    const latestLocalStatus = runtimeStatus.trackingStatus;
    syncRuntimeFromSession(result.session);
    applyWorkdayState(result.workday);
    // Our posted transition is authoritative over a stale server echo of the
    // pre-transition status; otherwise a lagging "idle" snapshot reverts the
    // resume and the idle-return prompt loops forever.
    const reconciledStatus = reconcileTrackingStatusAfterSync({
      postedStatus: status,
      localStatusBeforeSync: latestLocalStatus,
      sessionEndedServerSide:
        Boolean(result.session.ended_at) ||
        result.session.status === "ended" ||
        result.session.status === "offline",
    });
    if (reconciledStatus !== null) {
      runtimeStatus.trackingStatus = reconciledStatus;
    }
    await refreshWorkedTodayTotal();
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    return true;
  } catch (error) {
    runtimeStatus.connectionStatus = connectionStatusAfterApiFailure(
      apiResponseStatus(error),
    );
    // The event is already durably queued (persisted before the send above), so
    // it is retained for ordered retry without re-enqueuing a duplicate row.
    log.warn(`Failed to send ${eventType}`, safeErrorForLog(error));
    return false;
  } finally {
    if (!isQuitting) {
      void refreshTrackingConfig();
      void refreshTasks();
    }
    notifyRendererStatus();
    rebuildTrayMenu();
  }
}

function automaticIdleDurationSnapshot(
  options: {
    endedAt?: number;
    idleSecondsAtEnd?: number;
    eligibleIdleSecondsAtEnd?: number;
  } = {},
) {
  recalculateWorkedTime();
  const endedAt = options.endedAt ?? Date.now();
  const idleSecondsAtEnd =
    options.idleSecondsAtEnd ?? runtimeStatus.idleSeconds;
  const eligibleIdleSecondsAtEnd =
    options.eligibleIdleSecondsAtEnd ?? runtimeStatus.eligibleIdleSeconds;
  const lostSeconds = Math.max(
    0,
    idleWallClockStartedAt === null
      ? idleSecondsAtEnd - idleSecondsBeforeCurrentIdle
      : Math.floor((endedAt - idleWallClockStartedAt) / 1000),
  );
  return {
    lostSeconds,
    eligibleLostSeconds: Math.max(
      0,
      eligibleIdleSecondsAtEnd - eligibleIdleSecondsBeforeCurrentIdle,
    ),
    idleStartedAt: new Date(
      idleWallClockStartedAt ?? endedAt - lostSeconds * 1000,
    ).toISOString(),
    idleSecondsBeforeGap: idleSecondsBeforeCurrentIdle,
  };
}

function dispatchManualPauseTransition(
  eventType: "manual_pause_started" | "manual_pause_ended",
  status: "idle" | "active",
) {
  const delivery = sendStateEvent(
    eventType,
    status,
    {},
    {
      waitForDelivery: manualPauseTransitionPromise,
    },
  );
  manualPauseTransitionPromise = delivery;
  void delivery.then(
    (delivered) => {
      // A failed delivery has been persisted in the ordered local queue. Keep
      // that result as the predecessor so a fast Pause -> Resume cannot
      // overtake the queued pause event when connectivity is intermittent.
      if (delivered && manualPauseTransitionPromise === delivery) {
        manualPauseTransitionPromise = null;
      }
    },
    (error: unknown) => {
      log.error(
        "Manual pause transition failed unexpectedly",
        safeErrorForLog(error),
      );
    },
  );
  return delivery;
}

function clearIdleReturnVerification() {
  idleReturnVerification = null;
}

function immediateIdleReturnInputDetected(
  operatingSystemIdleSeconds: number,
  previousOperatingSystemIdleSeconds: number | null,
) {
  const latestRealInputAt = inputIntegrityMonitor.latestRealInputAt();
  const freshRealInput =
    latestRealInputAt !== null &&
    latestRealInputAt > lastHandledIdleReturnInputAt;
  const detected = idleReturnInputDetected({
    latestRealInputAt,
    lastHandledRealInputAt: lastHandledIdleReturnInputAt,
    systemIdleSeconds: operatingSystemIdleSeconds,
    previousSystemIdleSeconds: previousOperatingSystemIdleSeconds,
  });
  if (freshRealInput) {
    lastHandledIdleReturnInputAt = latestRealInputAt;
  }
  return detected;
}

function creditVerifiedReturnPeriod(
  verification: IdleReturnVerification,
  now: number,
) {
  if (activeCounterDate !== verification.counterDate) {
    return;
  }
  const verifiedSeconds = Math.max(
    0,
    Math.floor((now - verification.startedAt) / 1_000),
  );
  if (verifiedSeconds === 0) {
    return;
  }

  const counters = reclassifyVerifiedReturnCounters({
    activeSeconds: runtimeStatus.activeSeconds,
    idleSeconds: runtimeStatus.idleSeconds,
    eligibleIdleSeconds: runtimeStatus.eligibleIdleSeconds,
    idleSecondsAtVerificationStart: verification.idleSecondsAtStart,
    eligibleIdleSecondsAtVerificationStart:
      verification.eligibleIdleSecondsAtStart,
    verifiedSeconds,
  });
  runtimeStatus.activeSeconds = counters.activeSeconds;
  runtimeStatus.idleSeconds = counters.idleSeconds;
  runtimeStatus.eligibleIdleSeconds = counters.eligibleIdleSeconds;

  let extraSeconds = 0;
  for (let offset = 1; offset <= verifiedSeconds; offset += 1) {
    const at = new Date(verification.startedAt + offset * 1_000);
    if (activeTimeBucket(at) === "normal") {
      runtimeStatus.normalSeconds += 1;
    } else {
      runtimeStatus.extraSeconds += 1;
      extraSeconds += 1;
    }
  }
  if (extraSeconds > 0) {
    runtimeStatus.extraTimeStatus = runtimeStatus.overtimeEnabled
      ? "pending_overtime"
      : "recorded_not_counted";
  }
  runtimeStatus.workedTodaySeconds =
    workedTodayBaseSeconds + runtimeStatus.activeSeconds;
  runtimeStatus.dailyTargetProgressPercent = Math.min(
    100,
    Math.round(
      (runtimeStatus.normalSeconds /
        Math.max(1, runtimeStatus.dailyTargetSeconds)) *
        100,
    ),
  );
  checkpointActiveLocalTrackingSession(true);
}

function showAutomaticIdleReturnReview() {
  if (
    unpaidPauseActive ||
    runtimeStatus.trackingStatus !== "idle" ||
    !hasTrackingSession() ||
    runtimeStatus.lastIdleAlert
  ) {
    return;
  }
  const { lostSeconds, eligibleLostSeconds } = automaticIdleDurationSnapshot();
  showIdleLossAlert(lostSeconds, eligibleLostSeconds);
}

function finishAutomaticIdleAfterVerification(
  verification: IdleReturnVerification,
) {
  if (
    unpaidPauseActive ||
    isFinishingAutomaticIdle ||
    runtimeStatus.trackingStatus !== "idle" ||
    !hasTrackingSession()
  ) {
    return null;
  }
  const now = Date.now();
  const canBackdateReturn = activeCounterDate === verification.counterDate;
  const automaticIdleEndedAt = canBackdateReturn
    ? verification.eventTimestamp
    : new Date(now).toISOString();
  const { lostSeconds, idleStartedAt, idleSecondsBeforeGap } =
    automaticIdleDurationSnapshot(
      canBackdateReturn
        ? {
            endedAt: verification.startedAt,
            idleSecondsAtEnd: verification.idleSecondsAtStart,
            eligibleIdleSecondsAtEnd: verification.eligibleIdleSecondsAtStart,
          }
        : { endedAt: now },
    );
  if (canBackdateReturn) {
    creditVerifiedReturnPeriod(verification, now);
  }
  idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
  eligibleIdleSecondsBeforeCurrentIdle = runtimeStatus.eligibleIdleSeconds;
  idleWallClockStartedAt = null;
  automaticIdleStartedDuringBreak = false;
  clearIdleReturnVerification();
  isFinishingAutomaticIdle = true;
  runtimeStatus.locallyEndedIdleAt = automaticIdleEndedAt;
  const finishPromise = sendStateEvent(
    "idle_ended",
    "active",
    {
      idle_started_at: idleStartedAt,
      idle_gap_seconds: lostSeconds,
      idle_seconds_before_gap: idleSecondsBeforeGap,
    },
    {
      eventTimestamp: automaticIdleEndedAt,
      waitForDelivery: automaticIdleStartPromise,
    },
  );
  automaticIdleFinishPromise = finishPromise;
  void finishPromise.finally(() => {
    if (automaticIdleFinishPromise === finishPromise) {
      automaticIdleFinishPromise = null;
    }
    isFinishingAutomaticIdle = false;
  });
  runtimeStatus.lastIdleAlert = null;
  if (lostSeconds > LONG_IDLE_SESSION_SPLIT_SECONDS) {
    log.info("Started a new work session after more than four hours away");
  }
  return finishPromise;
}

async function resumeAutomaticIdle() {
  if (!hasTrackingSession()) {
    return { success: false, message: "The idle review is no longer active." };
  }
  if (automaticIdleFinishPromise) {
    await automaticIdleFinishPromise;
    return { success: true };
  }
  if (runtimeStatus.trackingStatus === "active") {
    return { success: true };
  }
  if (runtimeStatus.trackingStatus !== "idle") {
    return { success: false, message: "The idle review is no longer active." };
  }
  if (idleReturnVerification) {
    const finishPromise = finishAutomaticIdleAfterVerification(
      idleReturnVerification,
    );
    if (finishPromise) await finishPromise;
    return { success: Boolean(finishPromise) };
  }
  if (
    automaticIdleReturnAction({
      trackingStatus: runtimeStatus.trackingStatus,
      immediateInputDetected: false,
      confirmationAccepted: true,
      sustainedInputConfirmed: false,
    }) !== "resume"
  ) {
    return { success: false, message: "Return confirmation is required." };
  }
  recalculateWorkedTime();
  const startedAt = Date.now();
  const verification: IdleReturnVerification = {
    startedAt,
    eventTimestamp: new Date(startedAt).toISOString(),
    counterDate: activeCounterDate,
    idleSecondsAtStart: runtimeStatus.idleSeconds,
    eligibleIdleSecondsAtStart: runtimeStatus.eligibleIdleSeconds,
  };
  idleReturnVerification = verification;
  const finishPromise = finishAutomaticIdleAfterVerification(verification);
  if (!finishPromise) {
    return {
      success: false,
      message: "The idle review could not be completed.",
    };
  }
  await finishPromise;
  return { success: true };
}

function showIdleStartedNotification() {
  const title = "You are now idle";
  const body =
    `No keyboard or mouse activity was detected for ${IDLE_THRESHOLD_MINUTES} minutes. ` +
    "Idle time starts now.";

  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      icon: getAppIconPath(),
    });
    notification.on("click", () =>
      showMainWindow({
        forceForeground: true,
        centerOnPointerDisplay: true,
      }),
    );
    notification.show();
    return;
  }

  if (process.platform === "win32") {
    tray?.displayBalloon({ title, content: body, iconType: "warning" });
  }
}

function startIdleMonitor() {
  if (idleTimer) {
    return;
  }

  idleTimer = setInterval(() => {
    if (waitingForInputAfterIdleSessionClose) {
      if (
        !runtimeStatus.enrolled ||
        trackingPausedByUser ||
        unpaidPauseActive ||
        isQuitting
      ) {
        lastObservedSystemIdleSeconds = null;
        lastObservedOperatingSystemIdleSeconds = null;
        return;
      }
      const idleSeconds = observedIdleSeconds();
      const previousSystemIdleSeconds = lastObservedSystemIdleSeconds;
      lastObservedSystemIdleSeconds = idleSeconds;
      if (inputResumedAfterIdle(idleSeconds, previousSystemIdleSeconds)) {
        resumeAfterIdleSessionClose();
      }
      return;
    }
    if (
      !runtimeStatus.enrolled ||
      !hasTrackingSession() ||
      runtimeStatus.trackingPaused ||
      unpaidPauseActive ||
      !["starting", "active", "idle"].includes(runtimeStatus.trackingStatus)
    ) {
      lastObservedSystemIdleSeconds = null;
      lastObservedOperatingSystemIdleSeconds = null;
      return;
    }

    const operatingSystemIdleSeconds = powerMonitor.getSystemIdleTime();
    const idleSeconds = observedIdleSeconds(operatingSystemIdleSeconds);
    const previousOperatingSystemIdleSeconds =
      lastObservedOperatingSystemIdleSeconds;
    lastObservedOperatingSystemIdleSeconds = operatingSystemIdleSeconds;
    lastObservedSystemIdleSeconds = idleSeconds;
    if (runtimeStatus.trackingStatus === "idle" && idleReturnVerification) {
      if (
        automaticIdleReturnAction({
          trackingStatus: runtimeStatus.trackingStatus,
          immediateInputDetected: false,
          confirmationAccepted: true,
          sustainedInputConfirmed: false,
        }) === "resume"
      ) {
        const verification = idleReturnVerification;
        void finishAutomaticIdleAfterVerification(verification);
      }
      return;
    }
    const insideScheduledBreak = isInsideScheduledBreak(new Date());
    if (
      hasReachedIdleThreshold(idleSeconds, insideScheduledBreak) &&
      runtimeStatus.trackingStatus !== "idle"
    ) {
      recalculateWorkedTime();
      idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
      eligibleIdleSecondsBeforeCurrentIdle = runtimeStatus.eligibleIdleSeconds;
      idleWallClockStartedAt = Date.now();
      clearIdleReturnVerification();
      lastHandledIdleReturnInputAt =
        inputIntegrityMonitor.latestRealInputAt() ?? Date.now();
      automaticIdleStartedDuringBreak = insideScheduledBreak;
      runtimeStatus.locallyEndedIdleAt = null;
      const startPromise = sendStateEvent("idle_started", "idle");
      automaticIdleStartPromise = startPromise;
      void startPromise.finally(() => {
        if (automaticIdleStartPromise === startPromise) {
          automaticIdleStartPromise = null;
        }
      });
      showIdleStartedNotification();
    } else if (
      automaticIdleReturnAction({
        trackingStatus: runtimeStatus.trackingStatus,
        immediateInputDetected: immediateIdleReturnInputDetected(
          operatingSystemIdleSeconds,
          previousOperatingSystemIdleSeconds,
        ),
        confirmationAccepted: false,
        sustainedInputConfirmed: false,
      }) === "review"
    ) {
      showAutomaticIdleReturnReview();
    }
  }, 250);
}

function applicationDisplayName(processName: string) {
  const normalized = processName
    .trim()
    .replace(/\.exe$/i, "")
    .toLowerCase();
  const knownApplications: Record<string, string> = {
    chrome: "Google Chrome",
    msedge: "Microsoft Edge",
    firefox: "Mozilla Firefox",
    brave: "Brave",
    opera: "Opera",
    vivaldi: "Vivaldi",
    code: "Visual Studio Code",
    devenv: "Visual Studio",
    winword: "Microsoft Word",
    excel: "Microsoft Excel",
    powerpnt: "Microsoft PowerPoint",
    outlook: "Microsoft Outlook",
    teams: "Microsoft Teams",
    "ms-teams": "Microsoft Teams",
    slack: "Slack",
    explorer: "File Explorer",
    notepad: "Notepad",
    photoshop: "Adobe Photoshop",
    acrobat: "Adobe Acrobat",
  };
  return (
    knownApplications[normalized] ??
    normalized
      .split(/[-_.\s]+/)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
      .join(" ")
  );
}

function siteDomainFromAddress(address: string | null | undefined) {
  const value = address?.trim();
  if (!value || /\s/.test(value)) {
    return null;
  }
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? value
      : `https://${value}`;
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

async function readForegroundActivity(): Promise<ForegroundActivity | null> {
  if (process.platform !== "win32") {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        FOREGROUND_WINDOW_POWERSHELL,
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
        maxBuffer: 64 * 1024,
      },
    );
    const output = String(stdout).trim();
    if (!output) {
      return null;
    }
    const metadata = JSON.parse(output) as {
      processName?: unknown;
      url?: unknown;
    };
    if (
      typeof metadata.processName !== "string" ||
      !metadata.processName.trim()
    ) {
      return null;
    }
    const processName = metadata.processName.trim().slice(0, 120);
    return {
      processName,
      applicationName: applicationDisplayName(processName).slice(0, 160),
      siteDomain:
        typeof metadata.url === "string"
          ? (siteDomainFromAddress(metadata.url)?.slice(0, 253) ?? null)
          : null,
    };
  } catch (error) {
    log.debug("Foreground application could not be read", error);
    return null;
  }
}

function sameForegroundActivity(
  left: ForegroundActivitySegment,
  right: ForegroundActivity,
) {
  return (
    left.processName === right.processName &&
    left.applicationName === right.applicationName &&
    left.siteDomain === right.siteDomain
  );
}

async function uploadForegroundActivitySegment(
  segment: ForegroundActivitySegment,
  endedAtMs: number,
) {
  const effectiveEnd = Math.max(segment.startedAt + 1_000, endedAtMs);
  const durationSeconds = Math.max(
    1,
    Math.min(300, Math.round((effectiveEnd - segment.startedAt) / 1_000)),
  );
  const eventId = randomUUID();
  const eventTimestamp = new Date(segment.startedAt).toISOString();
  const payload = {
    application_name: segment.applicationName,
    process_name: segment.processName,
    site_domain: segment.siteDomain,
    ended_at: new Date(effectiveEnd).toISOString(),
    duration_seconds: durationSeconds,
  };
  // Durable BEFORE the network send, like sendStateEvent (J1/J2): the foreground
  // evidence survives a kill/deadline during the attempt and is ordered ahead of a
  // finalization End. Removed on direct-send success; deduped by event id if a
  // concurrent queue replay delivers the same row.
  const queueEndpoint = `/agent/sessions/${segment.sessionId}/events`;
  const queuePayload = {
    event_id: eventId,
    event_type: "foreground_activity",
    event_timestamp: eventTimestamp,
    payload,
  };
  enqueuePendingEvent({
    id: eventId,
    method: "POST",
    endpoint: queueEndpoint,
    payload: queuePayload,
    idempotencyKey: eventId,
  });
  try {
    await sendActivityEvent({
      sessionId: segment.sessionId,
      eventId,
      eventType: "foreground_activity",
      eventTimestamp,
      payload,
    });
    markPendingEventUploaded(eventId);
  } catch (error) {
    // Already durably queued above; leave it for ordered retry.
    log.warn(
      "Foreground application segment was queued for sync",
      safeErrorForLog(error),
    );
  }
}

async function flushForegroundActivitySegment(endedAtMs = Date.now()) {
  const segment = foregroundActivitySegment;
  foregroundActivitySegment = null;
  if (!segment) {
    // No buffered segment: leave any already-outstanding delivery tracked so a
    // repeated cleanup cannot replace a pending predecessor with a resolved
    // empty flush (G1). The finalization path still awaits it.
    return;
  }
  const upload = uploadForegroundActivitySegment(
    segment,
    Math.max(segment.lastObservedAt, endedAtMs),
  );
  // Register every foreground delivery — regardless of which caller (periodic
  // tick, timer teardown, or max-segment rotation) started it — so a
  // finalization path (Quit / Stop / sign-out) can order its session End behind
  // ALL outstanding uploads, not just the most recent cleanup flush (G1). Chain
  // onto any prior pending flush so concurrent deliveries are all awaited.
  const predecessor = pendingForegroundActivityFlush;
  const tracked = (async () => {
    if (predecessor) {
      try {
        await predecessor;
      } catch {
        // A failed predecessor enqueues its own durable row; ignore here so the
        // chain still resolves and End ordering can proceed.
      }
    }
    await upload;
  })();
  pendingForegroundActivityFlush = tracked;
  // Clear the shared tracker only when the ENTIRE chain (this upload AND every
  // predecessor it waits on) has settled — never when just this newest upload
  // finishes. Otherwise a newer, faster delivery completing first would null the
  // tracker while an older upload is still in flight, letting End overtake it
  // (H2). The identity comparison ensures an older completion cannot clear a
  // tracker that a newer flush already replaced.
  void tracked.finally(() => {
    if (pendingForegroundActivityFlush === tracked) {
      pendingForegroundActivityFlush = null;
    }
  });
  // Resolve this call once THIS segment's own upload is done, so a periodic tick
  // that flushed it is not blocked behind unrelated older predecessors; the
  // finalization paths await the whole chain via the tracker instead.
  await upload;
}

async function foregroundActivityTick() {
  if (foregroundActivityTickRunning) {
    return;
  }
  foregroundActivityTickRunning = true;
  try {
    const sessionId = currentSessionId;
    const shouldCapture =
      Boolean(sessionId) &&
      runtimeStatus.enrolled &&
      !runtimeStatus.trackingPaused &&
      runtimeStatus.trackingStatus === "active";
    if (!shouldCapture || !sessionId) {
      await flushForegroundActivitySegment();
      return;
    }

    const activity = await readForegroundActivity();
    const observedAt = Date.now();
    if (
      !foregroundActivityTimer ||
      currentSessionId !== sessionId ||
      runtimeStatus.trackingPaused ||
      runtimeStatus.trackingStatus !== "active"
    ) {
      await flushForegroundActivitySegment(observedAt);
      return;
    }
    if (!activity) {
      await flushForegroundActivitySegment(observedAt);
      return;
    }

    if (
      foregroundActivitySegment &&
      foregroundActivitySegment.sessionId === sessionId &&
      sameForegroundActivity(foregroundActivitySegment, activity)
    ) {
      foregroundActivitySegment.lastObservedAt = observedAt;
      if (
        observedAt - foregroundActivitySegment.startedAt >=
        FOREGROUND_SEGMENT_MAX_MS
      ) {
        await flushForegroundActivitySegment(observedAt);
        foregroundActivitySegment = {
          ...activity,
          sessionId,
          startedAt: observedAt,
          lastObservedAt: observedAt,
        };
      }
      return;
    }

    await flushForegroundActivitySegment(observedAt);
    foregroundActivitySegment = {
      ...activity,
      sessionId,
      startedAt: observedAt,
      lastObservedAt: observedAt,
    };
  } finally {
    foregroundActivityTickRunning = false;
  }
}

function startForegroundActivityMonitoring() {
  if (foregroundActivityTimer || process.platform !== "win32") {
    return;
  }
  foregroundActivityTimer = setInterval(
    () => void foregroundActivityTick(),
    FOREGROUND_SAMPLE_INTERVAL_MS,
  );
  void foregroundActivityTick();
}

async function heartbeatTick(options: { refreshMetadata?: boolean } = {}) {
  if (
    !currentSessionId ||
    !runtimeStatus.enrolled ||
    isPromotingLocalTrackingSessions
  ) {
    return;
  }

  const sessionId = currentSessionId;
  const requestEnrollmentGeneration = enrollmentGeneration;
  recalculateWorkedTime();
  const eventId = randomUUID();
  const status =
    runtimeStatus.trackingStatus === "idle" ||
    runtimeStatus.trackingStatus === "locked" ||
    runtimeStatus.trackingStatus === "sleeping"
      ? runtimeStatus.trackingStatus
      : "active";
  const integrityObservation = inputIntegrityObservation();
  const payload = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    status,
    idle_seconds: runtimeStatus.idleSeconds,
    active_seconds: runtimeStatus.activeSeconds,
    agent_version: runtimeStatus.agentVersion,
    input_integrity: integrityObservation ?? null,
  };

  try {
    const result = await sendHeartbeat({
      sessionId,
      eventId,
      status,
      idleSeconds: runtimeStatus.idleSeconds,
      activeSeconds: runtimeStatus.activeSeconds,
      counterDate: activeCounterDate ?? localDateKey(),
      agentVersion: runtimeStatus.agentVersion,
      inputIntegrity: integrityObservation,
    });
    if (
      !sessionSnapshotIsApplicable({
        requestSessionId: sessionId,
        currentSessionId,
        requestEnrollmentGeneration,
        currentEnrollmentGeneration: enrollmentGeneration,
      })
    ) {
      // A task switch, logout, or re-enrollment changed the current session
      // while this heartbeat was in flight. Discard the stale snapshot so it
      // cannot revert the newer session's id, counters, start time, task, or
      // pause state. Connectivity is still proven by the response.
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
      log.info("Discarded a heartbeat response for a superseded session", {
        requestSessionId: sessionId,
      });
      return;
    }
    const serverClosedDuringNonWorking = shouldWaitForInputBeforeRestart(
      status,
      Boolean(result.session.ended_at) ||
        result.session.status === "ended" ||
        result.session.status === "offline",
    );
    const latestLocalStatus = runtimeStatus.trackingStatus;
    syncRuntimeFromSession(result.session);
    applyWorkdayState(result.workday);
    if (serverClosedDuringNonWorking) {
      waitForInputAfterIdleSessionClose(status);
    } else {
      // Keep the locally-known status authoritative over a stale server echo,
      // so a heartbeat cannot bounce an active session back to idle while the
      // server is still catching up to a just-sent transition.
      const reconciledStatus = reconcileTrackingStatusAfterSync({
        postedStatus: status,
        localStatusBeforeSync: latestLocalStatus,
        sessionEndedServerSide:
          Boolean(result.session.ended_at) ||
          result.session.status === "ended" ||
          result.session.status === "offline",
      });
      if (reconciledStatus !== null) {
        runtimeStatus.trackingStatus = reconciledStatus;
      }
    }
    applyPauseState(result.pause);
    if (
      options.refreshMetadata !== false &&
      Date.now() - lastFullSummaryRefreshAt > 60 * 1000
    ) {
      lastFullSummaryRefreshAt = Date.now();
      await refreshWorkedTodayTotal();
    }
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    if (!currentSessionId) {
      if (serverClosedDuringNonWorking) {
        log.info(
          "The server closed the inactive session; waiting for fresh input before tracking again",
        );
      } else {
        log.info(
          "The server closed the current session; starting a fresh session automatically",
        );
        scheduleAutomaticTrackingRestart(1_000);
      }
    }
  } catch (error) {
    runtimeStatus.connectionStatus = connectionStatusAfterApiFailure(
      apiResponseStatus(error),
    );
    if (
      !sessionSnapshotIsApplicable({
        requestSessionId: sessionId,
        currentSessionId,
        requestEnrollmentGeneration,
        currentEnrollmentGeneration: enrollmentGeneration,
      })
    ) {
      // A task switch, logout, or re-enrollment replaced the current session
      // while this heartbeat was in flight. A stale error for the OLD session —
      // a 404, or an identity mismatch — must never clear the newer session's
      // identity/start time, reset enrollment, or schedule a spurious restart.
      // The failed request still yielded a connection-status update above; the
      // superseded snapshot is otherwise discarded, exactly like the success path.
      log.info("Discarded a heartbeat error for a superseded session", {
        requestSessionId: sessionId,
      });
      return;
    }
    if (isDeviceIdentityMismatch(error)) {
      resetForDeviceReenrollment();
      log.warn(
        "Device identity mismatch; local enrollment was cleared",
        safeErrorForLog(error),
      );
      return;
    }
    const sessionNotFound =
      axios.isAxiosError(error) && error.response?.status === 404;
    if (sessionNotFound) {
      // The server no longer knows this session (for example after a restart
      // or an administrative close). Do not keep retrying a dead heartbeat
      // forever; clear it and let the automatic-start flow create a fresh
      // session while preserving the local tracking state.
      currentSessionId = null;
      runtimeStatus.sessionStartedAt = null;
      beginLocalTrackingSession();
      scheduleAutomaticTrackingRestart(1_000);
    } else {
      enqueuePendingEvent({
        id: eventId,
        method: "POST",
        endpoint: `/agent/sessions/${sessionId}/heartbeat`,
        payload,
        idempotencyKey: eventId,
      });
    }
    log.warn("Heartbeat failed", safeErrorForLog(error));
  } finally {
    if (
      options.refreshMetadata !== false &&
      Date.now() - lastMetadataRefreshAt > 60 * 1000
    ) {
      lastMetadataRefreshAt = Date.now();
      void refreshTrackingConfig();
      void refreshTasks();
    }
    rebuildTrayMenu();
  }
}

function automaticTrackingIsExpected() {
  return (
    runtimeStatus.enrolled &&
    !trackingPausedByUser &&
    !unpaidPauseActive &&
    !waitingForInputAfterIdleSessionClose &&
    !freshSessionStartPromptActive &&
    !isQuitting
  );
}

function scheduleAutomaticTrackingRestart(delayMs = 1_000) {
  if (
    !automaticTrackingIsExpected() ||
    currentSessionId ||
    automaticTrackingRetryTimer
  ) {
    return;
  }
  if (!localTrackingSessionId) {
    runtimeStatus.trackingStatus = "starting";
  }
  automaticTrackingRetryTimer = setTimeout(
    () => {
      automaticTrackingRetryTimer = null;
      void startTrackingAutomatically();
    },
    Math.max(0, delayMs),
  );
}

function startTrackingWatchdog() {
  if (trackingWatchdogTimer) {
    return;
  }
  trackingWatchdogTimer = setInterval(() => {
    if (!currentSessionId && automaticTrackingIsExpected()) {
      scheduleAutomaticTrackingRestart(1_000);
    }
  }, 15_000);
}

function startTimers() {
  if (lastDurationTickAt === null) {
    lastDurationTickAt = Date.now();
  }
  if (!durationTimer) {
    durationTimer = setInterval(recalculateWorkedTime, 1000);
  }
  if (!heartbeatTimer) {
    const parsedHeartbeatSeconds = Number(
      process.env.HEARTBEAT_INTERVAL_SECONDS ?? "60",
    );
    // A malformed env value (NaN) would make Math.max(10, NaN) === NaN, and
    // setInterval(fn, NaN) fires as fast as the loop allows, hammering the API.
    const heartbeatSeconds = Number.isFinite(parsedHeartbeatSeconds)
      ? parsedHeartbeatSeconds
      : 60;
    heartbeatTimer = setInterval(
      () => void heartbeatTick(),
      Math.max(10, heartbeatSeconds) * 1000,
    );
  }
  startIdleMonitor();
  startForegroundActivityMonitoring();
  startScreenshotMonitoring();
  startTrackingWatchdog();
}

function startScreenshotMonitoring() {
  scheduleNextScreenshot();
  if (!syncTimer) {
    syncTimer = setInterval(() => void syncPendingQueues(), 15_000);
  }
}

function clearRuntimeTimers() {
  lastDurationTickAt = null;
  if (foregroundActivityTimer) {
    clearInterval(foregroundActivityTimer);
    foregroundActivityTimer = null;
  }
  // Flush any buffered foreground segment. flushForegroundActivitySegment now
  // registers its own upload into pendingForegroundActivityFlush (chaining onto
  // an already in-flight delivery started by the periodic tick), so a
  // finalization path can order End behind every outstanding upload rather than
  // this one cleanup flush overwriting an in-flight predecessor (G1).
  void flushForegroundActivitySegment();
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
  if (trackingWatchdogTimer) {
    clearInterval(trackingWatchdogTimer);
    trackingWatchdogTimer = null;
  }
}

function invalidateInFlightScreenshotCaptures() {
  // Cancel any capture that is currently awaiting foreground detection or screen
  // acquisition. Called the instant capture eligibility is lost.
  screenshotCaptureGeneration += 1;
}

function screenshotCaptureBlockReason(): string | null {
  // Device sign-out is a stronger gate than the enrolled-but-stopped screenshot
  // policy: the instant sign-out begins, no new capture may be acquired even
  // though enrollment is briefly still true while final delivery drains (D6).
  if (isSigningOut) return "signing_out";
  if (!runtimeStatus.enrolled) return "device_not_enrolled";
  if (!trackingConfig.screenshot_enabled) return "capture_disabled";
  if (freshSessionStartPromptActive) return "work_start_not_confirmed";
  // The employee's manual unpaid Pause blocks capture. Sign-out/stop and paid
  // pauses also set trackingPaused, but screenshot monitoring is an independent
  // company policy and intentionally keeps capturing there, so this checks the
  // narrow unpaid-pause flag rather than the generic paused state.
  if (unpaidPauseActive) return "tracking_paused";
  if (!onAcPower) return "battery_power";
  // Physical lock/sleep is tracked independently of the work-intent status. A
  // deliberately stopped session keeps trackingStatus at "paused" across a
  // lock/unlock cycle, so eligibility must consult the physical flags — which
  // unlock/resume always clear — rather than the stale work status (D5).
  if (screenLocked) return "screen_locked";
  if (systemSleeping) return "system_sleeping";
  const systemIdleSeconds = observedIdleSeconds();
  if (
    !trackingConfig.capture_during_idle &&
    (runtimeStatus.trackingStatus === "idle" ||
      hasReachedIdleThreshold(systemIdleSeconds))
  ) {
    return "no_user_activity";
  }
  return null;
}

async function refreshTrackingConfig() {
  if (!runtimeStatus.enrolled || isRefreshingTrackingConfig) {
    return;
  }
  isRefreshingTrackingConfig = true;
  const requestGeneration = enrollmentGeneration;
  try {
    const previousPolicy = JSON.stringify(runtimeStatus.requestPolicy);
    const previousEmployeeName = runtimeStatus.employeeName;
    const previousEmployeeEmail = runtimeStatus.employeeEmail;
    const rawConfig = await getAgentConfig();
    // A config/employee response that returns after logout / re-enrollment must
    // not repopulate the signed-out or newer identity's policy and profile (D4).
    if (enrollmentGeneration !== requestGeneration || !runtimeStatus.enrolled) {
      return;
    }
    const nextConfig = normalizeTrackingConfig(rawConfig);
    if (rawConfig.employee) {
      runtimeStatus.employeeName = rawConfig.employee.name;
      runtimeStatus.employeeEmail = rawConfig.employee.email;
    }
    runtimeStatus.requestPolicy = rawConfig.request_policy ?? null;
    saveTrackingPreferences();
    const requestPolicyChanged =
      previousPolicy !== JSON.stringify(runtimeStatus.requestPolicy);
    const employeeChanged =
      previousEmployeeName !== runtimeStatus.employeeName ||
      previousEmployeeEmail !== runtimeStatus.employeeEmail;
    const screenshotScheduleChanged =
      nextConfig.screenshot_enabled !== trackingConfig.screenshot_enabled ||
      nextConfig.screenshot_interval_minutes !==
        trackingConfig.screenshot_interval_minutes ||
      nextConfig.screenshots_per_interval !==
        trackingConfig.screenshots_per_interval;

    trackingConfig = nextConfig;
    lastMetadataRefreshAt = Date.now();

    if (screenshotScheduleChanged) {
      if (screenshotTimer) {
        clearTimeout(screenshotTimer);
        screenshotTimer = null;
      }
      screenshotQueue = [];
      screenshotWindowEndsAt = null;
      scheduleNextScreenshot();
    }
    if (requestPolicyChanged) {
      await refreshWorkedTodayTotal();
    }
    if (requestPolicyChanged || employeeChanged || screenshotScheduleChanged) {
      notifyRendererStatus();
      rebuildTrayMenu();
    }
  } catch (error) {
    log.warn("Failed to refresh tracking config", safeErrorForLog(error));
  } finally {
    isRefreshingTrackingConfig = false;
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
        log.warn(
          "Failed to report screenshot skip reason",
          safeErrorForLog(error),
        );
      }
    }
    return;
  }

  // Freeze the capture-time identity and eligibility generation. Every async
  // step below is re-validated against these so a Pause / lock / sleep / logout
  // / power change that lands mid-capture cancels the image instead of
  // uploading work captured after the employee stopped.
  const captureGeneration = screenshotCaptureGeneration;
  // Freeze the capture-time session identity so every display in this capture —
  // and any later queued upload — references the session that was active when
  // the pixels were taken, never whichever session becomes current later. When
  // tracking is local-only (offline), record the local session id so the upload
  // can resolve it to the recovered server session after promotion.
  const captureSessionId = currentSessionId;
  const captureLocalSessionId = currentSessionId ? null : localTrackingSessionId;
  const captureRemainsAllowed = () =>
    captureRemainsEligible({
      blockReasonNow: screenshotCaptureBlockReason(),
      generationAtStart: captureGeneration,
      currentGeneration: screenshotCaptureGeneration,
    });

  const activityAtCapture = await readForegroundActivity();
  if (!captureRemainsAllowed()) {
    log.info("Screenshot cancelled after foreground detection", {
      reason: screenshotCaptureBlockReason() ?? "eligibility_changed",
    });
    return;
  }
  const recentActivity =
    foregroundActivitySegment &&
    Date.now() - foregroundActivitySegment.lastObservedAt <= 15_000
      ? foregroundActivitySegment
      : null;
  const protectWhatsApp = isWhatsAppScreenshotActivity(
    activityAtCapture ?? recentActivity,
  );
  if (protectWhatsApp) {
    log.info("Applying privacy protection to a WhatsApp screenshot");
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
  if (!captureRemainsAllowed()) {
    // Pixels were acquired, but eligibility was lost while acquiring them (e.g.
    // the employee paused, or the screen locked). Discard rather than upload or
    // queue an image captured after work stopped.
    log.info("Screenshot discarded after screen acquisition", {
      reason: screenshotCaptureBlockReason() ?? "eligibility_changed",
    });
    return;
  }

  const capturedAt = new Date().toISOString();
  let uploaded = 0;
  let queued = 0;
  let rejected = 0;
  // Resolve the session this capture belongs to before any upload. When tracking
  // is local-only (offline), the capture references a local session id; resolve
  // it to the recovered server session via the durable mapping so the DIRECT
  // upload path — not only queued replay — attaches the correct session. If the
  // local session has not been promoted yet, defer the image to the queue instead
  // of uploading it sessionless, which would permanently lose its association
  // (localSessionId is client-only and never reaches the backend). A capture with
  // no local session at all remains a legitimate sessionless enrolled-device
  // policy capture and uploads as before.
  let uploadSessionId = captureSessionId;
  let deferForSessionPromotion = false;
  if (!uploadSessionId && captureLocalSessionId) {
    const resolvedSessionId =
      getServerSessionIdForLocalSession(captureLocalSessionId);
    if (resolvedSessionId) {
      uploadSessionId = resolvedSessionId;
    } else {
      deferForSessionPromotion = true;
    }
  }
  for (const [index, source] of sources.entries()) {
    if (source.thumbnail.isEmpty()) {
      log.warn("Screen source was empty", {
        displayId: source.display_id,
        sourceName: source.name,
      });
      continue;
    }
    const screenshotId = randomUUID();
    const originalSize = source.thumbnail.getSize();
    const protectedThumbnail = protectWhatsApp
      ? source.thumbnail
          .resize({
            ...privacyBlurSampleSize(originalSize.width, originalSize.height),
            quality: "best",
          })
          .resize({
            width: originalSize.width,
            height: originalSize.height,
            quality: "best",
          })
      : source.thumbnail;
    const jpeg = protectedThumbnail.toJPEG(72);
    const checksum = createHash("sha256").update(jpeg).digest("hex");
    const size = protectedThumbnail.getSize();
    const metadata: ScreenshotMetadata = {
      screenshotId,
      sessionId: uploadSessionId,
      localSessionId: captureLocalSessionId,
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
      trackingStatus: runtimeStatus.trackingStatus,
    };

    if (deferForSessionPromotion) {
      // The capture belongs to a local session that is not yet promoted. Persist
      // it for later; the queued replay resolves the mapping once the session is
      // promoted and never attaches it to whichever session is current then.
      const pendingDirectory = getPendingScreenshotDirectory();
      fs.mkdirSync(pendingDirectory, { recursive: true });
      const filePath = path.join(pendingDirectory, `${screenshotId}.jpg`);
      fs.writeFileSync(filePath, jpeg);
      enqueuePendingScreenshot({ screenshotId, metadata, filePath });
      queued += 1;
      log.info("Deferred a screenshot for a not-yet-promoted local session", {
        screenshotId,
        localSessionId: captureLocalSessionId,
      });
      continue;
    }

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
      const responseStatus = apiResponseStatus(error);
      const permanentlyRejected = isPermanentScreenshotSyncFailure({
        responseStatus,
        apiErrorCode: apiErrorCode(error),
      });
      const pendingDirectory = getPendingScreenshotDirectory();
      fs.mkdirSync(pendingDirectory, { recursive: true });
      const filePath = path.join(pendingDirectory, `${screenshotId}.jpg`);
      fs.writeFileSync(filePath, jpeg);
      enqueuePendingScreenshot({ screenshotId, metadata, filePath });
      if (permanentlyRejected) {
        // The very first upload was permanently rejected (e.g. company capture
        // disabled). It will never be accepted, so retire the row and remove the
        // owned file now instead of leaving an orphan JPEG that no retry or
        // purge path would ever clean. It is NOT counted as "queued" so the
        // notification does not claim a rejected image is waiting to sync.
        markPendingScreenshotFailed(screenshotId, 0, true);
        removeOwnedScreenshotFile(filePath);
        rejected += 1;
      } else {
        // A transient/authentication failure keeps the image and metadata for a
        // later retry under the same identity.
        queued += 1;
      }
      runtimeStatus.connectionStatus =
        connectionStatusAfterApiFailure(responseStatus);
      log.warn(
        permanentlyRejected
          ? "Screen capture permanently rejected and discarded"
          : "Screen capture queued for retry",
        {
          displayId: metadata.displayId,
          error: safeErrorForLog(error),
        },
      );
    }
  }

  runtimeStatus.lastScreenshotAt = capturedAt;
  if (uploaded > 0)
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
  if (uploaded > 0) {
    runtimeStatus.connectionStatus = "online";
  } else if (
    queued > 0 &&
    runtimeStatus.lastSuccessfulSyncAt === null &&
    runtimeStatus.connectionStatus !== "online"
  ) {
    runtimeStatus.connectionStatus = "offline";
  }
  // Remove owned files/rows for any capture that was just permanently rejected
  // so a rejected JPEG never lingers on disk with no queue record.
  if (rejected > 0) {
    cleanupTerminalScreenshotFiles();
  }
  rebuildTrayMenu();
  // Only announce captures that actually uploaded or are genuinely waiting to
  // sync. A permanently-rejected image is neither, so it is excluded here.
  if (uploaded + queued > 0) {
    showScreenshotCapturedNotification(uploaded, queued);
  }
  log.info("Display screenshots processed", {
    displays: sources.length,
    uploaded,
    queued,
    rejected,
  });
}

function showScreenshotCapturedNotification(uploaded: number, queued: number) {
  const waitingForSync = queued > 0;
  const title = waitingForSync ? "Screenshot saved" : "Screenshot captured";
  const body =
    queued > 0 && uploaded > 0
      ? "Some screens were uploaded. The rest are saved securely and waiting to sync."
      : queued > 0
        ? "The screenshot is saved securely on this device and waiting to sync."
        : "Khaliduo uploaded the screenshot to document your work and effort.";

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

async function syncPendingQueuesOnce(forcePendingQueues: boolean) {
  for (const event of getDuePendingEvents(25, { force: forcePendingQueues })) {
    try {
      const response = (await sendQueuedRequest(
        event.method,
        event.endpoint,
        JSON.parse(event.payloadJson) as Record<string, unknown>,
      )) as { ignored?: boolean } | null;
      if (response?.ignored === true) {
        // The server accepted the request but ignored it (e.g. an event that
        // reached an already-closed session). Its payload may hold work that was
        // never applied, so DO NOT delete it — retain it durably for reconciliation
        // (markPendingEventIgnored moves it to a terminal, non-retried, non-purged
        // state). A logged warning alone is not recoverable evidence. Correct
        // causal ordering (see getDuePendingEvents / stopTrackingSession) is what
        // prevents an event from reaching a closed session in the first place.
        log.warn(
          "A replayed event was ignored by the server; retained for reconciliation",
          { endpoint: event.endpoint },
        );
        markPendingEventIgnored(event.id);
      } else {
        markPendingEventUploaded(event.id);
      }
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    } catch (error) {
      const responseStatus = apiResponseStatus(error);
      if (isAuthPendingEventSyncFailure(responseStatus)) {
        // The device token was rejected (invalid/expired/revoked). Never delete
        // recorded work for a repairable authentication failure — retain the row
        // and suspend the whole replay pass. Retrying with the same bad token is
        // futile and could storm the API; re-enrollment repairs delivery later,
        // and the backend still enforces session ownership so a re-enrolled
        // *different* identity cannot claim this backlog.
        markPendingEventFailed(event.id, event.attempts);
        runtimeStatus.connectionStatus =
          connectionStatusAfterApiFailure(responseStatus);
        log.warn(
          "Pending event replay blocked by authentication; queue retained",
          safeErrorForLog(error),
        );
        break;
      }
      const permanentlyRejected =
        isPermanentPendingEventSyncFailure(responseStatus);
      if (permanentlyRejected) {
        markPendingEventPermanentlyRejected(event.id, event.attempts);
      } else {
        // Connection and server failures must never erase recorded work.
        markPendingEventFailed(event.id, event.attempts);
      }
      // Any HTTP response proves that the API is reachable. Keep the agent
      // online while the rejected item remains pending for a later decision.
      runtimeStatus.connectionStatus =
        connectionStatusAfterApiFailure(responseStatus);
      log.warn("Pending event sync failed", safeErrorForLog(error));
      if (!permanentlyRejected) {
        // Avoid multiplying requests while the API is unavailable. A later
        // single-flight pass resumes from the durable local queue.
        break;
      }
      continue;
    }
  }

  for (const screenshot of getDuePendingScreenshots(10, {
    force: forcePendingQueues,
  })) {
    let metadata: ScreenshotMetadata;
    let content: Buffer;
    try {
      metadata = JSON.parse(screenshot.metadataJson) as ScreenshotMetadata;
      content = fs.readFileSync(screenshot.filePath);
    } catch (error) {
      // The local image or its metadata is missing/unreadable (manual cleanup,
      // antivirus, disk issue). The upload can never succeed, so drop the row
      // permanently and remove any leftover file instead of retrying forever
      // and stalling the head of the queue on every pass.
      markPendingScreenshotFailed(screenshot.screenshotId, screenshot.attempts, true);
      log.warn("Dropped unreadable pending screenshot", safeErrorForLog(error));
      continue;
    }
    if (!metadata.sessionId && metadata.localSessionId) {
      // This screenshot was captured during local-only (offline) tracking.
      // Resolve its local session to the recovered server session via the
      // durable mapping written when the local session was promoted. Never
      // attach it to whichever session happens to be current now.
      const resolvedSessionId = getServerSessionIdForLocalSession(
        metadata.localSessionId,
      );
      if (!resolvedSessionId) {
        // The local session has not been promoted yet. Keep the screenshot
        // queued (with backoff) rather than uploading it sessionless or against
        // an unrelated session; a later pass resolves it after promotion.
        markPendingScreenshotFailed(
          screenshot.screenshotId,
          screenshot.attempts,
        );
        log.info("Deferred offline screenshot awaiting session promotion", {
          screenshotId: screenshot.screenshotId,
          localSessionId: metadata.localSessionId,
        });
        continue;
      }
      metadata = { ...metadata, sessionId: resolvedSessionId };
    }
    try {
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
      // Mark terminal; the trailing cleanup removes the owned file and only then
      // retires the row, so a failed file delete never orphans the JPEG.
      markPendingScreenshotUploaded(screenshot.screenshotId);
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    } catch (error) {
      const responseStatus = apiResponseStatus(error);
      const permanentlyRejected = isPermanentScreenshotSyncFailure({
        responseStatus,
        apiErrorCode: apiErrorCode(error),
      });
      markPendingScreenshotFailed(
        screenshot.screenshotId,
        screenshot.attempts,
        permanentlyRejected,
      );
      runtimeStatus.connectionStatus =
        connectionStatusAfterApiFailure(responseStatus);
      log.warn("Pending screenshot sync failed", safeErrorForLog(error));
      if (!permanentlyRejected) {
        break;
      }
      // A server-rejected screenshot will never be accepted. Its 'dead' row is
      // retired below by the cleanup pass, which removes the owned file first.
      continue;
    }
  }
  // Remove owned files for terminal screenshots, then drop terminal rows
  // (legacy 'uploaded', permanently-rejected 'dead') so the local database file
  // stays bounded by in-flight work and no rejected JPEG is left on disk.
  cleanupTerminalScreenshotFiles();
  rebuildTrayMenu();
}

async function syncPendingQueues(forcePendingQueues = false) {
  if (!runtimeStatus.enrolled) {
    return;
  }
  if (pendingQueueSyncPromise) {
    await pendingQueueSyncPromise;
    return;
  }

  const syncPromise = syncPendingQueuesOnce(forcePendingQueues);
  pendingQueueSyncPromise = syncPromise;
  try {
    await syncPromise;
  } finally {
    if (pendingQueueSyncPromise === syncPromise) {
      pendingQueueSyncPromise = null;
    }
  }
}

function scheduleNextScreenshot() {
  if (screenshotTimer) {
    return;
  }
  if (!runtimeStatus.enrolled || !trackingConfig.screenshot_enabled) {
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
        log.warn("Screenshot capture/upload failed", safeErrorForLog(error));
      })
      .finally(() => scheduleNextScreenshot());
  }, delayMs);
}

async function startTrackingAutomatically() {
  if (
    !runtimeStatus.enrolled ||
    trackingPausedByUser ||
    currentSessionId ||
    freshSessionStartPromptActive ||
    isStartingTrackingAutomatically
  ) {
    return;
  }

  const attemptedAt = new Date();
  isStartingTrackingAutomatically = true;
  // Bind this startup to the enrollment identity that launched it. A logout or
  // re-enrollment during any await below invalidates the continuation: applying
  // its session/config snapshot or starting timers would revive a signed-out or
  // supersede a newer identity's runtime (D2). Sign-out, explicit Stop, and Quit
  // also invalidate it even though they do not change the identity generation, so
  // the guard covers those transitions too (F2).
  const startEnrollmentGeneration = enrollmentGeneration;
  const startupLostOwnership = () =>
    enrollmentGeneration !== startEnrollmentGeneration ||
    !runtimeStatus.enrolled ||
    isSigningOut ||
    isQuitting ||
    trackingPausedByUser;
  if (automaticTrackingRetryTimer) {
    clearTimeout(automaticTrackingRetryTimer);
    automaticTrackingRetryTimer = null;
  }
  try {
    const openLocalSession = runtimeStatus.deviceId
      ? getOpenLocalTrackingSession(runtimeStatus.deviceId)
      : null;
    if (openLocalSession) {
      // This is a session that was already tracking before a restart/update;
      // it must continue even when the shift boundary has passed.
      beginLocalTrackingSession(attemptedAt);
    }
    const currentBeforeRecovery = await getCurrentSession();
    if (startupLostOwnership()) {
      return;
    }
    const hasOpenServerSession = Boolean(
      currentBeforeRecovery.session &&
        !currentBeforeRecovery.session.ended_at &&
        currentBeforeRecovery.session.status !== "ended" &&
        currentBeforeRecovery.session.status !== "offline",
    );
    // A graceful quit closes a local-only row so time is bounded precisely.
    // Recover those closed rows before creating the next server session. If a
    // server session is already live, only its matching open local row may be
    // promoted; historical rows wait for a safe startup instead of ending it.
    const recoveredLocalSessions = await promotePendingLocalTrackingSessions({
      hasOpenServerSession,
    });
    await syncPendingQueues(true);
    const rawConfig = await getAgentConfig();
    if (startupLostOwnership()) {
      return;
    }
    trackingConfig = normalizeTrackingConfig(rawConfig);
    if (rawConfig.employee) {
      runtimeStatus.employeeName = rawConfig.employee.name;
      runtimeStatus.employeeEmail = rawConfig.employee.email;
    }
    runtimeStatus.requestPolicy = rawConfig.request_policy ?? null;
    saveTrackingPreferences();
    void refreshTasks();
    if (recoveredLocalSessions) {
      await refreshWorkedTodayTotal();
    }
    const current = await getCurrentSession();
    if (startupLostOwnership()) {
      return;
    }
    if (
      current.session &&
      !current.session.ended_at &&
      current.session.status !== "ended" &&
      current.session.status !== "offline"
    ) {
      // Keep the server session open across app restarts. Ending it here
      // made the employee's current-session counter jump back to zero even
      // though the workday and overtime totals were still continuing.
      syncRuntimeFromSession(current.session);
      freshSessionStartConfirmed = false;
      freshSessionStartPromptActive = false;
      applyWorkdayState(current.workday);
      applyPauseState(current.pause);
      await refreshWorkedTodayTotal();
      // A sign-out / Stop / Quit during the summary await must not start the
      // background timers or mark the signed-out runtime online (F2).
      if (startupLostOwnership()) {
        return;
      }
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
      startTimers();
      void heartbeatTick();
      void refreshTimeAdjustmentRequests();
      void refreshLeaveRequests();
      return;
    }
    const systemIdleSeconds = observedIdleSeconds();
    if (
      hasReachedIdleThreshold(
        systemIdleSeconds,
        isInsideScheduledBreak(new Date()),
      )
    ) {
      waitForInputAfterIdleSessionClose("idle");
      startIdleMonitor();
      log.info(
        "No active server session and Windows is idle; waiting for fresh input before starting one",
      );
      return;
    }
    if (
      requiresExplicitFreshSessionStart({
        hasExistingSession: Boolean(openLocalSession),
        confirmationAccepted: freshSessionStartConfirmed,
      })
    ) {
      const outsideScheduledShift = activeTimeBucket(attemptedAt) === "extra";
      showFreshSessionStartConfirmation(outsideScheduledShift);
      log.info("Fresh work session requires explicit employee confirmation", {
        outsideScheduledShift,
      });
      return;
    }
    // Capture the operation-bound device token BEFORE creating the session, so a
    // later re-enrollment cannot make us clean up under a different identity's
    // credentials (Gap 3).
    const startupOperationToken = getDeviceToken();
    const started = await startSession();
    if (startupLostOwnership()) {
      // Signed out / re-enrolled while the new session was being created. Do not
      // bind the just-opened session or start timers under the old identity (D2).
      // Actively close the orphaned server session under its ORIGINAL identity
      // instead of leaving it for the server heartbeat timeout; if that identity
      // is no longer authorized we fall back to the timeout (Gap 3).
      await endOrphanedStartupSession(
        started.session.id,
        startupOperationToken,
      );
      return;
    }
    freshSessionStartConfirmed = false;
    freshSessionStartPromptActive = false;
    waitingForInputAfterIdleSessionClose = false;
    syncRuntimeFromSession(started.session);
    applyWorkdayState(started.workday);
    await refreshWorkedTodayTotal();
    // As in the open-session branch: a sign-out / Stop / Quit during the summary
    // await must not start timers or mark the signed-out runtime online (F2).
    if (startupLostOwnership()) {
      return;
    }
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    startTimers();
    if (unpaidPauseActive) {
      runtimeStatus.trackingPaused = true;
      idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
      eligibleIdleSecondsBeforeCurrentIdle = runtimeStatus.eligibleIdleSeconds;
      idleWallClockStartedAt = Date.now();
      await sendStateEvent("idle_started", "idle");
    }
    void heartbeatTick();
    void refreshTimeAdjustmentRequests();
    void refreshLeaveRequests();
  } catch (error) {
    // A failed startup continuation that lost ownership (logout/re-enroll during
    // an await) must not prompt, begin a local session, reschedule, or mark the
    // signed-out runtime offline. Guard the failure path as well as success (D2).
    if (startupLostOwnership()) {
      return;
    }
    runtimeStatus.connectionStatus = connectionStatusAfterApiFailure(
      apiResponseStatus(error),
    );
    if (
      !hasTrackingSession() &&
      hasReachedIdleThreshold(
        observedIdleSeconds(),
        isInsideScheduledBreak(new Date()),
      )
    ) {
      waitForInputAfterIdleSessionClose("idle");
      startIdleMonitor();
      log.info(
        "Automatic start is offline and Windows is idle; waiting for input",
      );
      return;
    }
    if (
      !hasTrackingSession() &&
      requiresExplicitFreshSessionStart({
        hasExistingSession: false,
        confirmationAccepted: freshSessionStartConfirmed,
      })
    ) {
      const outsideScheduledShift =
        runtimeStatus.requestPolicy !== null &&
        activeTimeBucket(attemptedAt) === "extra";
      showFreshSessionStartConfirmation(outsideScheduledShift);
      log.info("Offline work start requires explicit employee confirmation", {
        outsideScheduledShift,
      });
      return;
    }
    if (!localTrackingSessionId) {
      beginLocalTrackingSession(attemptedAt);
    }
    if (!hasTrackingSession()) {
      runtimeStatus.trackingStatus = "offline";
    }
    log.error("Automatic tracking start failed", safeErrorForLog(error));
    if (isDeviceIdentityMismatch(error)) {
      resetForDeviceReenrollment();
      return;
    }
    scheduleAutomaticTrackingRestart(15_000);
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

async function endOrphanedStartupSession(
  sessionId: string,
  operationToken: string | null,
) {
  // A session was created during automatic startup, then ownership was lost
  // (Stop, sign-out, re-enrollment) before it could be bound. Close it under the
  // identity that created it, using the token captured at creation time — NOT the
  // global current token, which may now belong to a different device (Gap 3).
  if (!operationToken) {
    // No captured credential (should not happen for an enrolled startup); leave the
    // session to the server-side heartbeat timeout.
    return;
  }
  try {
    await endSession({
      sessionId,
      activeSeconds: 0,
      idleSeconds: 0,
      reason: "Orphaned startup session cancelled",
      endedAt: new Date().toISOString(),
      eventId: randomUUID(),
      authToken: operationToken,
    });
    log.info("Closed an orphaned startup session under its original identity", {
      sessionId,
    });
  } catch (error) {
    // 401 (token revoked) / 403 / 404 (foreign or already-cleaned device): the
    // original identity can no longer authorize this close, so we must not retry
    // under any other identity. Fall back to the server heartbeat timeout. A
    // transient/offline failure likewise falls back rather than replaying under a
    // possibly-newer identity via the shared queue (whose sends use the current
    // token). Durable same-identity recovery metadata is a further enhancement.
    const status = apiResponseStatus(error);
    log.warn(
      "Could not close an orphaned startup session under its original identity; leaving it to the server heartbeat timeout",
      { sessionId, status: status ?? null },
    );
  }
}

async function stopTrackingSession(reason = "Stopped by employee") {
  recalculateWorkedTime();
  trackingPausedByUser = true;
  waitingForInputAfterIdleSessionClose = false;
  freshSessionStartConfirmed = false;
  freshSessionStartPromptActive = false;
  runtimeStatus.trackingPaused = true;
  invalidateInFlightScreenshotCaptures();
  saveTrackingPreferences();
  closeActiveLocalTrackingSession(new Date().toISOString(), "paused");
  clearRuntimeTimers();
  // clearRuntimeTimers initiates the buffered foreground-activity flush (and
  // leaves any tick-started upload tracked). Capture it so Stop/sign-out orders
  // its End behind the foreground evidence: it posts to the same session, and a
  // closed session would otherwise drop the event (G1b).
  const foregroundFlush = pendingForegroundActivityFlush;
  pendingForegroundActivityFlush = null;
  inputIntegrityMonitor.stop();
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

  // Durability BEFORE the predecessor/foreground waits, and a bounded overall
  // deadline — the same shared finalization contract Quit uses (J1/J2). End is
  // persisted to the outbox now, sentinel-ordered to deliver LAST within its
  // session group, so a kill or a deadline-triggered exit during the waits still
  // closes the session on next launch and can never overtake a predecessor that
  // only exists as an in-memory promise.
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
    createdAt: FINALIZATION_ORDER_SENTINEL,
  });

  const requestEnrollmentGeneration = enrollmentGeneration;
  const deliverEnd = async () => {
    // Order End behind every predecessor for this session — one still IN FLIGHT
    // (tracked by manualPauseTransitionPromise) and one already durably queued.
    const inFlightTransition = manualPauseTransitionPromise;
    const predecessorDelivered = inFlightTransition
      ? await inFlightTransition
      : true;
    // Await the in-flight foreground-activity upload before End (G1b).
    if (foregroundFlush) {
      try {
        await foregroundFlush;
      } catch (error) {
        log.warn("Foreground flush during stop failed", safeErrorForLog(error));
      }
    }
    // Exclude our own durable End row (above) when checking for real predecessors.
    if (!predecessorDelivered || hasPendingEventsForSession(sessionId, eventId)) {
      // A predecessor is queued: leave the durable, sentinel-ordered End and flush
      // the queue in causal order.
      try {
        await syncPendingQueues(true);
      } catch (error) {
        log.warn(
          "Ordered flush during stop failed; End remains durably queued",
          safeErrorForLog(error),
        );
      }
      return;
    }
    try {
      const result = await endSession({
        sessionId,
        activeSeconds,
        idleSeconds,
        reason,
        endedAt,
        eventId,
      });
      // Delivered directly — drop the redundant durable row.
      markPendingEventUploaded(eventId);
      // While End(A) was on the network a concurrent Resume/start may have adopted
      // a newer session B, or a logout/re-enrollment may have changed identity; do
      // not apply A's ended snapshot over B (D3).
      const newerSessionAdopted =
        currentSessionId !== null && currentSessionId !== sessionId;
      if (
        newerSessionAdopted ||
        enrollmentGeneration !== requestEnrollmentGeneration
      ) {
        runtimeStatus.connectionStatus = "online";
        runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
        return;
      }
      syncRuntimeFromSession(result.session);
      applyWorkdayState(result.workday);
      await refreshWorkedTodayTotal();
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    } catch (error) {
      // End is already durably queued (above); leave it for ordered retry.
      if (!syncTimer) {
        syncTimer = setInterval(() => void syncPendingQueues(), 30_000);
      }
      runtimeStatus.connectionStatus = connectionStatusAfterApiFailure(
        apiResponseStatus(error),
      );
      log.warn(
        "Tracking paused locally, but session end could not be synced",
        safeErrorForLog(error),
      );
    }
  };

  // Bound the whole finalization; End (and predecessors, made durable before their
  // own send) are already persisted, so exceeding the deadline is safe — next
  // launch replays them in causal order. A stale continuation that resolves after
  // the deadline is neutralised by the D3 ownership guards inside deliverEnd.
  let deadlineHandle: ReturnType<typeof setTimeout> | null = null;
  const deadlineReached = new Promise<"deadline">((resolve) => {
    deadlineHandle = setTimeout(
      () => resolve("deadline"),
      SHUTDOWN_FINALIZATION_DEADLINE_MS,
    );
  });
  const outcome = await Promise.race([
    deliverEnd().then(() => "done" as const),
    deadlineReached,
  ]);
  if (deadlineHandle) clearTimeout(deadlineHandle);
  if (outcome === "deadline") {
    log.warn(
      "Stop/sign-out finalization exceeded its deadline; End is durably queued for next-launch delivery",
    );
  }
  rebuildTrayMenu();
  return { success: true };
}

async function pauseTracking(
  _options?: string | { requestedMinutes?: number; reason?: string },
) {
  if (!runtimeStatus.enrolled || !hasTrackingSession()) {
    return {
      success: false,
      message: "Start your shift before using Pause.",
    };
  }
  if (unpaidPauseActive || runtimeStatus.trackingPaused) {
    return { success: true, message: "Pause is already active." };
  }

  recalculateWorkedTime();
  unpaidPauseActive = true;
  runtimeStatus.trackingPaused = true;
  invalidateInFlightScreenshotCaptures();
  idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
  eligibleIdleSecondsBeforeCurrentIdle = runtimeStatus.eligibleIdleSeconds;
  idleWallClockStartedAt = Date.now();
  saveTrackingPreferences();
  // Pause is local-first. The employee must never wait for API latency before
  // the timer stops; sendStateEvent persists failed delivery in the local queue.
  void dispatchManualPauseTransition("manual_pause_started", "idle");
  rebuildTrayMenu();
  return {
    success: true,
    message: "Paused. Tracking and screenshots stop until you resume.",
  };
}

async function resumeTracking() {
  if (!runtimeStatus.enrolled) {
    return {
      success: false,
      message: "Enroll this device before starting tracking.",
    };
  }
  // A sign-out or quit in progress owns the lifecycle. Admitting a Resume here
  // would create a new local session and restart accrual while final delivery is
  // still draining, orphaning work the teardown then clears (F3). Reject at this
  // main-process entry point rather than relying on the UI to disable the control.
  if (isSigningOut || isQuitting) {
    return {
      success: false,
      message: "Signing out. Try again once sign-out finishes.",
    };
  }
  const isPaidPause =
    Boolean(currentSessionId) &&
    runtimeStatus.trackingPaused &&
    Boolean(runtimeStatus.paidPauseEndsAt);
  if (isPaidPause && currentSessionId) {
    try {
      const result = await resumePaidPause(currentSessionId);
      syncRuntimeFromSession(result.session);
      applyWorkdayState(result.workday);
      applyPauseState(result.pause);
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data as { message?: string } | undefined)?.message
        : undefined;
      return {
        success: false,
        message:
          message ??
          "Pause could not be resumed. Check the connection and try again.",
      };
    }
    rebuildTrayMenu();
    return { success: true, message: "Tracking resumed." };
  }

  if (unpaidPauseActive && hasTrackingSession()) {
    recalculateWorkedTime();
    unpaidPauseActive = false;
    runtimeStatus.trackingPaused = false;
    idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
    eligibleIdleSecondsBeforeCurrentIdle = runtimeStatus.eligibleIdleSeconds;
    idleWallClockStartedAt = null;
    saveTrackingPreferences();
    // Resume counting locally immediately. Delivery remains ordered behind a
    // still-in-flight/queued pause transition and syncs in the background.
    void dispatchManualPauseTransition("manual_pause_ended", "active");
    rebuildTrayMenu();
    return {
      success: true,
      message: "Tracking resumed.",
    };
  }

  trackingPausedByUser = false;
  waitingForInputAfterIdleSessionClose = false;
  freshSessionStartPromptActive = false;
  if (!hasTrackingSession()) {
    // Pressing Resume is an explicit employee confirmation to start a new
    // work session, whether it is inside or outside the scheduled shift.
    freshSessionStartConfirmed = true;
  }
  runtimeStatus.lastIdleAlert = null;
  runtimeStatus.trackingPaused = false;
  runtimeStatus.paidPauseEndsAt = null;
  runtimeStatus.paidPauseRemainingSeconds = 0;
  clearPaidPauseTimer();
  beginLocalTrackingSession();
  runtimeStatus.trackingStatus = hasTrackingSession() ? "active" : "starting";
  saveTrackingPreferences();
  // Local tracking and five-second checkpoints are already active. API
  // recovery (including historical queue promotion) must not hold the UI.
  void startTrackingAutomatically();
  const success = hasTrackingSession();
  return {
    success,
    message: success
      ? undefined
      : "Khaliduo could not start tracking. Check the backend connection and try again.",
  };
}

async function logoutDevice() {
  // Idempotent: a second sign-out request while one is already draining must not
  // start another Stop or re-run the reset (D6).
  if (isSigningOut) {
    return { success: true };
  }
  const wasEnrolled = runtimeStatus.enrolled;

  // Local-first, synchronous intent change: before ANY network await, stop new
  // accrual and screenshot acquisition. invalidateInFlightScreenshotCaptures()
  // aborts an in-progress capture, and isSigningOut blocks scheduling a new one
  // even though enrollment is briefly still true while final delivery drains.
  // This is why screenshotCaptureBlockReason() short-circuits on isSigningOut:
  // the enrolled-but-stopped screenshot policy must not keep capturing here (D6).
  // Bank the pre-intent interval once before isSigningOut freezes accrual (G3).
  recalculateWorkedTime({ finalCheckpoint: true });
  isSigningOut = true;
  invalidateInFlightScreenshotCaptures();
  trackingPausedByUser = true;
  unpaidPauseActive = false;
  runtimeStatus.trackingPaused = true;

  try {
    if (wasEnrolled) {
      // Stop the session locally and durably record its End first, then make a
      // bounded best-effort attempt to flush already-durable evidence. The local
      // teardown below runs regardless of whether the network flush succeeds, so
      // sign-out never waits on network progress to take effect locally.
      await stopTrackingSession("Employee signed out from this device");
      try {
        await syncPendingQueues(true);
      } catch (error) {
        log.warn("Final sync before sign-out failed", safeErrorForLog(error));
      }
    }
  } finally {
    clearRuntimeTimers();
    inputIntegrityMonitor.stop();
    clearEnrollmentIdentity();
    enrollmentGeneration += 1;
    configureAutoStart(false);
    trackingPausedByUser = false;
    unpaidPauseActive = false;
    manualPauseTransitionPromise = null;
    saveTrackingPreferences();
    currentSessionId = null;
    waitingForInputAfterIdleSessionClose = false;
    freshSessionStartConfirmed = false;
    freshSessionStartPromptActive = false;
    workedTodayBaseSeconds = 0;
    activeCounterDate = null;
    idleSecondsBeforeCurrentIdle = 0;
    eligibleIdleSecondsBeforeCurrentIdle = 0;
    idleWallClockStartedAt = null;
    automaticIdleStartPromise = null;
    automaticIdleFinishPromise = null;
    isFinishingAutomaticIdle = false;
    screenshotQueue = [];
    screenshotWindowEndsAt = null;
    saveScreenshotSchedule(null);
    Object.assign(runtimeStatus, clearedPersonalRuntimeStatus());
    // Enrollment identity is now fully cleared, so the enrolled guard alone keeps
    // capture blocked; release the sign-out gate for the next enrollment.
    isSigningOut = false;
    tray?.setImage(createTrayImage("#b7791f"));
    rebuildTrayMenu();
    showMainWindow();
  }
  return { success: true };
}

async function syncNow() {
  await refreshTrackingConfig();
  await promotePendingLocalTrackingSessions();
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
    if (!runtimeStatus.enrolled || !hasTrackingSession()) {
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
          : unpaidPauseActive
            ? "Khaliduo is currently paused."
            : runtimeStatus.trackingPaused
              ? "Khaliduo is currently paused."
              : "Tracking and screenshots are currently active.",
        detail:
          "Choose whether Khaliduo should keep tracking, hide, or quit completely.",
        buttons: trackingPausedByUser
          ? ["Hide (Keep Paused)", "Resume Tracking & Hide", "Quit Khaliduo"]
          : runtimeStatus.trackingPaused
            ? ["Hide (Keep Paused)", "Resume Tracking & Hide", "Quit Khaliduo"]
            : ["Hide & Keep Tracking", "Pause & Hide", "Quit Khaliduo"],
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

function runtimeStatusPayload() {
  const screenshotBlockReason = screenshotCaptureBlockReason();
  const currentIdleSeconds =
    runtimeStatus.trackingStatus === "idle" &&
    !runtimeStatus.trackingPaused &&
    !unpaidPauseActive
      ? idleDurationAfterThreshold(
          observedIdleSeconds(),
          automaticIdleStartedDuringBreak,
        )
      : 0;
  return {
    ...runtimeStatus,
    currentIdleSeconds,
    screenshotMonitoringEnabled:
      runtimeStatus.enrolled && trackingConfig.screenshot_enabled,
    screenshotCaptureActive: screenshotBlockReason === null,
    powerSource: onAcPower ? "ac" : "battery",
    privacyNotice,
  };
}

function notifyRendererStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("agent:status-changed", runtimeStatusPayload());
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

function startCrashRecoveryWatchdog(attempt: number) {
  if (process.platform !== "win32" || !app.isPackaged || isQuitting) {
    return;
  }
  if (crashRecoveryWatchdog && !crashRecoveryWatchdog.killed) {
    return;
  }

  const watchdogPath = path.join(__dirname, "watchdog.js");
  const child = fork(
    watchdogPath,
    [process.execPath, String(process.pid), String(attempt)],
    {
      execPath: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  crashRecoveryWatchdog = child;
  child.unref();
  child.on("error", (error) => {
    log.warn("Crash recovery watchdog failed", safeErrorForLog(error));
  });
  child.once("exit", (code) => {
    if (crashRecoveryWatchdog !== child) return;
    crashRecoveryWatchdog = null;
    if (crashRecoveryStableTimer) {
      clearTimeout(crashRecoveryStableTimer);
      crashRecoveryStableTimer = null;
    }
    if (!isQuitting) {
      log.warn("Crash recovery watchdog exited unexpectedly", { code });
      crashRecoveryRestartTimer = setTimeout(() => {
        crashRecoveryRestartTimer = null;
        startCrashRecoveryWatchdog(attempt);
      }, 60_000);
    }
  });
  crashRecoveryStableTimer = setTimeout(() => {
    crashRecoveryStableTimer = null;
    if (crashRecoveryWatchdog === child && child.connected) {
      child.send({ type: "stable" });
    }
  }, CRASH_RECOVERY_STABLE_MS);
  crashRecoveryStableTimer.unref?.();
  log.info("Crash recovery watchdog started", { attempt });
}

function stopCrashRecoveryWatchdog() {
  if (crashRecoveryStableTimer) {
    clearTimeout(crashRecoveryStableTimer);
    crashRecoveryStableTimer = null;
  }
  if (crashRecoveryRestartTimer) {
    clearTimeout(crashRecoveryRestartTimer);
    crashRecoveryRestartTimer = null;
  }
  const child = crashRecoveryWatchdog;
  crashRecoveryWatchdog = null;
  if (!child || child.killed) return;
  if (child.connected) {
    child.send({ type: "stop" });
  } else {
    child.kill();
  }
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

type UpdateActionResult = { success: boolean; message?: string };

/**
 * Re-arms the updater after a failure. Without this a single network blip or a
 * locked installer file parked the app on the old build until the next 15-minute
 * tick, and a failure during installation stopped retrying altogether.
 */
function scheduleUpdateRetry(reason: string) {
  if (!app.isPackaged || isInstallingUpdate) {
    return;
  }
  if (updateRetryTimer) clearTimeout(updateRetryTimer);
  consecutiveUpdateFailures += 1;
  // 2, 4, 8, 16 minutes, then a 30-minute floor so a permanently failing
  // machine keeps trying without hammering the update feed.
  const delayMinutes = Math.min(
    30,
    2 ** Math.min(consecutiveUpdateFailures, 4),
  );
  log.info(
    `Khaliduo will retry the update in ${delayMinutes} minute(s) after: ${reason}`,
  );
  updateRetryTimer = setTimeout(
    () => {
      updateRetryTimer = null;
      if (runtimeStatus.updateStatus === "ready") {
        // The download survived; only the installation needs another attempt.
        void installDownloadedUpdate();
        return;
      }
      void checkForUpdates();
    },
    delayMinutes * 60 * 1000,
  );
}

async function checkForUpdates(
  manual = false,
  showErrorDialog = manual,
): Promise<UpdateActionResult> {
  if (!app.isPackaged) {
    const message = "Updates are only available in the installed Khaliduo app.";
    if (manual) {
      await dialog.showMessageBox({
        type: "info",
        title: "Khaliduo Updates",
        message: "Automatic updates run in the installed Khaliduo app.",
        detail: "The development preview does not install updates.",
      });
    }
    return { success: false, message };
  }
  if (isUpdateCheckRunning) {
    return { success: true, message: "An update check is already running." };
  }
  if (
    runtimeStatus.updateStatus === "available" ||
    runtimeStatus.updateStatus === "downloading"
  ) {
    return { success: true, message: "The update is already downloading." };
  }
  if (runtimeStatus.updateStatus === "ready") {
    return { success: true, message: "The update is ready to install." };
  }
  if (runtimeStatus.updateStatus === "installing" || isInstallingUpdate) {
    return { success: true, message: "The update installation has started." };
  }

  manualUpdateCheckRequested = manual;
  isUpdateCheckRunning = true;
  setUpdateStatus("checking", { percent: null });
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (error) {
    setUpdateStatus("error", { percent: null });
    scheduleUpdateRetry("the update check failed");
    log.error("Khaliduo update check failed", safeErrorForLog(error));
    const message = getUserFacingError(
      error,
      "Khaliduo could not check for updates. Check the internet connection and try again.",
    );
    if (manual && showErrorDialog) {
      await showUpdateMessage({
        type: "error",
        title: "Khaliduo Updates",
        message: "Khaliduo could not check for updates.",
        detail:
          "Check the internet connection and try again from the notification-area icon.",
      });
    }
    return { success: false, message };
  } finally {
    isUpdateCheckRunning = false;
    rebuildTrayMenu();
  }
}

async function preserveTrackingBeforeUpdate() {
  try {
    recalculateWorkedTime();
    checkpointActiveLocalTrackingSession(true);
    await flushForegroundActivitySegment();
  } catch (error) {
    log.warn(
      "Could not persist foreground activity before installing the update",
      safeErrorForLog(error),
    );
  }
  if (hasTrackingSession() && runtimeStatus.enrolled) {
    try {
      // Persist the latest counters without ending the work session. After the
      // updater restarts Khaliduo, automatic startup reconnects to this same
      // open session instead of creating a sign-out/sign-in break.
      await heartbeatTick({ refreshMetadata: false });
    } catch (error) {
      log.warn(
        "Could not persist the active session before installing the update",
        safeErrorForLog(error),
      );
    }
  }
  // Keep heartbeat, duration, screenshot, and queue timers alive until Electron
  // actually begins quitting. Some older installers returned from
  // quitAndInstall without closing the app, which left a visible employee app
  // running but silently stopped all tracking.
}

function clearUpdateInstallRecoveryTimer() {
  if (!updateInstallRecoveryTimer) return;
  clearTimeout(updateInstallRecoveryTimer);
  updateInstallRecoveryTimer = null;
}

function recoverFromFailedUpdateInstall(reason: string) {
  clearUpdateInstallRecoveryTimer();
  isInstallingUpdate = false;
  isQuitting = false;
  quitNotificationSent = false;
  setUpdateStatus("ready", {
    version: runtimeStatus.updateVersion,
    percent: 100,
  });
  if (hasTrackingSession() && runtimeStatus.enrolled) {
    startTimers();
  }
  updateDisplaySleepBlocker();
  startCrashRecoveryWatchdog(crashRecoveryAttempt(process.argv));
  startUpdateCheckSchedule();
  scheduleUpdateRetry(reason);
}

async function installDownloadedUpdate(): Promise<UpdateActionResult> {
  if (isInstallingUpdate || runtimeStatus.updateStatus === "installing") {
    return { success: true, message: "The update installation has started." };
  }
  if (runtimeStatus.updateStatus !== "ready") {
    return {
      success: false,
      message:
        runtimeStatus.updateStatus === "downloading" ||
        runtimeStatus.updateStatus === "available"
          ? "The update is still downloading."
          : "No downloaded update is ready to install.",
    };
  }
  isInstallingUpdate = true;
  setUpdateStatus("installing", {
    version: runtimeStatus.updateVersion,
    percent: 100,
  });
  setUpdateAttention(false);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (initialUpdateCheckTimer) clearTimeout(initialUpdateCheckTimer);
  if (updateRetryTimer) {
    clearTimeout(updateRetryTimer);
    updateRetryTimer = null;
  }
  log.info(
    `Installing Khaliduo update ${runtimeStatus.updateVersion ?? ""} automatically`,
  );
  await preserveTrackingBeforeUpdate();
  isQuitting = true;
  quitNotificationSent = true;
  // Arm recovery before quitAndInstall. Electron can emit before-quit inside
  // that call, and clearing this watchdog there left the still-visible app on
  // "Installing update" forever when NSIS failed to take over.
  clearUpdateInstallRecoveryTimer();
  updateInstallRecoveryTimer = setTimeout(() => {
    if (!isInstallingUpdate || !isQuitting) return;
    log.error(
      "The downloaded update did not close Khaliduo; tracking has been restored",
    );
    recoverFromFailedUpdateInstall(
      "the downloaded update did not close the application",
    );
  }, UPDATE_INSTALL_RECOVERY_MS);
  try {
    autoUpdater.quitAndInstall(true, true);
    return { success: true };
  } catch (error) {
    recoverFromFailedUpdateInstall(
      "the downloaded update could not be installed",
    );
    log.error(
      "Could not launch the downloaded update installer",
      safeErrorForLog(error),
    );
    return {
      success: false,
      message: getUserFacingError(error, "Could not install the update."),
    };
  }
}

/**
 * One scheduled pass of the updater. An installer that finished downloading but
 * failed to launch must be retried on the next tick, otherwise the app sits on
 * "ready" forever and every later check short-circuits on that same status.
 */
function runScheduledUpdatePass() {
  if (runtimeStatus.updateStatus === "ready" && !isInstallingUpdate) {
    void installDownloadedUpdate();
    return;
  }
  void checkForUpdates();
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
  // Every release publishes the same KhaliduoSetup.exe file name, so the old and
  // new block maps live at one URL and a differential download compares a build
  // against itself. Always fetch the full installer instead.
  autoUpdater.disableDifferentialDownload = true;

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus("checking", { percent: null });
  });
  autoUpdater.on("update-available", (info) => {
    setUpdateStatus("available", { version: info.version, percent: 0 });
    log.info(
      `Khaliduo update ${info.version} is downloading silently in the background`,
    );
  });
  autoUpdater.on("download-progress", (progress) => {
    setUpdateStatus("downloading", {
      version: runtimeStatus.updateVersion,
      percent: progress.percent,
    });
  });
  autoUpdater.on("update-not-available", async () => {
    setUpdateStatus("up-to-date", { version: null, percent: null });
    consecutiveUpdateFailures = 0;
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
  autoUpdater.on("update-downloaded", (event) => {
    setUpdateStatus("ready", { version: event.version, percent: 100 });
    consecutiveUpdateFailures = 0;
    log.info(
      `Khaliduo update ${event.version} is ready; automatic installation is starting now`,
    );
    void installDownloadedUpdate().then((result) => {
      if (!result.success) {
        log.error(
          "Automatic update installation could not start",
          result.message,
        );
      }
    });
  });
  autoUpdater.on("error", (error) => {
    const failedDuringInstall = isInstallingUpdate || isQuitting;
    if (failedDuringInstall) {
      recoverFromFailedUpdateInstall(
        "the updater reported an installation error",
      );
    } else {
      isInstallingUpdate = false;
      setUpdateStatus("error", { percent: null });
      scheduleUpdateRetry("the updater reported an error");
    }
    manualUpdateCheckRequested = false;
    log.error("Khaliduo automatic update error", safeErrorForLog(error));
  });

  initialUpdateCheckTimer = setTimeout(runScheduledUpdatePass, 1_000);
  startUpdateCheckSchedule();
}

/**
 * (Re)arms the periodic update pass. Starting an installation clears it because
 * the app is about to exit; if that installation never happens the schedule has
 * to come back, or the device silently stops looking for updates.
 */
function startUpdateCheckSchedule() {
  if (!app.isPackaged) {
    return;
  }
  const configuredInterval = Number.parseInt(
    process.env.UPDATE_CHECK_INTERVAL_MINUTES ?? "15",
    10,
  );
  const updateCheckIntervalMinutes = Number.isFinite(configuredInterval)
    ? Math.max(5, Math.min(1_440, configuredInterval))
    : 15;
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = setInterval(
    runScheduledUpdatePass,
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
    invalidateInFlightScreenshotCaptures();
    log.info("Battery power detected; screenshot capture is paused");
  });
  powerMonitor.on("lock-screen", () => {
    // Physical lock state is always recorded, independent of work intent (D5).
    screenLocked = true;
    recalculateWorkedTime();
    invalidateInFlightScreenshotCaptures();
    if (waitingForInputAfterIdleSessionClose) {
      runtimeStatus.trackingStatus = "locked";
    } else {
      void sendStateEvent("screen_locked", "locked");
    }
    log.info("Windows lock detected");
  });

  powerMonitor.on("unlock-screen", () => {
    // Always clear the physical lock flag first — even when work stays stopped —
    // so screenshot eligibility and displayed state stop reporting "locked" after
    // the machine is physically unlocked (D5).
    screenLocked = false;
    lastDurationTickAt = Date.now();
    idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
    if (
      !physicalResumeShouldResumeWork({
        manualPauseActive: unpaidPauseActive,
        trackingStoppedByUser: trackingPausedByUser,
      })
    ) {
      // The employee explicitly paused/stopped. Unlocking the machine must not
      // post an active transition or resume accrual — the pause intent outlives
      // the physical lock state. Restore the resting work-intent status so the UI
      // no longer shows "locked", then let the employee resume work from the UI.
      runtimeStatus.trackingStatus = trackingPausedByUser ? "paused" : "idle";
      notifyRendererStatus();
      rebuildTrayMenu();
      log.info("Windows unlock detected while paused; tracking stays paused");
      return;
    }
    if (!resumeAfterIdleSessionClose()) {
      void sendStateEvent("screen_unlocked", "active");
    }
    log.info("Windows unlock detected");
  });

  powerMonitor.on("suspend", () => {
    // Physical sleep state is always recorded, independent of work intent (D5).
    systemSleeping = true;
    recalculateWorkedTime();
    invalidateInFlightScreenshotCaptures();
    if (waitingForInputAfterIdleSessionClose) {
      runtimeStatus.trackingStatus = "sleeping";
    } else {
      void sendStateEvent("system_suspended", "sleeping");
    }
    log.info("System suspend detected");
  });

  powerMonitor.on("resume", () => {
    // Always clear the physical sleep flag first, even when work stays stopped, so
    // eligibility and displayed state recover after the machine wakes (D5).
    systemSleeping = false;
    lastDurationTickAt = Date.now();
    idleSecondsBeforeCurrentIdle = runtimeStatus.idleSeconds;
    if (
      !physicalResumeShouldResumeWork({
        manualPauseActive: unpaidPauseActive,
        trackingStoppedByUser: trackingPausedByUser,
      })
    ) {
      // Resuming from sleep must not undo an explicit pause/stop; keep the
      // paused intent but restore the resting status so the UI stops showing
      // "sleeping", and let the employee resume work from the UI.
      runtimeStatus.trackingStatus = trackingPausedByUser ? "paused" : "idle";
      notifyRendererStatus();
      rebuildTrayMenu();
      log.info("System resume detected while paused; tracking stays paused");
      return;
    }
    if (!resumeAfterIdleSessionClose()) {
      void sendStateEvent("system_resumed", "active");
    }
    log.info("System resume detected");
  });
}

// Last-resort visibility: without these, an unhandled rejection during startup
// leaves the process alive but broken — no tray, no tracking — while still
// holding the single-instance lock, so relaunching silently fails. Log it so
// the failure is diagnosable instead of invisible.
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception in the main process", safeErrorForLog(error));
});
process.on("unhandledRejection", (reason) => {
  log.error(
    "Unhandled promise rejection in the main process",
    safeErrorForLog(reason),
  );
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", (_event, commandLine) => {
  if (!isCrashRecoveryLaunch(commandLine)) {
    showMainWindow();
  }
});

app.on("before-quit", (event) => {
  isQuitting = true;
  stopCrashRecoveryWatchdog();
  updateDisplaySleepBlocker();
  if (shouldClearInstallRecoveryOnBeforeQuit(isInstallingUpdate)) {
    clearUpdateInstallRecoveryTimer();
  }
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (initialUpdateCheckTimer) clearTimeout(initialUpdateCheckTimer);

  if (quitNotificationSent) {
    clearRuntimeTimers();
    return;
  }

  event.preventDefault();
  quitNotificationSent = true;
  // Bank the pre-intent interval once before isQuitting freezes accrual (G3).
  recalculateWorkedTime({ finalCheckpoint: true });
  const sessionId = currentSessionId;
  const eventId = randomUUID();
  const endedAt = new Date().toISOString();
  closeActiveLocalTrackingSession(endedAt, "app_quit");
  inputIntegrityMonitor.stop();
  const activeSeconds = runtimeStatus.activeSeconds;
  const idleSeconds = runtimeStatus.idleSeconds;
  // Snapshot the in-flight transition predecessors BEFORE clearRuntimeTimers so
  // Quit can serialize End behind them (clearRuntimeTimers does not touch these,
  // but capturing first keeps the ordering intent explicit).
  const quitPredecessors = [
    manualPauseTransitionPromise,
    automaticIdleStartPromise,
    automaticIdleFinishPromise,
  ].filter((promise): promise is Promise<boolean> => Boolean(promise));
  clearRuntimeTimers();
  // clearRuntimeTimers initiates the buffered foreground-activity flush. That
  // upload posts a foreground_activity event to the SAME /events endpoint as End,
  // so End must be ordered behind it too — otherwise a closed session drops the
  // foreground evidence. Capture the promise the teardown just started (F1).
  const foregroundFlush = pendingForegroundActivityFlush;
  pendingForegroundActivityFlush = null;
  currentSessionId = null;
  runtimeStatus.sessionStartedAt = null;
  runtimeStatus.trackingStatus = "offline";

  // Durability BEFORE the predecessor/foreground waits: persist End to the
  // durable outbox now, so a process kill during those awaits still closes the
  // session on next launch (O1). The sentinel created_at makes it sort LAST in
  // this session's group, so a predecessor's failure row (enqueued later, with a
  // real timestamp) still delivers first — durability without order inversion.
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
      createdAt: FINALIZATION_ORDER_SENTINEL,
    });
  }

  // Quit shares the ordered-finalization contract with Stop/sign-out: End must
  // never reach the backend ahead of an earlier manual-pause / automatic-idle
  // transition or a queued predecessor for this session. The End is already
  // durable (above); after the predecessors and foreground upload settle, it is
  // either sent directly (removing the now-redundant durable row) or left in the
  // queue for ordered replay behind a still-pending predecessor (D1).
  const deliverEnd = sessionId
    ? (async () => {
        let predecessorsDelivered = true;
        for (const predecessor of quitPredecessors) {
          if (!(await predecessor)) {
            predecessorsDelivered = false;
          }
        }
        // Await the in-flight foreground-activity upload before End. It resolves
        // once the event is delivered (now durable server-side, ordered before
        // End) or, on failure, once it has enqueued its own durable row — which
        // hasPendingEventsForSession then detects so End is queued behind it.
        if (foregroundFlush) {
          try {
            await foregroundFlush;
          } catch (error) {
            log.warn(
              "Foreground flush during quit failed",
              safeErrorForLog(error),
            );
          }
        }
        // `hasPendingEventsForSession(sessionId, eventId)` excludes our own
        // durable End row, so it reports only genuine predecessors (e.g. a failed
        // Pause that queued behind us).
        if (
          !predecessorsDelivered ||
          hasPendingEventsForSession(sessionId, eventId)
        ) {
          // A predecessor is queued: leave the durable End in place — it is
          // already ordered last — and flush the queue in causal order.
          try {
            await syncPendingQueues(true);
          } catch (error) {
            log.warn(
              "Final ordered flush during quit failed; End remains durably queued",
              safeErrorForLog(error),
            );
          }
          return;
        }
        try {
          await endSession({
            sessionId,
            activeSeconds,
            idleSeconds,
            reason: "Khaliduo quit",
            endedAt,
            eventId,
          });
          // Delivered directly; drop the now-redundant durable row so it is not
          // re-sent on next launch (the server would dedupe by event_id anyway).
          markPendingEventUploaded(eventId);
        } catch (error) {
          // Direct send failed, but End is already durably queued (with correct
          // ordering) — leave it for retry rather than enqueuing a duplicate.
          log.warn(
            "Failed to close the work session before quitting; End remains durably queued",
            safeErrorForLog(error),
          );
        }
      })()
    : Promise.resolve();

  // Bound the whole finalization: the End is already durable, so if predecessors
  // or the queue flush hang past the deadline we still exit and let next launch
  // deliver in order, rather than blocking quit indefinitely. Promise.race cannot
  // cancel the losing wait, but the process exits immediately after, so the
  // abandoned continuation has no lasting effect.
  const finishSession = (async () => {
    let deadlineHandle: ReturnType<typeof setTimeout> | null = null;
    const deadlineReached = new Promise<"deadline">((resolve) => {
      deadlineHandle = setTimeout(
        () => resolve("deadline"),
        SHUTDOWN_FINALIZATION_DEADLINE_MS,
      );
    });
    const outcome = await Promise.race([
      deliverEnd.then(() => "done" as const),
      deadlineReached,
    ]);
    if (deadlineHandle) clearTimeout(deadlineHandle);
    if (outcome === "deadline") {
      log.warn(
        "Shutdown finalization exceeded its deadline; End is durably queued for next-launch delivery",
      );
    }
  })();

  void finishSession.finally(() => {
    app.quit();
  });
});

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.kentconsultancy.khaliduo");
  }
  log.initialize();
  log.info("Khaliduo agent starting");
  try {
    const recoveryAttempt = crashRecoveryAttempt(process.argv);
    const launchedForCrashRecovery = isCrashRecoveryLaunch(process.argv);
    startCrashRecoveryWatchdog(recoveryAttempt);
    await initializeLocalDatabase();
    hydrateIdentityStatus();
    // Restart-safe cleanup: if a previous run crashed after marking a screenshot
    // terminal but before deleting its file, remove the orphan now.
    cleanupTerminalScreenshotFiles();
    const launchedByWindowsStartup =
      process.argv.includes("--autostart") || process.argv.includes("--hidden");
    const launchedAfterSilentUpdate =
      process.argv.includes("--updated") || process.argv.includes("--force-run");
    const launchedInBackground =
      launchedByWindowsStartup || launchedAfterSilentUpdate || launchedForCrashRecovery;
    // Load persisted intent and decide whether a crash-recovery relaunch has
    // anything to recover. A Windows-login launch resets a saved pause; a crash
    // recovery relaunch preserves the employee's saved Stop/Pause so the watchdog
    // never silently resumes work that was intentionally ended.
    const crashRecoveryHasWork = loadLaunchTrackingPreferences({
      launchedByWindowsStartup,
      launchedForCrashRecovery,
    });
    if (launchedForCrashRecovery && !crashRecoveryHasWork) {
      // Not enrolled (e.g. after logout) or explicitly stopped: nothing to
      // recover, and resuming would be wrong. Exit so no hidden process lingers.
      log.info(
        "Crash recovery found nothing to recover (not enrolled or intentionally stopped)",
      );
      stopCrashRecoveryWatchdog();
      app.exit(0);
      return;
    }
    // Otherwise continue into normal startup, which consults the server and
    // recovers BOTH interrupted online sessions (no open local row) and offline
    // local-only sessions — instead of exiting before the server is queried.
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
    if (!launchedInBackground) {
      showMainWindow();
    }
    if (runtimeStatus.enrolled) {
      // Screenshot monitoring is an independent company policy and always runs
      // for an enrolled device. Work tracking only auto-starts when it is
      // genuinely expected — this respects a preserved Pause (unpaidPauseActive)
      // on crash recovery, not just an explicit Stop.
      startScreenshotMonitoring();
      if (automaticTrackingIsExpected()) {
        await startTrackingAutomatically();
      }
    }
    rebuildTrayMenu();
  } catch (error) {
    // Never linger as an invisible, lock-holding zombie. Exit non-zero so the
    // single-instance lock is released and the crash-recovery watchdog can
    // relaunch the agent instead of the user seeing a silently dead process.
    log.error("Khaliduo agent failed to start", safeErrorForLog(error));
    app.exit(1);
  }
});

app.on("window-all-closed", () => undefined);

ipcMain.handle("agent:get-status", () => runtimeStatusPayload());

ipcMain.handle("agent:sync-now", async () => {
  await syncNow();
  notifyRendererStatus();
  return { success: runtimeStatus.connectionStatus === "online" };
});

ipcMain.on("agent:set-idle-alert-attention", (_, active: boolean) => {
  setIdleAlertAttention(Boolean(active));
});

ipcMain.on("agent:set-update-attention", (_, active: boolean) => {
  setUpdateAttention(Boolean(active));
});

ipcMain.handle("agent:check-for-updates", async () => {
  try {
    return await checkForUpdates(true, false);
  } catch (error) {
    log.error("Manual update check failed", safeErrorForLog(error));
    return {
      success: false,
      message: getUserFacingError(error, "Could not check for updates."),
    };
  }
});

ipcMain.handle("agent:install-update", async () => {
  try {
    return await installDownloadedUpdate();
  } catch (error) {
    log.error("Update installation failed", safeErrorForLog(error));
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
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return { success: false, message: "Email and password are required." };
    }

    // Admission control: a sign-out that is still draining its final End/queue
    // owns the identity teardown. Persisting a NEW enrollment now would be
    // erased by that logout's cleanup finally (G2). Reject before any network
    // call can persist credentials; the user can retry once sign-out finishes.
    if (isSigningOut) {
      return {
        success: false,
        message:
          "Signing out of the previous account. Try again once sign-out finishes.",
      };
    }

    // Exclusive-ownership admission (I1): only one enrollment operation may be in
    // flight. A second overlapping request is rejected here — before it makes any
    // network call or can persist credentials — rather than being allowed to race
    // the first to persistence. `enrollmentGeneration` alone is insufficient: it
    // is shared by every request until activation, so two requests could both
    // pass a generation-only check and both write. The reservation below is the
    // exclusive gate; the generation check remains for identity-change detection.
    if (activeEnrollmentToken !== null) {
      return {
        success: false,
        message: "A sign-in is already in progress. Please wait for it to finish.",
      };
    }
    const enrollmentToken = ++enrollmentOperationSeq;
    activeEnrollmentToken = enrollmentToken;
    const enrollmentIdentityGeneration = enrollmentGeneration;
    // Ownership holds only while THIS operation is the reserved one, the identity
    // generation it began under is unchanged, and no sign-out/quit has started.
    // Enforced inside the API helper right before it writes credentials (H1),
    // again before activation, and on every error path (I2).
    const stillOwnsEnrollment = () =>
      activeEnrollmentToken === enrollmentToken &&
      enrollmentGeneration === enrollmentIdentityGeneration &&
      !isSigningOut &&
      !isQuitting;

    try {
      let identity: StoredIdentity;
      try {
        identity = await enrollDeviceWithCredentials(
          email,
          password,
          app.getVersion(),
          stillOwnsEnrollment,
        );
      } catch (error) {
        if ((error as { code?: string })?.code === "ENROLLMENT_SUPERSEDED") {
          // Not a failure of the enrollment itself — a concurrent sign-out or
          // newer enrollment invalidated it. Report a benign, retryable result
          // without flipping the tray/status into the error state.
          return {
            success: false,
            message:
              "Sign-in was interrupted by a sign-out. Try again once it finishes.",
          };
        }
        throw error;
      }

      // Persistence happened, but a logout/quit may have started in the narrow
      // window between the ownership check and here. Do not adopt a stale
      // identity, and do not report success the teardown would then erase.
      if (!stillOwnsEnrollment()) {
        return {
          success: false,
          message:
            "Sign-in was interrupted by a sign-out. Try again once it finishes.",
        };
      }
      await activateEnrolledDevice(identity);
      return { success: true };
    } catch (error) {
      // Ownership check on the error path too (I2): an obsolete HTTP failure from
      // a request a later logout/quit/enrollment invalidated must not mutate the
      // current (e.g. signed-out) runtime/tray. Return a benign cancellation and
      // leave current state untouched; only a failure of the operation that still
      // owns enrollment surfaces the ordinary error UI.
      if (!stillOwnsEnrollment()) {
        return {
          success: false,
          message:
            "Sign-in was interrupted before it completed. Try again.",
        };
      }
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
    } finally {
      // Release exclusive ownership so the next enrollment can proceed. Only the
      // reserving operation clears it, so a superseding operation's token is left
      // intact.
      if (activeEnrollmentToken === enrollmentToken) {
        activeEnrollmentToken = null;
      }
    }
  },
);

ipcMain.handle("agent:pause-tracking", (_event, options) =>
  pauseTracking(options),
);

ipcMain.handle("agent:resume-tracking", () => resumeTracking());

ipcMain.handle("agent:resume-automatic-idle", () => resumeAutomaticIdle());

ipcMain.handle("agent:confirm-tracking-start", () =>
  confirmFreshSessionStart(),
);

ipcMain.handle("agent:decline-tracking-start", () =>
  declineFreshSessionStart(),
);

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
    log.error("Employee dashboard handoff failed", safeErrorForLog(error));
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
      try {
        const image = await downloadAgentScreenshot(screenshot.id);
        data.push({
          id: screenshot.id,
          capturedAt: screenshot.captured_at,
          displayName: screenshot.display_name,
          dataUrl: `data:${image.mimeType};base64,${image.content.toString("base64")}`,
        });
        // The home panel renders only the latest capture. Avoid downloading
        // three full images that it never displays.
        break;
      } catch (error) {
        // A legacy database row may outlive its local image. Try the next
        // recent capture instead of failing the entire panel.
        if (apiResponseStatus(error) === 404) continue;
        throw error;
      }
    }
    runtimeStatus.connectionStatus = "online";
    runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
    notifyRendererStatus();
    rebuildTrayMenu();
    return { success: true, screenshots: data };
  } catch (error) {
    runtimeStatus.connectionStatus = connectionStatusAfterApiFailure(
      apiResponseStatus(error),
    );
    notifyRendererStatus();
    rebuildTrayMenu();
    log.error("Recent screenshots could not be loaded", safeErrorForLog(error));
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
    runtimeStatus.connectionStatus = connectionStatusAfterApiFailure(
      apiResponseStatus(error),
    );
    rebuildTrayMenu();
    log.error("Task selection failed", safeErrorForLog(error));
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
      log.error("Task creation failed", safeErrorForLog(error));
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
      log.error("Task stage update failed", safeErrorForLog(error));
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
      log.error("Task checklist creation failed", safeErrorForLog(error));
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
      log.error("Task checklist update failed", safeErrorForLog(error));
      return {
        success: false,
        message: getUserFacingError(error, "Checklist update failed."),
      };
    }
  },
);

ipcMain.handle(
  "agent:delete-task-checklist-items",
  async (_, taskId: string, itemIds: string[]) => {
    try {
      const task = runtimeStatus.tasks.find((item) => item.id === taskId);
      if (!task?.canUpdateStage) {
        return {
          success: false,
          message: "Only the primary assignee can edit this task checklist.",
        };
      }
      const uniqueItemIds = [...new Set(itemIds)].filter((itemId) =>
        task.checklist.some((item) => item.id === itemId),
      );
      if (uniqueItemIds.length === 0) {
        return {
          success: false,
          message: "Select at least one checklist item.",
        };
      }
      for (const itemId of uniqueItemIds) {
        await deleteAgentTaskChecklistItem(taskId, itemId);
      }
      await refreshTasks();
      return { success: true, status: runtimeStatusPayload() };
    } catch (error) {
      log.error("Task checklist deletion failed", safeErrorForLog(error));
      return {
        success: false,
        message: getUserFacingError(error, "Checklist deletion failed."),
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
      runtimeStatus.timeAdjustmentRequests = [
        request,
        ...runtimeStatus.timeAdjustmentRequests.filter(
          (existing) => existing.id !== request.id,
        ),
      ].slice(0, 10);
      if (
        request.request_type === "idle_time" &&
        request.work_session_id &&
        request.source_start_at &&
        request.source_end_at
      ) {
        const requestedSeconds = Math.max(0, request.requested_minutes * 60);
        runtimeStatus.idleRequestPeriods = runtimeStatus.idleRequestPeriods
          .map((period) =>
            period.work_session_id === request.work_session_id &&
            period.started_at === request.source_start_at &&
            period.ended_at === request.source_end_at
              ? {
                  ...period,
                  available_seconds: Math.max(
                    0,
                    period.available_seconds - requestedSeconds,
                  ),
                }
              : period,
          )
          .filter((period) => period.available_seconds >= 60);
      }
      runtimeStatus.connectionStatus = "online";
      runtimeStatus.lastSuccessfulSyncAt = new Date().toISOString();
      rebuildTrayMenu();
      const status = runtimeStatusPayload();
      void Promise.all([
        refreshTimeAdjustmentRequests(),
        refreshTrackingConfig(),
        refreshWorkedTodayTotal(),
      ]).then(() => {
        rebuildTrayMenu();
        notifyRendererStatus();
      });
      return { success: true, request, status };
    } catch (error) {
      runtimeStatus.connectionStatus = connectionStatusAfterApiFailure(
        apiResponseStatus(error),
      );
      rebuildTrayMenu();
      log.error("Time adjustment request failed", safeErrorForLog(error));
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
      runtimeStatus.connectionStatus = connectionStatusAfterApiFailure(
        apiResponseStatus(error),
      );
      rebuildTrayMenu();
      log.error("Holiday request failed", safeErrorForLog(error));
      return {
        success: false,
        message: getUserFacingError(error, "Holiday request failed."),
      };
    }
  },
);
