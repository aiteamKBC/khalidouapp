import DesktopLogin from "./DesktopLogin";
import { NativeWindowControls } from "./NativeWindowControls";
import { createPortal } from "react-dom";
import { useAppearance } from "./useAppearance";
import { useDialogTheme } from "./useDialogTheme";
import "./idle-dialog.css";
import { useQuoteReminders } from "./useQuoteReminders";
import "./quote-reminders.css";
import { TrackerFrame } from "./tracker-ui/TrackerWorkspace";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import Swal, { type SweetAlertResult } from "sweetalert2";
import type {
  AgentProject,
  AgentStatus,
  AgentTask,
  IdleAlert,
  MeetingSummary,
  RecentScreenshot,
  WorkdayTimeline,
} from "./types/electron";
import {
  TIMELINE_LABELS,
  timelineIntervalsForDisplay,
  timelineIntervalPresentation,
  timelineDisplayType,
  workdayTimingState,
} from "./timelinePresentation";
import {
  idleRequestKeyForIdleStart,
  requestableIdleMinutes,
  totalRequestableIdleMinutes,
} from "./idleRequests";
import { OperationTimeoutError, withOperationTimeout } from "./promiseTimeout";
import { createStatusReader } from "./statusReader";
import { toValidDate } from "./safeDate";
import { ShiftRescheduleCard } from "./ShiftRescheduleCard";
import { breakStatusAt, todaysBreaks } from "./breakSchedule";
import {
  screenshotSyncLabel,
  shouldReloadScreenshotsAfterRecovery,
} from "./screenshotRecovery";
import {
  mainTimerSeconds,
  paidBreakSecondsToday,
  reconciledNormalTodaySeconds,
} from "./timerDisplay";
import "sweetalert2/dist/sweetalert2.min.css";
import "./App.css";
import {
  ReaddyHome,
  ReaddyTaskRequest,
  ReaddyManualRequest,
} from "./ReaddyDesktop";
import "./ReaddyDesktop.css";
import { NativeInsights, NativeShiftPage, ScreenshotsPage, WorkspacePageHeader } from "./WorkspacePages";
import { TrackerIcon } from "./tracker-ui/TrackerIcon";
import "./workspace-pages.css";
import "./requests-page.css";
import "./meetings-page.css";

const fallbackStatus: AgentStatus = {
  enrolled: false,
  employeeName: "Not enrolled",
  employeeEmail: null,
  employeeAvatarUrl: null,
  deviceName: "Windows device",
  deviceId: null,
  macAddress: null,
  localIpAddress: null,
  trackingStatus: "starting",
  trackingPaused: false,
  sessionStartedAt: null,
  workedTodaySeconds: 0,
  activeSeconds: 0,
  idleSeconds: 0,
  currentIdleSeconds: 0,
  eligibleIdleSeconds: 0,
  paidPauseEndsAt: null,
  paidPauseRemainingSeconds: 0,
  paidPauseBalanceRemainingSeconds: null,
  connectionStatus: "offline",
  lastScreenshotAt: null,
  screenshotMonitoringEnabled: true,
  screenshotCaptureActive: false,
  powerSource: "ac",
  lastSuccessfulSyncAt: null,
  agentVersion: "1.0.0",
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
  recentTasks: [],
  todayTimeline: null,
  idleRequestPeriods: [],
  lastIdleAlert: null,
  locallyEndedIdleAt: null,
  updateStatus: "idle",
  updateVersion: null,
  updatePercent: null,
  activeMeeting: null,
  meetings: [],
  breakBank: null,
  privacyNotice:
    "While work tracking is active, Khaliduo records the foreground application name and, for supported browsers, the website domain. Company policy may also capture periodic workplace screenshots while this enrolled device is active, unlocked, and connected to AC power. Full URLs, page titles, typed text, passwords, webcam, microphone, and personal files are not recorded.",
};

const TRACKABLE_TASK_STAGES = new Set(["backlog", "assigned", "in_progress"]);
const THEME_STORAGE_KEY = "khaliduo-theme";
const TRACKING_CONTROL_TIMEOUT_MS = 20_000;

type IdleRequestOption = {
  key: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  availableSeconds: number;
  projectName: string | null;
  taskName: string | null;
};

function initialTheme(): "light" | "dark" {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

/** "12m" or "1h 05m" for the saved-break counter. */
function formatSavedMinutes(totalSeconds: number) {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((safeSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

type KIconName =
  | "timer"
  | "tasks"
  | "more"
  | "dashboard"
  | "calendar"
  | "briefcase"
  | "worked"
  | "idle"
  | "break"
  | "manual"
  | "locked"
  | "sleeping"
  | "untracked"
  | "settings"
  | "meeting"
  | "update"
  | "sun"
  | "moon";

function KIcon({
  name,
  className = "",
}: {
  name: KIconName;
  className?: string;
}) {
  const paths: Record<KIconName, ReactNode> = {
    timer: (
      <>
        <path d="M12 7v5l3 2" />
        <path d="M9 2h6" />
        <path d="M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
      </>
    ),
    tasks: (
      <>
        <path d="m5 12 3 3 5-6" />
        <path d="M4 5h16" />
        <path d="M4 19h16" />
      </>
    ),
    more: (
      <>
        <path d="M12 6h.01" />
        <path d="M12 12h.01" />
        <path d="M12 18h.01" />
      </>
    ),
    dashboard: (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M8 15v-4" />
        <path d="M12 15V9" />
        <path d="M16 15v-2" />
      </>
    ),
    calendar: (
      <>
        <path d="M6 3v3M18 3v3" />
        <path d="M4 7h16v13H4z" />
        <path d="M4 11h16" />
        <path d="m9 15 2 2 4-4" />
      </>
    ),
    briefcase: (
      <>
        <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
        <path d="M4 8h16v10.2A1.8 1.8 0 0 1 18.2 20H5.8A1.8 1.8 0 0 1 4 18.2Z" />
        <path d="M4 12h16" />
        <path d="M10 12v2h4v-2" />
      </>
    ),
    meeting: (
      <>
        <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h9A1.5 1.5 0 0 1 15 7.5v9A1.5 1.5 0 0 1 13.5 18h-9A1.5 1.5 0 0 1 3 16.5Z" />
        <path d="M15 10.5 21 7v10l-6-3.5" />
      </>
    ),
    worked: (
      <>
        <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
        <path d="M4 8h16v10.2A1.8 1.8 0 0 1 18.2 20H5.8A1.8 1.8 0 0 1 4 18.2Z" />
        <path d="M8 13h8" />
      </>
    ),
    idle: (
      <>
        <path d="M12 7v5" />
        <path d="M8 17h8" />
        <path d="M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
      </>
    ),
    break: (
      <>
        <path d="M5 8h11v6a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5Z" />
        <path d="M16 10h1a3 3 0 0 1 0 6h-2" />
        <path d="M8 3v2M12 3v2" />
      </>
    ),
    manual: (
      <>
        <path d="M9 12l2 2 4-5" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
    locked: (
      <>
        <path d="M7 11V8a5 5 0 0 1 10 0v3" />
        <path d="M6 11h12v9H6z" />
      </>
    ),
    sleeping: (
      <>
        <path d="M18 15.5A7 7 0 0 1 8.5 6a7 7 0 1 0 9.5 9.5Z" />
        <path d="M15 4h4l-4 5h4" />
      </>
    ),
    untracked: (
      <>
        <path d="M5 5 19 19" />
        <path d="M8.5 8.5A8.5 8.5 0 0 1 20 10" />
        <path d="M4 10a8.5 8.5 0 0 1 1.3-2.8" />
        <path d="M7 14a5 5 0 0 1 7.4-4.4" />
        <path d="M10 18a2.8 2.8 0 0 1 4.2-2.4" />
      </>
    ),
    settings: (
      <>
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    update: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M4 17v-5h5" />
        <path d="M6.1 8.2A7 7 0 0 1 18.7 7L20 12" />
        <path d="M17.9 15.8A7 7 0 0 1 5.3 17L4 12" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    moon: <path d="M20 15.2A8 8 0 0 1 8.8 4a8 8 0 1 0 11.2 11.2Z" />,
  };

  return (
    <svg
      className={`k-icon ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

// An IPC call can REJECT (main-process error / preload failure) rather than
// resolving a {success:false} result. Handlers must surface that instead of
// swallowing it in a catch-less try/finally, which would clear the spinner but
// show no error and silently drop the user's action.
function ipcErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatTimestamp(value: string | null) {
  const date = toValidDate(value);
  if (!date) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatClock(value: string | null, timezone: string) {
  const date = toValidDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(date);
}

function formatTimelineStart(timeline: WorkdayTimeline) {
  if (!timeline.continued_from_previous_day) {
    return formatClock(timeline.first_started_at, timeline.timezone);
  }
  const originalStart =
    timeline.continued_session_started_at ?? timeline.first_started_at;
  const startedAt = toValidDate(originalStart);
  if (!startedAt) {
    return "Continued from previous day";
  }
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: timeline.timezone,
  }).format(startedAt);
  return `Continued from ${day}, ${formatClock(originalStart, timeline.timezone)}`;
}

function localDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeToMinutes(value: string | null | undefined) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function formatScheduledTime(value: string | null | undefined) {
  const minutes = timeToMinutes(value);
  if (minutes === null) return "Not configured";
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function localMinutesAt(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const hours = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minutes = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );
  return hours * 60 + minutes;
}

function localDateAt(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function weekdayIndex(dateKey: string) {
  const day = new Date(`${dateKey}T12:00:00`).getDay();
  return (day + 6) % 7;
}

function currentScheduleBucket(
  policy: AgentStatus["requestPolicy"],
  at = new Date(),
): "normal" | "extra" {
  if (!policy) return "normal";
  const shiftStart = timeToMinutes(policy.shift_start);
  const shiftEnd = timeToMinutes(policy.shift_end);
  if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart) {
    return "extra";
  }
  const localDate = localDateAt(at.toISOString(), policy.timezone);
  const minuteOfDay = localMinutesAt(at.toISOString(), policy.timezone);
  const approvedEarlyLeave = timeToMinutes(policy.approved_early_leave_from);
  const isScheduledDay = policy.working_days.includes(weekdayIndex(localDate));
  const isInsideShift =
    minuteOfDay >= shiftStart &&
    minuteOfDay < shiftEnd &&
    (approvedEarlyLeave === null || minuteOfDay < approvedEarlyLeave);
  return isScheduledDay && !policy.approved_leave_today && isInsideShift
    ? "normal"
    : "extra";
}

function countWorkingDays(start: string, end: string, workingDays: number[]) {
  if (!start || !end || end < start) return 0;
  let count = 0;
  const cursor = new Date(`${start}T12:00:00`);
  const limit = new Date(`${end}T12:00:00`);
  while (cursor <= limit) {
    if (workingDays.includes((cursor.getDay() + 6) % 7)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function App() {
  const [status, setStatus] = useState<AgentStatus>(fallbackStatus);
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeView, setActiveView] = useState<
    | "home"
    | "tasks"
    | "requests"
    | "meeting"
    | "settings"
    | "screenshots"
    | "attendance"
    | "insights"
  >("home");
  const [projectFilterId, setProjectFilterId] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  const [quickTaskName, setQuickTaskName] = useState("");
  const [isCreatingQuickTask, setIsCreatingQuickTask] = useState(false);
  const quickTaskInFlight = useRef(false);
  const [timeRequestReason, setTimeRequestReason] = useState("");
  const [selectedIdleRequestKey, setSelectedIdleRequestKey] = useState("");
  const [earlyLeaveDate, setEarlyLeaveDate] = useState(localDateKey());
  const [earlyLeaveTime, setEarlyLeaveTime] = useState("");
  const [earlyLeaveReason, setEarlyLeaveReason] = useState("");
  const [expandedRequest, setExpandedRequest] = useState<
    "idle" | "early" | "leave" | null
  >(null);
  const [timeRequestError, setTimeRequestError] = useState<string | null>(null);
  const [timeRequestSuccess, setTimeRequestSuccess] = useState<string | null>(
    null,
  );
  const [leaveStartDate, setLeaveStartDate] = useState("");
  const [leaveEndDate, setLeaveEndDate] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveRequestError, setLeaveRequestError] = useState<string | null>(
    null,
  );
  const [leaveRequestSuccess, setLeaveRequestSuccess] = useState<string | null>(
    null,
  );
  const [isSubmittingLeaveRequest, setIsSubmittingLeaveRequest] =
    useState(false);
  const [isSubmittingTimeRequest, setIsSubmittingTimeRequest] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskTeamId, setNewTaskTeamId] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [newTaskStartDate, setNewTaskStartDate] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [taskCompletionNote, setTaskCompletionNote] = useState("");
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [trackingControlMessage, setTrackingControlMessage] = useState<
    string | null
  >(null);
  const [isChangingTracking, setIsChangingTracking] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [recentScreenshots, setRecentScreenshots] = useState<
    RecentScreenshot[] | null
  >(null);
  const [isLoadingScreenshots, setIsLoadingScreenshots] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [loginTheme, setLoginTheme] = useState<"light" | "dark">(initialTheme);
  const { appearance, updateAppearance } = useAppearance(status.appearanceScope);
  const quoteReminders = useQuoteReminders(
    status.enrolled ? (status.appearanceScope ?? status.deviceId) : null,
    appearance,
  );
  const theme = status.enrolled && status.appearanceScope ? appearance.mode : loginTheme;
  useDialogTheme({ skin: appearance.skin, mode: theme });
  const toggleTheme = () => status.enrolled && updateAppearance
    ? updateAppearance({ mode: theme === "dark" ? "light" : "dark" })
    : setLoginTheme(current => current === "dark" ? "light" : "dark");
  const shownIdleAlertId = useRef<string | null>(null);
  const screenshotsLoadedForEnrollment = useRef(false);
  const lastLoadedScreenshotAt = useRef<string | null>(null);
  const previousScreenshotConnectionStatus = useRef(status.connectionStatus);
  const isDesktopRuntime = Boolean(window.khaliduo);
  const desktopRuntimeMessage =
    "Open Khaliduo desktop app to enroll this device. The browser preview cannot access the secure desktop identity store.";

  useEffect(() => {
    if (!window.khaliduo) {
      setEnrollmentError(desktopRuntimeMessage);
      return undefined;
    }

    const statusReader = createStatusReader(
      () => window.khaliduo!.getAgentStatus(),
      (nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus.lastIdleAlert) void showIdleAlert(nextStatus.lastIdleAlert);
      },
    );
    void statusReader.poll();
    const removeIdleAlertListener =
      window.khaliduo.onIdleAlert?.((alert) => {
        void showIdleAlert(alert);
      }) ?? (() => undefined);
    const removeStatusChangedListener =
      window.khaliduo.onStatusChanged?.(statusReader.push) ?? (() => undefined);
    const interval = window.setInterval(() => void statusReader.poll(), 1000);

    return () => {
      statusReader.stop();
      removeIdleAlertListener();
      removeStatusChangedListener();
      window.clearInterval(interval);
    };
  }, [desktopRuntimeMessage]);

  useEffect(() => {
    if (status.selectedTask?.projectId) {
      setProjectFilterId(status.selectedTask.projectId);
    }
  }, [status.selectedTask?.projectId]);

  useEffect(() => {
    if (
      projectFilterId ||
      status.selectedTask ||
      status.projects.length === 0
    ) {
      return;
    }
    const defaultProject =
      status.projects.find(
        (project) => project.name.trim().toLowerCase() === "general work",
      ) ?? status.projects[0];
    setProjectFilterId(defaultProject.id);
  }, [projectFilterId, status.projects, status.selectedTask]);

  useEffect(() => {
    setTaskCompletionNote("");
    setNewChecklistTitle("");
  }, [status.selectedTask?.id]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const statusLabel = useMemo(
    () =>
      status.trackingStatus.charAt(0).toUpperCase() +
      status.trackingStatus.slice(1),
    [status.trackingStatus],
  );

  const taskTeams = useMemo(
    () =>
      Array.from(
        new Map(
          status.projects.map((project) => [
            project.team_id,
            project.team_name,
          ]),
        ).entries(),
      ),
    [status.projects],
  );

  const trackableTasks = useMemo(
    () => status.tasks.filter((task) => TRACKABLE_TASK_STAGES.has(task.stage)),
    [status.tasks],
  );

  const visibleTasks = useMemo(
    () =>
      projectFilterId
        ? trackableTasks.filter((task) => task.projectId === projectFilterId)
        : trackableTasks,
    [projectFilterId, trackableTasks],
  );

  const selectedProject = useMemo(
    () =>
      status.projects.find((project) => project.id === projectFilterId) ??
      status.projects.find(
        (project) => project.id === status.selectedTask?.projectId,
      ) ??
      null,
    [projectFilterId, status.projects, status.selectedTask?.projectId],
  );

  const manualApprovedTodaySeconds =
    status.timeSummary?.today.manual_approved_seconds ?? 0;
  const trackedTodaySeconds = Math.max(
    status.timeSummary?.today.active_seconds ?? 0,
    (status.timeSummary?.today.tracked_active_seconds ?? 0) +
      manualApprovedTodaySeconds,
    status.normalSeconds + status.extraSeconds + manualApprovedTodaySeconds,
    status.workedTodaySeconds + manualApprovedTodaySeconds,
  );
  const normalSeconds = status.enrolled
    ? reconciledNormalTodaySeconds({
        normalSeconds: status.normalSeconds,
        extraSeconds: status.extraSeconds,
        manualApprovedSeconds: manualApprovedTodaySeconds,
        trackedTodaySeconds,
      })
    : status.normalSeconds;
  const extraSeconds = status.extraSeconds;

  const timeBreakdown = useMemo(() => {
    const period = status.timeSummary?.today;
    const visibleIdleSeconds = Math.max(
      period?.idle_seconds ?? 0,
      status.todayTimeline?.idle_seconds ?? 0,
      status.eligibleIdleSeconds,
    );
    const segments = [
      {
        label: "Normal shift work",
        seconds: normalSeconds,
        className: "worked",
        counted: true,
      },
      {
        label: "Extra recorded",
        seconds: status.extraSeconds,
        className: "overtime",
        counted: false,
      },
      {
        label: "Idle",
        seconds: visibleIdleSeconds,
        className: "idle",
        counted: false,
      },
      {
        label: "Manual approved",
        seconds: period?.manual_approved_seconds ?? 0,
        className: "approved",
        counted: true,
      },
      {
        label: "Manual pending",
        seconds: period?.manual_pending_seconds ?? 0,
        className: "pending",
        counted: false,
      },
      {
        label: "Manual rejected",
        seconds: period?.manual_rejected_seconds ?? 0,
        className: "rejected",
        counted: false,
      },
    ];
    return {
      segments,
      total: Math.max(
        1,
        segments.reduce((total, segment) => total + segment.seconds, 0),
      ),
    };
  }, [
    status.extraSeconds,
    status.eligibleIdleSeconds,
    status.todayTimeline?.idle_seconds,
    status.timeSummary,
    normalSeconds,
  ]);

  const idleRequestOptions = useMemo<IdleRequestOption[]>(() => {
    return (status.idleRequestPeriods ?? [])
      .map((period) => ({
        key: `${period.work_session_id}|${period.started_at}|${period.ended_at}`,
        sessionId: period.work_session_id,
        startedAt: period.started_at,
        endedAt: period.ended_at,
        durationSeconds: period.duration_seconds,
        availableSeconds: period.available_seconds,
        projectName: period.project_name,
        taskName: period.task_name,
      }))
      .filter((option) => option.availableSeconds >= 60)
      .reverse();
  }, [status.idleRequestPeriods]);

  const selectedIdleRequest =
    idleRequestOptions.find(
      (option) => option.key === selectedIdleRequestKey,
    ) ??
    idleRequestOptions[0] ??
    null;

  useEffect(() => {
    if (!idleRequestOptions.length) {
      setSelectedIdleRequestKey("");
      return;
    }
    if (
      !selectedIdleRequestKey ||
      !idleRequestOptions.some(
        (option) => option.key === selectedIdleRequestKey,
      )
    ) {
      setSelectedIdleRequestKey(idleRequestOptions[0].key);
    }
  }, [idleRequestOptions, selectedIdleRequestKey]);

  useEffect(() => {
    const shiftEnd = timeToMinutes(status.requestPolicy?.shift_end);
    if (shiftEnd === null) return;
    setEarlyLeaveTime(
      (current) => current || minutesToTime(Math.max(0, shiftEnd - 30)),
    );
  }, [status.requestPolicy?.shift_end]);

  useEffect(() => {
    if (status.todayTimeline?.date) {
      setEarlyLeaveDate((current) => current || status.todayTimeline!.date);
    }
  }, [status.todayTimeline?.date]);

  const earlyLeaveMinutes = useMemo(() => {
    const shiftEnd = timeToMinutes(status.requestPolicy?.shift_end);
    const leavingTime = timeToMinutes(earlyLeaveTime);
    if (shiftEnd === null || leavingTime === null) return 0;
    return Math.max(0, shiftEnd - leavingTime);
  }, [earlyLeaveTime, status.requestPolicy?.shift_end]);

  const countedTodaySeconds = timeBreakdown.segments
    .filter((segment) => segment.counted)
    .reduce((total, segment) => total + segment.seconds, 0);
  const targetProgress = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (countedTodaySeconds / Math.max(1, status.dailyTargetSeconds)) * 100,
      ),
    ),
  );
  const isPaused = status.trackingPaused || status.trackingStatus === "paused";
  const isTracking =
    status.enrolled &&
    !isPaused &&
    ["active", "idle", "locked", "sleeping", "starting"].includes(
      status.trackingStatus,
    );
  const isRunning =
    isTracking && ["active", "starting"].includes(status.trackingStatus);
  const isExtraTime = currentScheduleBucket(status.requestPolicy) === "extra";
  const isIdleState = ["idle", "locked", "sleeping"].includes(
    status.trackingStatus,
  );
  const isNotWorkingOutsideShift =
    isExtraTime && (isPaused || isIdleState || !isTracking);
  // Away during a scheduled break: paid break time, never shown as idle.
  const onScheduledBreak =
    isTracking && isIdleState && !isPaused && Boolean(status.scheduledBreak);
  // Away while saved break minutes pay for it: also not shown as idle.
  const onSavedBreak =
    isTracking && isIdleState && !isPaused && Boolean(status.savedBreakCover);
  const savedBreakEndsAtMs = status.savedBreakCover
    ? Date.parse(status.savedBreakCover.endsAt)
    : null;
  const timerTone = isPaused
    ? "paused"
    : isTracking && isExtraTime
      ? "overtime"
      : isRunning
        ? "running"
        : isIdleState
          ? "paused"
          : "stopped";
  const statusText = onScheduledBreak
    ? `On break · ${status.scheduledBreak?.name ?? "Break"}`
    : onSavedBreak && savedBreakEndsAtMs !== null
      ? `Saved break · ${Math.max(0, Math.ceil((savedBreakEndsAtMs - Date.now()) / 60_000))} min left`
      : isNotWorkingOutsideShift
        ? "Off shift"
        : isPaused && status.trackingMovedToDevice
          ? `Tracking on ${status.trackingMovedToDevice}`
          : isPaused
            ? "Paused"
            : isTracking
              ? isExtraTime
                ? "Extra time"
                : isIdleState
                  ? "Shift idle"
                  : "Paid shift"
              : "No timer running";
  const runningBreakEndsAtMs = status.scheduledBreak
    ? Date.parse(status.scheduledBreak.endsAt)
    : null;
  const displayedTimerSeconds = mainTimerSeconds({
    isAutomaticIdle:
      status.trackingStatus === "idle" &&
      !isPaused &&
      !onScheduledBreak &&
      !onSavedBreak,
    isExtraTime,
    currentIdleSeconds: status.currentIdleSeconds,
    extraSeconds,
    trackedTodaySeconds,
    paidBreakSeconds: paidBreakSecondsToday(
      status.todayTimeline?.intervals ?? [],
      Date.now(),
      Number.isFinite(runningBreakEndsAtMs) ? runningBreakEndsAtMs : null,
      savedBreakEndsAtMs !== null && Number.isFinite(savedBreakEndsAtMs)
        ? savedBreakEndsAtMs
        : null,
    ),
  });

  async function refreshStatusAfterEnrollment() {
    if (status.enrolled) {
      await window.khaliduo?.syncNow();
    }
    const nextStatus = await window.khaliduo?.getAgentStatus();
    if (nextStatus) setStatus(nextStatus);
  }

  async function handleCredentialEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEnrollmentError(null);
    if (!window.khaliduo) {
      setEnrollmentError(desktopRuntimeMessage);
      return;
    }

    setIsSubmitting(true);
    const password = employeePassword;
    setEmployeePassword("");
    try {
      const result = await window.khaliduo.enrollWithCredentials(
        employeeEmail,
        password,
      );
      if (!result.success) {
        setEnrollmentError(result.message ?? "Sign-in and setup failed.");
        return;
      }

      setEmployeeEmail("");
      await refreshStatusAfterEnrollment();
    } catch (error) {
      // The IPC can reject (main-process error) rather than resolving a
      // {success:false}; without this the spinner clears with no feedback and
      // the wiped password field leaves the user with a silent dead-stop.
      setEnrollmentError(
        error instanceof Error
          ? error.message
          : "Sign-in and setup failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleIdleTimeRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTimeRequestError(null);
    setTimeRequestSuccess(null);
    if (!window.khaliduo || !status.enrolled) {
      setTimeRequestError("Device must be enrolled before sending a request.");
      return;
    }
    if (!selectedIdleRequest) {
      setTimeRequestError("No completed idle period is available to request.");
      return;
    }
    const requestedMinutes = requestableIdleMinutes(selectedIdleRequest);
    if (requestedMinutes < 1) {
      setTimeRequestError(
        "This idle period has no whole minutes remaining to request.",
      );
      return;
    }
    if (timeRequestReason.trim().length < 10) {
      setTimeRequestError(
        "Write a clear description of what you were doing during this idle time.",
      );
      return;
    }

    setIsSubmittingTimeRequest(true);
    try {
      const result = await window.khaliduo.createTimeAdjustmentRequest({
        requestedMinutes,
        reason: timeRequestReason,
        requestType: "idle_time",
        requestedDate: status.todayTimeline?.date ?? localDateKey(),
        workSessionId: selectedIdleRequest.sessionId,
        sourceStartAt: selectedIdleRequest.startedAt,
        sourceEndAt: selectedIdleRequest.endedAt,
      });
      if (!result.success) {
        setTimeRequestError(result.message ?? "Request failed.");
        return;
      }
      setTimeRequestReason("");
      setTimeRequestSuccess(
        `The full idle period (${requestedMinutes} minute${requestedMinutes === 1 ? "" : "s"}) was sent for review.`,
      );
      setSelectedIdleRequestKey("");
      if (result.status) setStatus(result.status);
    } catch (error) {
      setTimeRequestError(
        ipcErrorMessage(
          error,
          "The request could not be sent. Please try again.",
        ),
      );
    } finally {
      setIsSubmittingTimeRequest(false);
    }
  }

  async function handleEarlyLeaveRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTimeRequestError(null);
    setTimeRequestSuccess(null);
    if (!window.khaliduo || !status.enrolled) {
      setTimeRequestError("Device must be enrolled before sending a request.");
      return;
    }
    const weeklyRemaining =
      status.requestPolicy?.weekly_early_leave_remaining_minutes ?? 0;
    if (!earlyLeaveDate || !earlyLeaveTime || earlyLeaveMinutes < 1) {
      setTimeRequestError(
        "Choose a working date and a leaving time before the shift ends.",
      );
      return;
    }
    if (earlyLeaveMinutes > weeklyRemaining) {
      setTimeRequestError(
        `Only ${weeklyRemaining} early-leave minute(s) remain this week.`,
      );
      return;
    }
    if (earlyLeaveReason.trim().length < 3) {
      setTimeRequestError(
        "Write a reason of at least 3 characters before sending.",
      );
      return;
    }

    setIsSubmittingTimeRequest(true);
    try {
      const result = await window.khaliduo.createTimeAdjustmentRequest({
        requestedMinutes: earlyLeaveMinutes,
        reason: earlyLeaveReason,
        requestType: "early_leave",
        requestedDate: earlyLeaveDate,
        requestedLeaveTime: earlyLeaveTime,
      });
      if (!result.success) {
        setTimeRequestError(result.message ?? "Request failed.");
        return;
      }
      setEarlyLeaveReason("");
      setTimeRequestSuccess("Early leave request sent to HR/admin.");
      if (result.status) setStatus(result.status);
    } catch (error) {
      setTimeRequestError(
        ipcErrorMessage(
          error,
          "The request could not be sent. Please try again.",
        ),
      );
    } finally {
      setIsSubmittingTimeRequest(false);
    }
  }

  async function handleLeaveRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLeaveRequestError(null);
    setLeaveRequestSuccess(null);
    if (!window.khaliduo || !status.enrolled) {
      setLeaveRequestError("Device must be enrolled before sending a request.");
      return;
    }
    if (!leaveStartDate || !leaveEndDate) {
      setLeaveRequestError("Choose the start and end dates.");
      return;
    }
    if (leaveEndDate < leaveStartDate) {
      setLeaveRequestError("End date must be on or after the start date.");
      return;
    }

    setIsSubmittingLeaveRequest(true);
    try {
      const result = await window.khaliduo.createLeaveRequest({
        startDate: leaveStartDate,
        endDate: leaveEndDate,
        leaveType: "annual",
        reason: leaveReason.trim() || undefined,
      });
      if (!result.success) {
        setLeaveRequestError(result.message ?? "Holiday request failed.");
        return;
      }
      setLeaveStartDate("");
      setLeaveEndDate("");
      setLeaveReason("");
      setLeaveRequestSuccess("Holiday request sent to HR/admin.");
      if (result.status) setStatus(result.status);
    } catch (error) {
      setLeaveRequestError(
        ipcErrorMessage(
          error,
          "The holiday request could not be sent. Please try again.",
        ),
      );
    } finally {
      setIsSubmittingLeaveRequest(false);
    }
  }

  async function handleTaskChange(taskId: string) {
    setTaskError(null);
    if (!window.khaliduo || !status.enrolled) {
      setTaskError("Device must be enrolled before choosing a task.");
      return;
    }

    setIsSubmittingTask(true);
    try {
      const result = await window.khaliduo.setCurrentTask(
        taskId === "none" ? null : taskId,
      );
      if (!result.success) {
        setTaskError(result.message ?? "Task selection failed.");
        return;
      }
      if (result.status) setStatus(result.status);
    } catch (error) {
      setTaskError(
        ipcErrorMessage(
          error,
          "The action could not be completed. Please try again.",
        ),
      );
    } finally {
      setIsSubmittingTask(false);
    }
  }

  async function handleQuickCreateTask() {
    const name = quickTaskName.trim();
    if (!name || name.length > 255 || !window.khaliduo || quickTaskInFlight.current) return;
    quickTaskInFlight.current = true;
    setIsCreatingQuickTask(true);
    setTaskError(null);
    setTrackingControlMessage(null);
    try {
      const result = await window.khaliduo.createTask({
        name,
        projectId: projectFilterId || status.selectedTask?.projectId,
      });
      if (!result.success) {
        setTaskError(result.message ?? "Could not create the task. Please try again.");
        return;
      }
      setQuickTaskName("");
      setTrackingControlMessage(result.message ?? "Task sent for manager approval.");
      if (result.status) setStatus(result.status);
    } catch (error) {
      setTaskError(ipcErrorMessage(error, "Could not create the task. Please try again."));
    } finally {
      quickTaskInFlight.current = false;
      setIsCreatingQuickTask(false);
    }
  }

  async function handleCreateTask() {
    const name = newTaskName.trim();
    if (!name || !window.khaliduo) return;
    setTaskError(null);
    setIsSubmittingTask(true);
    try {
      const result = await window.khaliduo.createTask({
        name,
        description: newTaskDescription || undefined,
        projectId: newTaskProjectId || status.selectedTask?.projectId,
        stage: "assigned",
        startDate: newTaskStartDate || undefined,
        deadline: newTaskDeadline || undefined,
      });
      if (!result.success) {
        setTaskError(result.message ?? "Task creation failed.");
        return;
      }
      setNewTaskName("");
      setNewTaskDescription("");
      setNewTaskStartDate("");
      setNewTaskDeadline("");
      setTrackingControlMessage(
        result.message ?? "Task submitted for manager approval.",
      );
      if (result.status) setStatus(result.status);
    } catch (error) {
      setTaskError(
        ipcErrorMessage(
          error,
          "The action could not be completed. Please try again.",
        ),
      );
    } finally {
      setIsSubmittingTask(false);
    }
  }

  async function handleTaskStage(
    stage: "assigned" | "in_progress" | "ready_for_review" | "blocked",
    noteOverride?: string,
  ) {
    if (!window.khaliduo || !status.selectedTask) return;
    if (!status.selectedTask.canUpdateStage) {
      setTaskError("Only the primary assignee can change this task's status.");
      return;
    }
    setTaskError(null);
    setTrackingControlMessage(null);
    setIsSubmittingTask(true);
    const note =
      noteOverride !== undefined
        ? noteOverride.trim()
        : stage === "blocked"
          ? window
              .prompt(
                "Describe the obstacle blocking this task. Reporting it will stop tracking this task.",
              )
              ?.trim()
          : stage === "ready_for_review"
            ? window
                .prompt(
                  "Submit as finished. Add an optional note for the reviewer.",
                )
                ?.trim()
            : undefined;
    if (stage === "blocked" && !note) {
      setIsSubmittingTask(false);
      return;
    }
    try {
      const result = await window.khaliduo.updateTaskStage(
        status.selectedTask.id,
        stage,
        note,
      );
      if (!result.success) {
        setTaskError(result.message ?? "Task stage update failed.");
      } else if (stage === "blocked") {
        setTrackingControlMessage(
          "Task reported blocked and removed from tracking. Use the employee dashboard to resume it after the obstacle is cleared.",
        );
      } else if (stage === "ready_for_review") {
        setTrackingControlMessage(
          "Finished work submitted. Waiting for approval.",
        );
        setTaskCompletionNote("");
      }
      if (result.status) {
        setStatus(result.status);
      }
    } catch (error) {
      setTaskError(
        ipcErrorMessage(
          error,
          "The task status could not be updated. Please try again.",
        ),
      );
    } finally {
      setIsSubmittingTask(false);
    }
  }

  async function handleAddChecklistItem() {
    const task = status.selectedTask;
    const title = newChecklistTitle.trim();
    if (!window.khaliduo || !task || !title) return;
    setTaskError(null);
    setIsSubmittingTask(true);
    try {
      const result = await window.khaliduo.createTaskChecklistItem(
        task.id,
        title,
      );
      if (!result.success) {
        setTaskError(result.message ?? "Checklist update failed.");
        return;
      }
      setNewChecklistTitle("");
      if (result.status) setStatus(result.status);
    } catch (error) {
      setTaskError(
        ipcErrorMessage(
          error,
          "The action could not be completed. Please try again.",
        ),
      );
    } finally {
      setIsSubmittingTask(false);
    }
  }

  async function handleToggleChecklistItem(itemId: string, completed: boolean) {
    const task = status.selectedTask;
    if (!window.khaliduo || !task) return;
    setTaskError(null);
    setIsSubmittingTask(true);
    try {
      const result = await window.khaliduo.updateTaskChecklistItem(
        task.id,
        itemId,
        completed,
      );
      if (!result.success) {
        setTaskError(result.message ?? "Checklist update failed.");
        return;
      }
      if (result.status) setStatus(result.status);
    } catch (error) {
      setTaskError(
        ipcErrorMessage(
          error,
          "The action could not be completed. Please try again.",
        ),
      );
    } finally {
      setIsSubmittingTask(false);
    }
  }

  async function handleDeleteChecklistItems(itemIds: string[]) {
    const task = status.selectedTask;
    if (!window.khaliduo || !task || itemIds.length === 0) return false;
    const confirmation = await Swal.fire({
      title: `Delete ${itemIds.length} checklist ${itemIds.length === 1 ? "item" : "items"}?`,
      text: "This removes the selected checklist items permanently.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete selected",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
    });
    if (!confirmation.isConfirmed) return false;

    setTaskError(null);
    setIsSubmittingTask(true);
    try {
      const result = await window.khaliduo.deleteTaskChecklistItems(
        task.id,
        itemIds,
      );
      if (!result.success) {
        setTaskError(result.message ?? "Checklist deletion failed.");
        return false;
      }
      if (result.status) setStatus(result.status);
      return true;
    } catch (error) {
      setTaskError(
        ipcErrorMessage(
          error,
          "The action could not be completed. Please try again.",
        ),
      );
      return false;
    } finally {
      setIsSubmittingTask(false);
    }
  }

  async function handleEndShift() {
    if (!window.khaliduo || !status.enrolled || isChangingTracking) return;
    const confirmation = await Swal.fire({
      title: "End your shift?",
      text: "Your recorded time will be saved and work tracking will stop. Workplace captures continue according to company policy.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "End shift",
      cancelButtonText: "Keep working",
      confirmButtonColor: "#7c5cff",
      focusCancel: true,
    });
    if (!confirmation.isConfirmed) return;
    setIsChangingTracking(true);
    try {
      const result = await withOperationTimeout(
        window.khaliduo.endShift(),
        TRACKING_CONTROL_TIMEOUT_MS,
        "Ending the shift is still syncing. Your recorded time remains saved locally.",
      );
      setTrackingControlMessage(
        result.message ??
          (result.success
            ? "Shift ended. Your recorded time is saved."
            : "Could not end the shift."),
      );
      setStatus(
        await withOperationTimeout(window.khaliduo.getAgentStatus(), 2_000),
      );
    } catch (error) {
      setTrackingControlMessage(
        error instanceof Error ? error.message : "Could not end the shift.",
      );
    } finally {
      setIsChangingTracking(false);
    }
  }

  async function handleTrackingToggle(takeBreak = false) {
    if (!window.khaliduo || !status.enrolled || isChangingTracking) return;
    setTrackingControlMessage(null);
    setIsChangingTracking(true);
    try {
      const shouldResume = !takeBreak && (
        status.trackingPaused ||
        status.trackingStatus === "paused" ||
        status.trackingStatus === "offline" ||
        status.trackingStatus === "error");
      const result = await withOperationTimeout(
        shouldResume
          ? window.khaliduo.resumeTracking()
          : window.khaliduo.pauseTracking(takeBreak ? { takeBreak: true } : undefined),
        TRACKING_CONTROL_TIMEOUT_MS,
        "Tracking control did not respond within 20 seconds.",
      );
      if (!result.success) {
        setTrackingControlMessage(
          result.message ?? "The tracking state could not be changed.",
        );
        return;
      }
      setTrackingControlMessage(
        result.message ??
          (shouldResume
            ? "Tracking resumed. Screenshots follow the company schedule."
            : "Paused. Tracking and screenshots stop until you resume."),
      );
      // Timeout-guard the success-path refresh too: if the main process hangs
      // here (never resolves), the finally that releases the button would never
      // run, wedging it on "Please wait…" forever.
      setStatus(
        await withOperationTimeout(window.khaliduo.getAgentStatus(), 2_000),
      );
    } catch (error) {
      try {
        const nextStatus = await withOperationTimeout(
          window.khaliduo.getAgentStatus(),
          2_000,
        );
        setStatus(nextStatus);
      } catch {
        // The control must still be released if the Electron main process is
        // temporarily unable to answer the follow-up status request.
      }
      setTrackingControlMessage(
        error instanceof OperationTimeoutError
          ? "The button was released because syncing took too long. Your locally saved time is safe; check the current status before trying again."
          : error instanceof Error
            ? error.message
            : "The tracking state could not be changed.",
      );
    } finally {
      setIsChangingTracking(false);
    }
  }

  async function handleOpenDashboard(section?: "screenshots") {
    setDashboardError(null);
    setIsOpeningDashboard(true);
    try {
      const result = await window.khaliduo?.openEmployeeDashboard(section);
      if (!result?.success) {
        setDashboardError(
          result?.message ?? "The employee dashboard could not be opened.",
        );
      }
    } finally {
      setIsOpeningDashboard(false);
    }
  }

  const handleLoadRecentScreenshots = useCallback(async () => {
    if (!window.khaliduo || isLoadingScreenshots) return;
    setIsLoadingScreenshots(true);
    setScreenshotError(null);
    try {
      const result = await window.khaliduo.getRecentScreenshots();
      if (!result.success) {
        setScreenshotError(
          result.message ?? "Recent screenshots could not be loaded.",
        );
        return;
      }
      setRecentScreenshots(result.screenshots);
    } catch (error) {
      setScreenshotError(
        ipcErrorMessage(error, "Recent screenshots could not be loaded."),
      );
    } finally {
      setIsLoadingScreenshots(false);
    }
  }, [isLoadingScreenshots]);

  useEffect(() => {
    if (!status.enrolled) return;
    if (
      screenshotsLoadedForEnrollment.current &&
      status.lastScreenshotAt === lastLoadedScreenshotAt.current
    ) {
      return;
    }
    screenshotsLoadedForEnrollment.current = true;
    lastLoadedScreenshotAt.current = status.lastScreenshotAt;
    void handleLoadRecentScreenshots();
  }, [handleLoadRecentScreenshots, status.enrolled, status.lastScreenshotAt]);

  useEffect(() => {
    const previousConnectionStatus = previousScreenshotConnectionStatus.current;
    previousScreenshotConnectionStatus.current = status.connectionStatus;
    if (
      !shouldReloadScreenshotsAfterRecovery({
        previousConnectionStatus,
        connectionStatus: status.connectionStatus,
        hasLoadError: Boolean(screenshotError),
      })
    ) {
      return;
    }
    lastLoadedScreenshotAt.current = null;
    void handleLoadRecentScreenshots();
  }, [handleLoadRecentScreenshots, screenshotError, status.connectionStatus]);

  async function handleLogout() {
    if (!window.khaliduo || isLoggingOut) return;
    const confirmation = await Swal.fire({
      title: "Sign out from this computer?",
      text: "Tracking and screenshots will stop, and this computer will need to be linked again before it can track work.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Sign out",
      cancelButtonText: "Keep me signed in",
      confirmButtonColor: "#842029",
    });
    if (!confirmation.isConfirmed) return;

    setIsLoggingOut(true);
    try {
      const result = await window.khaliduo.logout();
      if (!result.success) {
        await Swal.fire(
          "Sign out failed",
          result.message ?? "Please try again.",
          "error",
        );
        return;
      }
      setStatus(await window.khaliduo.getAgentStatus());
      setActiveView("home");
      setEmployeePassword("");
      setTrackingControlMessage(null);
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function showIdleAlert(alert: IdleAlert) {
    if (shownIdleAlertId.current === alert.id) return;
    shownIdleAlertId.current = alert.id;
    window.khaliduo?.setIdleAlertAttention(true);
    const isTrackingStart = alert.kind === "tracking_start";
    // Shown the moment idle is detected (at the threshold), before any input
    // returns. Distinguishes "Continue working" (mistaken detection, resume now)
    // from "I was working during this idle period" (an explanation request that
    // still requires review — never a retrospective self-approval).
    const isIdleStarted = alert.kind === "idle_started";
    const canRequestManualTime = isIdleStarted
      ? !alert.outsideScheduledShift
      : !isTrackingStart &&
        !alert.outsideScheduledShift &&
        alert.eligibleLostSeconds > 0;
    let idleReason = "";
    let result: SweetAlertResult;
    try {
      result = await Swal.fire({
        title: isTrackingStart
          ? alert.outsideScheduledShift
            ? "Start extra time?"
            : "Start work tracking?"
          : isIdleStarted
            ? "Are you still working?"
            : "Confirm you are back",
        text: isTrackingStart
          ? alert.outsideScheduledShift
            ? "You are outside your scheduled shift. Confirm only if you are working; your timer starts after you confirm."
            : "Ready to begin? Confirm that you are here and working to start your timer."
          : isIdleStarted
            ? "No activity detected. Continue if you are back, or explain this idle time for review."
            : canRequestManualTime
              ? `Input was detected after ${formatDuration(alert.lostSeconds)} away. Choose Continue to resume now; ${formatDuration(alert.eligibleLostSeconds)} inside your paid shift remains available to explain.`
              : `Input was detected after ${formatDuration(alert.lostSeconds)} away. Choose Continue to resume tracking now.`,
        icon: "warning",
        iconHtml: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
        buttonsStyling: false,
        customClass: {
          container: "k-idle-backdrop",
          popup: "k-idle-dialog",
          title: "k-idle-title",
          htmlContainer: "k-idle-description",
          input: "k-idle-reason",
          inputLabel: "k-idle-label",
          actions: "k-idle-actions",
          confirmButton: "k-idle-continue",
          denyButton: "k-idle-stop",
          cancelButton: "k-idle-explain",
        },
        input: canRequestManualTime ? "textarea" : undefined,
        inputLabel: "Reason for idle time",
        inputPlaceholder:
          "Client call, meeting, offline work, or a system issue...",
        inputAttributes: {
          maxlength: "1000",
          rows: "3",
          "aria-label": "Reason for idle time",
        },
        willClose: (popup) => {
          // The explanation action dismisses the alert, so SweetAlert does
          // not include the input in result.value. Preserve it for the form.
          idleReason = popup.querySelector("textarea")?.value.trim() ?? "";
        },
        showDenyButton: true,
        showCancelButton: canRequestManualTime,
        confirmButtonText: isTrackingStart
          ? alert.outsideScheduledShift
            ? "Start extra time"
            : "Start work"
          : isIdleStarted
            ? "Continue working"
            : "Continue tracking",
        denyButtonText: isTrackingStart ? "Not working" : "Stop tracking",
        cancelButtonText: isIdleStarted
          ? "I was working during this idle period"
          : "Request manual time",
        allowEscapeKey: false,
        allowOutsideClick: false,
      });
    } catch (error) {
      if (shownIdleAlertId.current === alert.id) {
        window.khaliduo?.setIdleAlertAttention(false);
      }
      throw error;
    }

    // Send the chosen action BEFORE releasing the alert. IPC messages are
    // handled in order, so the main process leaves idle before the alert is
    // cleared. Clearing it first left a moment where tracking was still idle
    // with no alert pending, and the return check opened a second popup.
    // A newer alert (e.g. the morning "Start work" replacing last night's
    // unanswered popup) closes this one; releasing then would drop the newer
    // alert's always-on-top attention, so only the current alert may release.
    const releaseAlert = () => {
      const current = shownIdleAlertId.current;
      // null: the error path below cleared the guard so this alert can reappear.
      if (current !== alert.id && current !== null) return;
      window.khaliduo?.setIdleAlertAttention(false);
    };
    let released = false;
    const runThenRelease = async <T,>(action: () => Promise<T> | undefined) => {
      const pending = action();
      releaseAlert();
      released = true;
      return await pending;
    };
    try {
      if (result.isConfirmed) {
        const resumeResult = await runThenRelease(() =>
          isTrackingStart
            ? window.khaliduo?.confirmTrackingStart()
            : window.khaliduo?.resumeAutomaticIdle(),
        );
        if (resumeResult?.message)
          setTrackingControlMessage(resumeResult.message);
        const nextStatus = await window.khaliduo?.getAgentStatus();
        if (nextStatus) setStatus(nextStatus);
      } else if (result.isDenied) {
        const pauseResult = await runThenRelease(() =>
          isTrackingStart
            ? window.khaliduo?.declineTrackingStart()
            : window.khaliduo?.pauseTracking(),
        );
        if (pauseResult?.message)
          setTrackingControlMessage(pauseResult.message);
        const nextStatus = await window.khaliduo?.getAgentStatus();
        if (nextStatus) setStatus(nextStatus);
      } else if (
        canRequestManualTime &&
        result.dismiss === Swal.DismissReason.cancel
      ) {
        // "idle_started" alerts are raised the moment idle begins, so the idle
        // period runs from the alert until this click. An "idle_return" alert
        // already carries the away time measured when input came back.
        const alertAt = Date.parse(alert.endedAt);
        const idleStartedAt = isIdleStarted
          ? alertAt
          : alertAt - alert.lostSeconds * 1000;
        const idleSecondsInShift = isIdleStarted
          ? Math.floor((Date.now() - alertAt) / 1000)
          : alert.eligibleLostSeconds;
        const resumeResult = await runThenRelease(() =>
          window.khaliduo?.resumeAutomaticIdle(),
        );
        if (resumeResult?.message)
          setTrackingControlMessage(resumeResult.message);
        if (idleSecondsInShift < 60) {
          // Nothing was lost: the minutes before the popup already counted as
          // work and idle lasted under a minute. Opening the form here showed an
          // empty period list with a disabled Submit button.
          await Swal.fire({
            icon: "success",
            title: "Tracking resumed",
            text: "Less than a minute was counted as idle, so there is nothing to explain. The time before this popup already counted as work.",
            confirmButtonColor: "#1f7a4d",
          });
          return;
        }
        setTimeRequestError(null);
        setTimeRequestSuccess(null);
        setTimeRequestReason(idleReason);
        setExpandedRequest("idle");
        setActiveView("requests");
        // The period is listed once the server has the idle end. Online, the
        // resume above already waited for that; retry briefly for slow links.
        let periodKey: string | null = null;
        for (let attempt = 0; attempt < 6 && !periodKey; attempt += 1) {
          if (attempt === 1) await window.khaliduo?.syncNow();
          if (attempt > 0) await new Promise((r) => window.setTimeout(r, 1500));
          const nextStatus = await window.khaliduo?.getAgentStatus();
          if (!nextStatus) break;
          setStatus(nextStatus);
          periodKey = idleRequestKeyForIdleStart(
            nextStatus.idleRequestPeriods ?? [],
            idleStartedAt,
          );
        }
        if (periodKey) {
          setSelectedIdleRequestKey(periodKey);
        } else {
          setTimeRequestError(
            "This idle period has not synced yet. Check your connection; it will appear in the list above as soon as it syncs.",
          );
        }
        window.setTimeout(
          () => document.getElementById("idle-request-reason")?.focus(),
          50,
        );
      }
    } catch (error) {
      // A follow-up IPC (resume/pause/status) rejected. Clear the shown-alert
      // guard so this mandatory idle review can reappear instead of being
      // suppressed forever, and surface a message to the employee.
      shownIdleAlertId.current = null;
      setTrackingControlMessage(
        error instanceof Error
          ? error.message
          : "Could not update tracking. Please try again.",
      );
    } finally {
      if (!released) releaseAlert();
    }
  }

  async function handleUpdateButton() {
    if (!window.khaliduo || isCheckingUpdate) return;
    const isInstallAction = status.updateStatus === "ready";
    setIsCheckingUpdate(true);
    try {
      const result = isInstallAction
        ? await window.khaliduo.installUpdate()
        : await window.khaliduo.checkForUpdates();
      if (result?.success === false) {
        await Swal.fire({
          title: isInstallAction
            ? "Update installation failed"
            : "Update check failed",
          text:
            result.message ??
            (isInstallAction
              ? "Khaliduo could not install the update."
              : "Khaliduo could not check for updates."),
          icon: "error",
          confirmButtonText: "OK",
        });
      }
      const nextStatus = await window.khaliduo.getAgentStatus();
      setStatus(nextStatus);
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  const updateButtonLabel =
    status.updateStatus === "installing"
      ? "Installing update..."
      : status.updateStatus === "ready"
        ? "Install update"
        : status.updateStatus === "downloading"
          ? `Updating ${Math.round(status.updatePercent ?? 0)}%`
          : status.updateStatus === "available"
            ? "Downloading update"
            : status.updateStatus === "error"
              ? "Retry update"
              : isCheckingUpdate || status.updateStatus === "checking"
                ? "Checking..."
                : "Check update";
  const updateButtonDisabled =
    isCheckingUpdate ||
    status.updateStatus === "checking" ||
    status.updateStatus === "downloading" ||
    status.updateStatus === "available" ||
    status.updateStatus === "installing";

  const updateNotice = (status.updateRequired ||
    ["available", "downloading", "ready", "installing"].includes(
      status.updateStatus,
    )) && (
    <section className="k-update" role="status" aria-live="assertive">
      <strong>
        Required update {status.updateVersion ? `v${status.updateVersion}` : ""}
      </strong>
      <span>
        {status.updateStatus === "installing"
          ? "Installing automatically now. Khaliduo will restart when it finishes."
          : status.updateStatus === "ready"
            ? "Downloaded and ready. Automatic installation is starting now; you can also click Install update."
            : status.updateStatus === "downloading"
              ? `Downloading: ${Math.round(status.updatePercent ?? 0)}%`
              : status.updateStatus === "available"
                ? "Preparing the required download..."
                : status.updateStatus === "error"
                  ? "This version of Khaliduo is no longer supported and the update could not be downloaded yet. Khaliduo keeps retrying every few minutes; check the internet connection."
                  : "This version of Khaliduo is no longer supported. Looking for the update now..."}
      </span>
      {status.updateRequired &&
        ["error", "idle", "up-to-date", "ready"].includes(
          status.updateStatus,
        ) && (
          <button
            type="button"
            onClick={() => void handleUpdateButton()}
            disabled={updateButtonDisabled}
          >
            {updateButtonLabel}
          </button>
        )}
    </section>
  );

  if (!status.enrolled) {
    return (
      <DesktopLogin
        employeeEmail={employeeEmail}
        employeePassword={employeePassword}
        enrollmentError={enrollmentError}
        isSubmitting={isSubmitting}
        isDesktopRuntime={isDesktopRuntime}
        onEmailChange={setEmployeeEmail}
        onPasswordChange={setEmployeePassword}
        onCredentialEnrollment={handleCredentialEnrollment}
        theme={theme}
        onThemeChange={toggleTheme}
        updateNotice={updateNotice}
        version={status.agentVersion}
      />
    );
  }

  return (
    <TrackerFrame
      native
      dataTone={timerTone}
      name={status.enrolled ? status.employeeName : "Sign in"}
      email={status.employeeEmail}
      avatar={status.employeeAvatarUrl}
      logo="./khaliduo-icon.png"
      theme={theme}
      onThemeChange={toggleTheme}
      appearance={status.appearanceScope ? appearance : undefined}
      onAppearanceChange={updateAppearance}
      view={activeView}
      sections={
        status.enrolled
          ? [
              { id: "home", label: "Tracker", icon: "ri-timer-line" },
              {
                id: "screenshots",
                label: "Screenshots",
                icon: "ri-image-line",
              },
              { id: "tasks", label: "Tasks", icon: "ri-task-line" },
              {
                id: "attendance",
                label: "Attendance",
                icon: "ri-focus-3-line",
              },
              { id: "insights", label: "Insights", icon: "ri-bar-chart-line" },
              { id: "requests", label: "Requests", icon: "ri-inbox-line" },
              { id: "meeting", label: "Meetings", icon: "ri-calendar-line" },
              { id: "settings", label: "Settings", icon: "ri-settings-line" },
            ]
          : []
      }
      onViewChange={(view) => setActiveView(view as typeof activeView)}
      seconds={displayedTimerSeconds}
      running={isTracking}
      stateLabel={statusText}
      shiftLabel={
        status.requestPolicy?.shift_start && status.requestPolicy.shift_end
          ? status.requestPolicy.shift_start +
            " – " +
            status.requestPolicy.shift_end
          : "Not configured"
      }
      shotsLabel={
        status.screenshotMonitoringEnabled
          ? status.screenshotCaptureActive
            ? status.connectionStatus === "online"
              ? "Screenshots active"
              : "Screenshots queued"
            : "Screenshots paused"
          : "Screenshots disabled"
      }
      synced={status.connectionStatus === "online"}
      onSync={() => void refreshStatusAfterEnrollment()}
      onDashboard={() => void handleOpenDashboard()}
      version={status.agentVersion}
      headerControls={
        <>
          <button
            type="button"
            className="app-nav-btn"
            disabled={updateButtonDisabled}
            onClick={() => void handleUpdateButton()}
            aria-label={updateButtonLabel}
            title={updateButtonLabel}
          >
            <KIcon name="update" />
          </button>
          <NativeWindowControls />
        </>
      }
    >
      {updateNotice}

      <>
        {activeView === "home" && (
          <ReaddyHome
            recentScreenshots={recentScreenshots}
            onOpenScreenshots={() => setActiveView("screenshots")}
            onOpenAttendance={() => setActiveView("attendance")}
            onEndShift={() => void handleEndShift()}
            status={status}
            workedSeconds={trackedTodaySeconds}
            activeSeconds={Math.max(
              status.workedTodaySeconds,
              status.timeSummary?.today.tracked_active_seconds ?? 0,
              status.normalSeconds + status.extraSeconds,
            )}
            visibleTasks={visibleTasks}
            projectFilterId={projectFilterId}
            onProjectChange={setProjectFilterId}
            onTaskChange={(taskId) => void handleTaskChange(taskId)}
            onTrackingToggle={() => void handleTrackingToggle()}
            onTakeBreak={() => void handleTrackingToggle(true)}
            changingTracking={isChangingTracking}
            submittingTask={isSubmittingTask}
            sessionNote={quickTaskName}
            onSessionNoteChange={(value) => { setQuickTaskName(value); setTaskError(null); setTrackingControlMessage(null); }}
            onCreateQuickTask={() => void handleQuickCreateTask()}
            creatingQuickTask={isCreatingQuickTask}
            message={trackingControlMessage}
            error={taskError ?? dashboardError}
            taskRequest={
              <ReaddyTaskRequest
                status={status}
                teams={taskTeams}
                values={{
                  name: newTaskName,
                  description: newTaskDescription,
                  teamId: newTaskTeamId,
                  projectId: newTaskProjectId,
                  startDate: newTaskStartDate,
                  deadline: newTaskDeadline,
                }}
                onChange={(field, value) => {
                  const setters = {
                    name: setNewTaskName,
                    description: setNewTaskDescription,
                    teamId: (teamId: string) => {
                      setNewTaskTeamId(teamId);
                      setNewTaskProjectId("");
                    },
                    projectId: setNewTaskProjectId,
                    startDate: setNewTaskStartDate,
                    deadline: setNewTaskDeadline,
                  };
                  setters[field](value);
                }}
                onSubmit={() => void handleCreateTask()}
                submitting={isSubmittingTask}
                error={taskError}
              />
            }
            manualRequest={
              <ReaddyManualRequest status={status} onStatusChange={setStatus} />
            }
          >
            <HomeView
              status={status}
              statusLabel={statusLabel}
              selectedProject={selectedProject}
              projectFilterId={projectFilterId}
              visibleTasks={visibleTasks}
              recentScreenshots={recentScreenshots}
              isLoadingScreenshots={isLoadingScreenshots}
              screenshotError={screenshotError}
              sessionNote={sessionNote}
              timeBreakdown={timeBreakdown}
              targetProgress={targetProgress}
              countedTodaySeconds={countedTodaySeconds}
              trackedTodaySeconds={trackedTodaySeconds}
              displayedTimerSeconds={displayedTimerSeconds}
              isExtraTime={isExtraTime}
              normalSeconds={normalSeconds}
              extraSeconds={extraSeconds}
              isChangingTracking={isChangingTracking}
              isSubmittingTask={isSubmittingTask}
              isOpeningDashboard={isOpeningDashboard}
              dashboardError={dashboardError}
              onProjectChange={setProjectFilterId}
              onTaskChange={(taskId) => void handleTaskChange(taskId)}
              onSessionNoteChange={setSessionNote}
              onTrackingToggle={() => void handleTrackingToggle()}
              onLoadScreenshots={() => void handleLoadRecentScreenshots()}
              onOpenScreenshots={() => void handleOpenDashboard("screenshots")}
              idleRequestOptions={idleRequestOptions}
              onRequestManualTime={(option) => {
                if (option) {
                  setSelectedIdleRequestKey(option.key);
                }
                setExpandedRequest("idle");
                setActiveView("requests");
              }}
            />
          </ReaddyHome>
        )}
        {activeView === "tasks" && (
          <TasksView
            status={status}
            taskTeams={taskTeams}
            trackableTasks={trackableTasks}
            taskError={taskError}
            trackingControlMessage={trackingControlMessage}
            isSubmittingTask={isSubmittingTask}
            newTaskName={newTaskName}
            newTaskDescription={newTaskDescription}
            newTaskTeamId={newTaskTeamId}
            newTaskProjectId={newTaskProjectId}
            newTaskStartDate={newTaskStartDate}
            newTaskDeadline={newTaskDeadline}
            taskCompletionNote={taskCompletionNote}
            newChecklistTitle={newChecklistTitle}
            onTaskChange={(taskId) => void handleTaskChange(taskId)}
            onTaskStage={(stage, note) => void handleTaskStage(stage, note)}
            onChecklistToggle={(itemId, completed) =>
              void handleToggleChecklistItem(itemId, completed)
            }
            onDeleteChecklistItems={handleDeleteChecklistItems}
            onChecklistTitleChange={setNewChecklistTitle}
            onAddChecklistItem={() => void handleAddChecklistItem()}
            onTaskCompletionNoteChange={setTaskCompletionNote}
            onTrackingToggle={() => void handleTrackingToggle()}
            onNewTaskNameChange={setNewTaskName}
            onNewTaskDescriptionChange={setNewTaskDescription}
            onNewTaskTeamChange={(teamId) => {
              setNewTaskTeamId(teamId);
              setNewTaskProjectId("");
            }}
            onNewTaskProjectChange={setNewTaskProjectId}
            onNewTaskStartDateChange={setNewTaskStartDate}
            onNewTaskDeadlineChange={setNewTaskDeadline}
            onCreateTask={() => void handleCreateTask()}
          />
        )}
        {activeView === "requests" && (
          <RequestCentreView
            leadingContent={<BreakBankCard status={status} />}
            status={status}
            timeRequestReason={timeRequestReason}
            timeRequestError={timeRequestError}
            timeRequestSuccess={timeRequestSuccess}
            leaveStartDate={leaveStartDate}
            leaveEndDate={leaveEndDate}
            leaveReason={leaveReason}
            leaveRequestError={leaveRequestError}
            leaveRequestSuccess={leaveRequestSuccess}
            isSubmittingLeaveRequest={isSubmittingLeaveRequest}
            isSubmittingTimeRequest={isSubmittingTimeRequest}
            onLeaveStartDateChange={setLeaveStartDate}
            onLeaveEndDateChange={setLeaveEndDate}
            onLeaveReasonChange={setLeaveReason}
            onSubmitLeaveRequest={handleLeaveRequest}
            onTimeRequestReasonChange={setTimeRequestReason}
            selectedIdleRequestKey={selectedIdleRequestKey}
            idleRequestOptions={idleRequestOptions}
            earlyLeaveDate={earlyLeaveDate}
            earlyLeaveTime={earlyLeaveTime}
            earlyLeaveMinutes={earlyLeaveMinutes}
            earlyLeaveReason={earlyLeaveReason}
            expandedRequest={expandedRequest}
            onSelectedIdleRequestChange={setSelectedIdleRequestKey}
            onEarlyLeaveDateChange={setEarlyLeaveDate}
            onEarlyLeaveTimeChange={setEarlyLeaveTime}
            onEarlyLeaveReasonChange={setEarlyLeaveReason}
            onExpandedRequestChange={(value) => {
              setExpandedRequest(value);
              setTimeRequestError(null);
              setTimeRequestSuccess(null);
              setLeaveRequestError(null);
              setLeaveRequestSuccess(null);
            }}
            onSubmitIdleTimeRequest={handleIdleTimeRequest}
            onSubmitEarlyLeaveRequest={handleEarlyLeaveRequest}
          >
            <ShiftRescheduleCard enrolled={status.enrolled} />
          </RequestCentreView>
        )}
        {activeView === "meeting" && (
          <MeetingView
            status={status}
            onRefresh={async () => {
              const next = await window.khaliduo?.getAgentStatus();
              if (next) setStatus(next);
            }}
          />
        )}
        {activeView === "screenshots" && (
          <ScreenshotsPage
            screenshots={recentScreenshots}
            loading={isLoadingScreenshots}
            error={screenshotError ?? dashboardError}
            enabled={status.screenshotMonitoringEnabled}
            openingDashboard={isOpeningDashboard}
            onRefresh={() => void handleLoadRecentScreenshots()}
            onOpenDashboard={() => void handleOpenDashboard("screenshots")}
            formatTimestamp={formatTimestamp}
          />
        )}
        {activeView === "insights" && <NativeInsights status={status} />}
        {activeView === "attendance" && (
          <NativeShiftPage
            status={status}
            scheduledShift={status.requestPolicy?.shift_start && status.requestPolicy.shift_end
              ? `${formatScheduledTime(status.requestPolicy.shift_start)} – ${formatScheduledTime(status.requestPolicy.shift_end)}`
              : "Not configured"}
            formatClock={formatClock}
            formatDuration={formatDuration}
          >
            <BreakBankCard status={status} />
            {status.todayTimeline ? (
              <Timeline
                workspace
                timeline={status.todayTimeline}
                locallyEndedIdleAt={status.locallyEndedIdleAt}
                idleRequestOptions={idleRequestOptions}
                onRequestIdleTime={(option) => {
                  setSelectedIdleRequestKey(option.key);
                  setExpandedRequest("idle");
                  setActiveView("requests");
                }}
              />
            ) : (
              <div className="wp-card wp-empty">
                <span className="wp-empty-icon"><TrackerIcon className="ri-calendar-line" aria-hidden="true" /></span>
                <h2>No attendance recorded yet</h2>
                <p>Your shift activity will appear here after your next sync.</p>
              </div>
            )}
          </NativeShiftPage>
        )}
        {activeView === "settings" && (
          <SettingsView
            status={status}
            quotesEnabled={quoteReminders.enabled}
            onQuotesEnabledChange={quoteReminders.setEnabled}
            quoteMinutes={quoteReminders.minutes}
            onQuoteMinutesChange={quoteReminders.setMinutes}
            quoteError={quoteReminders.error}
            onLogout={() => void handleLogout()}
            isLoggingOut={isLoggingOut}
          />
        )}
      </>
    </TrackerFrame>
  );
}

function HomeView({
  status,
  statusLabel,
  selectedProject,
  projectFilterId,
  visibleTasks,
  recentScreenshots,
  isLoadingScreenshots,
  screenshotError,
  sessionNote,
  timeBreakdown,
  targetProgress,
  countedTodaySeconds,
  trackedTodaySeconds,
  displayedTimerSeconds,
  isExtraTime,
  normalSeconds,
  extraSeconds,
  isChangingTracking,
  isSubmittingTask,
  isOpeningDashboard,
  dashboardError,
  onProjectChange,
  onTaskChange,
  onSessionNoteChange,
  onTrackingToggle,
  onLoadScreenshots,
  onOpenScreenshots,
  idleRequestOptions,
  onRequestManualTime,
}: {
  status: AgentStatus;
  statusLabel: string;
  selectedProject: AgentProject | null;
  projectFilterId: string;
  visibleTasks: AgentTask[];
  recentScreenshots: RecentScreenshot[] | null;
  isLoadingScreenshots: boolean;
  screenshotError: string | null;
  sessionNote: string;
  timeBreakdown: {
    segments: Array<{
      label: string;
      seconds: number;
      className: string;
      counted: boolean;
    }>;
    total: number;
  };
  targetProgress: number;
  countedTodaySeconds: number;
  trackedTodaySeconds: number;
  displayedTimerSeconds: number;
  isExtraTime: boolean;
  normalSeconds: number;
  extraSeconds: number;
  isChangingTracking: boolean;
  isSubmittingTask: boolean;
  isOpeningDashboard: boolean;
  dashboardError: string | null;
  onProjectChange: (projectId: string) => void;
  onTaskChange: (taskId: string) => void;
  onSessionNoteChange: (note: string) => void;
  onTrackingToggle: () => void;
  onLoadScreenshots: () => void;
  onOpenScreenshots: () => void;
  idleRequestOptions: IdleRequestOption[];
  onRequestManualTime: (option?: IdleRequestOption) => void;
}) {
  const todayIdleSeconds = Math.max(
    status.timeSummary?.today.idle_seconds ?? 0,
    status.todayTimeline?.idle_seconds ?? 0,
    status.eligibleIdleSeconds,
  );
  const requestableIdleMinuteTotal =
    totalRequestableIdleMinutes(idleRequestOptions);
  const isPaused = status.trackingPaused || status.trackingStatus === "paused";
  const shouldResume =
    isPaused ||
    status.trackingStatus === "offline" ||
    status.trackingStatus === "error";
  const overtimeLabel =
    extraSeconds <= 0
      ? null
      : status.extraTimeStatus === "pending_overtime"
        ? "Overtime pending approval"
        : "Extra time recorded only";
  const overtimeHelp =
    extraSeconds <= 0
      ? null
      : status.extraTimeStatus === "pending_overtime"
        ? "HR/Admin must approve this time before payroll."
        : "Recorded for review. It will not be paid unless HR/Admin approves it.";
  const overtimeStatus =
    extraSeconds <= 0
      ? "No overtime"
      : status.extraTimeStatus === "pending_overtime"
        ? "Pending approval"
        : "Recorded only";
  const paidShiftLabel =
    status.requestPolicy?.shift_start && status.requestPolicy.shift_end
      ? `${formatScheduledTime(status.requestPolicy.shift_start)}–${formatScheduledTime(status.requestPolicy.shift_end)}`
      : "Schedule not configured";
  const hasRunningSession = [
    "active",
    "starting",
    "idle",
    "locked",
    "sleeping",
  ].includes(status.trackingStatus);
  const workdayTiming = workdayTimingState({
    timelineStartedAt: status.todayTimeline?.first_started_at ?? null,
    timelineIsRunning: status.todayTimeline?.is_running ?? false,
    localSessionStartedAt: status.sessionStartedAt,
    localTrackingActive: hasRunningSession,
  });
  const workdayTimezone =
    status.todayTimeline?.timezone ??
    status.requestPolicy?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";
  const breaksToday = status.requestPolicy?.approved_leave_today
    ? []
    : todaysBreaks(status.requestPolicy?.break_rules);
  const savedBreak = status.breakBank?.policy_active ? status.breakBank : null;
  const breakNow = breakStatusAt(
    breaksToday,
    localMinutesAt(new Date().toISOString(), workdayTimezone),
  );
  const isAutomaticIdle =
    status.trackingStatus === "idle" &&
    !status.trackingPaused &&
    !status.scheduledBreak;
  const heroStatusLabel = !hasRunningSession
    ? statusLabel
    : status.scheduledBreak &&
        !isPaused &&
        ["idle", "locked", "sleeping"].includes(status.trackingStatus)
      ? `On break · ${status.scheduledBreak.name}`
      : isExtraTime &&
          (isPaused ||
            ["idle", "locked", "sleeping"].includes(status.trackingStatus))
        ? "Off shift"
        : isPaused
          ? "Paused"
          : isExtraTime
            ? "Extra time active"
            : ["idle", "locked", "sleeping"].includes(status.trackingStatus)
              ? "Paid shift idle"
              : "Paid shift active";
  const arcDegrees = Math.round((targetProgress / 100) * 300);
  return (
    <section className="k-home">
      <div className="k-center">
        <div className="k-selectors">
          <label>
            Project
            <select
              value={projectFilterId}
              onChange={(event) => onProjectChange(event.target.value)}
            >
              <option value="">All projects</option>
              {status.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Task
            <select
              value={status.selectedTask?.id ?? "none"}
              disabled={isSubmittingTask}
              onChange={(event) => onTaskChange(event.target.value)}
            >
              <option value="none">Choose a task</option>
              {visibleTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          className="k-note"
          value={sessionNote}
          onChange={(event) => onSessionNoteChange(event.target.value)}
          placeholder="Add a note for this session (optional)..."
        />

        <div
          className="k-hero"
          style={
            {
              "--progress": targetProgress,
              "--arc-degrees": `${arcDegrees}deg`,
            } as CSSProperties
          }
        >
          <span
            className="k-hero-wireframe k-hero-wireframe-right"
            aria-hidden="true"
          />
          <span className="k-hero-icon">
            <KIcon name="briefcase" />
          </span>
          <div className="k-shift-context">
            <span>Paid shift</span>
            <strong>{paidShiftLabel}</strong>
          </div>
          {(breaksToday.length > 0 || savedBreak) && (
            <ul className="k-break-times" aria-label="Today's breaks">
              {breaksToday.map((item) => {
                const state =
                  breakNow.current === item
                    ? "now"
                    : breakNow.next === item
                      ? "next"
                      : null;
                return (
                  <li
                    key={`${item.name}-${item.start}`}
                    data-state={state ?? undefined}
                    title={
                      item.prayer
                        ? `Starts at today's ${item.prayer} adhan`
                        : undefined
                    }
                  >
                    <span>
                      {item.name}
                      {item.prayer ? ` · ${item.prayer}` : ""}
                    </span>
                    <strong>
                      {formatScheduledTime(item.start)}–
                      {formatScheduledTime(item.end)}
                    </strong>
                    {state === "now" && <em>Now</em>}
                    {state === "next" && <em>Next</em>}
                  </li>
                );
              })}
              {savedBreak && (
                <li
                  data-state="saved"
                  title={`Saved today ${formatSavedMinutes(savedBreak.earned_seconds)} · used on idle ${formatSavedMinutes(savedBreak.used_seconds ?? savedBreak.approved_seconds)}`}
                >
                  <span>Saved break</span>
                  <strong>
                    {formatSavedMinutes(savedBreak.remaining_seconds)}
                  </strong>
                </li>
              )}
            </ul>
          )}
          <span className="k-hero-pill">{heroStatusLabel}</span>
          {overtimeLabel && (
            <span className="k-overtime-pill">{overtimeLabel}</span>
          )}
          <div
            className="k-ring"
            aria-label={
              isAutomaticIdle
                ? `Idle for ${formatDuration(displayedTimerSeconds)} after the idle threshold`
                : isExtraTime
                  ? `Recorded overtime ${formatDuration(displayedTimerSeconds)}`
                  : `Worked today ${formatDuration(trackedTodaySeconds)}; ${formatDuration(countedTodaySeconds)} counts toward the ${formatDuration(status.dailyTargetSeconds)} target`
            }
          >
            <span className="k-gauge-mark mark-0">0h</span>
            <span className="k-gauge-mark mark-2">2h</span>
            <span className="k-gauge-mark mark-4">4h</span>
            <span className="k-gauge-mark mark-6">6h</span>
            <span className="k-gauge-mark mark-8">8h</span>
            <div className="k-gauge-readout">
              <strong>{formatDuration(displayedTimerSeconds)}</strong>
              <small>
                {isAutomaticIdle
                  ? "Idle time (outside breaks)"
                  : isExtraTime
                    ? "Overtime recorded today"
                    : `Worked today · ${targetProgress}% of ${formatDuration(status.dailyTargetSeconds)} target`}
              </small>
            </div>
          </div>
          {overtimeHelp && <p className="k-overtime-note">{overtimeHelp}</p>}
          <p>
            {selectedProject?.name ??
              status.selectedTask?.projectName ??
              "No project"}{" "}
            - {status.selectedTask?.name ?? "No task selected"}
          </p>
          <div className="k-actions">
            <button
              type="button"
              className={shouldResume ? "k-primary" : "k-warning"}
              onClick={onTrackingToggle}
              disabled={isChangingTracking}
            >
              {isChangingTracking
                ? "Please wait..."
                : shouldResume
                  ? "Resume"
                  : "Pause"}
            </button>
          </div>
          <div className="k-hero-meta">
            <div>
              <KIcon name="tasks" />
              <span>Activity</span>
              <strong>{status.activityPercent}%</strong>
            </div>
            <div>
              <KIcon name="timer" />
              <span>Current session</span>
              <strong>{formatDuration(status.activeSeconds)}</strong>
            </div>
            <div>
              <KIcon name="worked" />
              <span>Normal</span>
              <strong>{formatDuration(normalSeconds)}</strong>
            </div>
            <div>
              <KIcon name="dashboard" />
              <span>Overtime</span>
              <strong>{formatDuration(extraSeconds)}</strong>
              <small className="k-meta-note">{overtimeStatus}</small>
            </div>
            <div>
              <KIcon name="idle" />
              <span>Idle</span>
              <strong>{formatDuration(todayIdleSeconds)}</strong>
              <small className="k-meta-note">
                {requestableIdleMinuteTotal > 0
                  ? `${requestableIdleMinuteTotal} min requestable`
                  : "No requestable time"}
              </small>
              <button
                type="button"
                className="k-meta-action"
                onClick={() => onRequestManualTime(idleRequestOptions[0])}
                disabled={!idleRequestOptions.length}
              >
                Explain idle
              </button>
            </div>
          </div>
        </div>

        <section
          className="k-workday-time-strip"
          aria-label="Today's workday timing"
        >
          <div>
            <span>Started at</span>
            <strong>
              {status.todayTimeline?.first_started_at
                ? formatTimelineStart(status.todayTimeline)
                : workdayTiming.startedAt
                  ? formatClock(workdayTiming.startedAt, workdayTimezone)
                  : "Not started"}
            </strong>
          </div>
          <div>
            <span>Last activity</span>
            <strong>
              {status.todayTimeline?.last_activity_at
                ? formatClock(
                    status.todayTimeline.last_activity_at,
                    status.todayTimeline.timezone,
                  )
                : workdayTiming.localSyncPending
                  ? "Sync pending"
                  : "—"}
            </strong>
          </div>
          <div>
            <span>{workdayTiming.isRunning ? "Session" : "Signed out"}</span>
            <strong>
              {status.todayTimeline?.is_running
                ? "Still running - no sign-out yet"
                : workdayTiming.localSyncPending
                  ? "Running locally - syncing"
                  : status.todayTimeline?.last_ended_at
                    ? formatClock(
                        status.todayTimeline.last_ended_at,
                        status.todayTimeline.timezone,
                      )
                    : "—"}
            </strong>
          </div>
        </section>

        <div className="k-stat-grid">
          <Stat label="Today" value={formatDuration(trackedTodaySeconds)} />
          <Stat
            label="This week"
            value={formatDuration(
              status.timeSummary?.week.tracked_active_seconds ?? 0,
            )}
          />
          <Stat label="Session" value={formatDuration(status.activeSeconds)} />
          <Stat
            label="Activity"
            value={`${status.activityPercent}%`}
            tone="good"
          />
          <Stat
            label="Idle"
            value={formatDuration(todayIdleSeconds)}
            tone="warn"
          />
        </div>

        <section className="k-breakdown">
          <div className="k-row">
            <strong>Daily target</strong>
            <span>
              {formatDuration(countedTodaySeconds)} /{" "}
              {formatDuration(status.dailyTargetSeconds)} - {targetProgress}%
            </span>
          </div>
          <div className="k-breakdown-bar">
            {timeBreakdown.segments.map((segment) =>
              segment.seconds > 0 ? (
                <i
                  key={segment.label}
                  className={`segment-${segment.className}`}
                  style={{
                    width: `${(segment.seconds / timeBreakdown.total) * 100}%`,
                  }}
                  title={`${segment.label}: ${formatDuration(segment.seconds)}`}
                />
              ) : null,
            )}
          </div>
          <div className="k-legend">
            {timeBreakdown.segments.map((segment) => (
              <span key={segment.label}>
                <i className={`segment-${segment.className}`} /> {segment.label}{" "}
                {formatDuration(segment.seconds)}
              </span>
            ))}
          </div>
        </section>
      </div>

      <aside className="k-right">
        <section className="k-side-section">
          <div className="k-row">
            <strong>Latest screenshot</strong>
            <button
              type="button"
              onClick={onOpenScreenshots}
              disabled={isOpeningDashboard}
            >
              View all
            </button>
          </div>
          {!recentScreenshots && (
            <button
              type="button"
              className="k-shot-placeholder"
              onClick={onLoadScreenshots}
              disabled={isLoadingScreenshots}
            >
              {isLoadingScreenshots ? "Loading..." : "Show latest capture"}
            </button>
          )}
          {recentScreenshots?.[0] && (
            <figure className="k-shot">
              <img
                src={recentScreenshots[0].dataUrl}
                alt={recentScreenshots[0].displayName ?? "Latest screenshot"}
              />
              <figcaption>
                <span>{formatTimestamp(recentScreenshots[0].capturedAt)}</span>
                <b
                  className={
                    status.connectionStatus === "online" ? "k-ok" : "k-muted"
                  }
                >
                  {screenshotSyncLabel(status.connectionStatus)}
                </b>
              </figcaption>
            </figure>
          )}
          {recentScreenshots?.length === 0 && (
            <p className="k-muted">No screenshots have been uploaded yet.</p>
          )}
          {screenshotError && <p className="k-error">{screenshotError}</p>}
          {dashboardError && <p className="k-error">{dashboardError}</p>}
        </section>
        {status.todayTimeline && (
          <Timeline
            timeline={status.todayTimeline}
            locallyEndedIdleAt={status.locallyEndedIdleAt}
            idleRequestOptions={idleRequestOptions}
            onRequestIdleTime={onRequestManualTime}
          />
        )}
        {status.recentTasks.length > 0 && (
          <section className="k-side-section">
            <strong>Recent tasks</strong>
            <div className="k-task-list">
              {status.recentTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onTaskChange(task.id)}
                >
                  <span>{task.name}</span>
                  <small>{task.projectName}</small>
                  <b>{formatDuration(task.trackedSeconds)}</b>
                </button>
              ))}
            </div>
          </section>
        )}
      </aside>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className={tone ? `k-stat k-${tone}` : "k-stat"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Timeline({
  timeline,
  locallyEndedIdleAt,
  idleRequestOptions,
  onRequestIdleTime,
  workspace = false,
}: {
  timeline: WorkdayTimeline;
  locallyEndedIdleAt: string | null;
  idleRequestOptions: IdleRequestOption[];
  onRequestIdleTime: (option: IdleRequestOption) => void;
  workspace?: boolean;
}) {
  const requestableMinutes = totalRequestableIdleMinutes(idleRequestOptions);
  return (
    <section
      className={workspace ? "wp-card wp-shift-timeline" : "k-side-section"}
    >
      {workspace && (
        <header className="wp-card-heading">
          <div>
            <h2>Today's timeline</h2>
            <p>A full view of your work, breaks and time away.</p>
          </div>
          <span className="wp-badge">
            {timeline.intervals.length}{" "}
            {timeline.intervals.length === 1 ? "period" : "periods"}
          </span>
        </header>
      )}
      {idleRequestOptions.length ? (
        <section
          className="k-idle-needs"
          aria-label="Idle periods needing explanation"
        >
          <header>
            <strong>Needs explanation</strong>
            <span>{requestableMinutes} min requestable</span>
          </header>
          <div className="k-idle-needs-list">
            {idleRequestOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className="k-idle-needs-item"
                onClick={() => onRequestIdleTime(option)}
              >
                <i className="k-timeline-icon">
                  <KIcon name="idle" />
                </i>
                <span>
                  {formatClock(option.startedAt, timeline.timezone)} -{" "}
                  {formatClock(option.endedAt, timeline.timezone)}
                </span>
                <small>
                  {formatDuration(option.durationSeconds)} idle period
                </small>
                <b>Explain up to {requestableIdleMinutes(option)} min</b>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {!workspace && <strong>Today's timeline</strong>}
      <div
        className={workspace ? "wp-shift-events" : "k-timeline"}
        role={workspace ? "list" : undefined}
        aria-label={workspace ? "Shift activity" : undefined}
      >
        {workspace &&
          timeline.intervals.length === 0 &&
          !timeline.approved_leave && (
            <div className="wp-empty" role="listitem">
              <span className="wp-empty-icon">
                <TrackerIcon className="ri-timer-line" aria-hidden="true" />
              </span>
              <h3>No activity recorded yet</h3>
              <p>Your recorded work and breaks will appear here.</p>
            </div>
          )}
        {timeline.intervals.length === 0 && timeline.approved_leave ? (
          <div
            className="k-line-leave"
            role={workspace ? "listitem" : undefined}
          >
            <i className="k-timeline-icon">
              <KIcon name="idle" />
            </i>
            <span>Today</span>
            <b>Leave</b>
            <small>Approved</small>
          </div>
        ) : null}
        {timelineIntervalsForDisplay(timeline.intervals).map(
          (interval, index) => {
            const presentation = timelineIntervalPresentation(
              interval,
              locallyEndedIdleAt,
            );
            const displayType = timelineDisplayType(
              interval.type,
              Boolean(timeline.approved_leave),
              interval.work_category,
              interval.saved_break_cover,
            );
            const displaysWork =
              displayType === "worked" ||
              displayType === "extra" ||
              displayType === "break_work";
            const elapsed = formatDuration(
              presentation.isCurrent
                ? Math.max(
                    0,
                    Math.floor(
                      (Date.now() - new Date(interval.started_at).getTime()) /
                        1000,
                    ),
                  )
                : presentation.durationSeconds,
            );
            if (workspace) {
              return (
                <div
                  key={`${interval.session_id}-${interval.started_at}-${index}`}
                  className={`wp-shift-event is-${displayType}${presentation.isCurrent ? " is-current" : ""}`}
                  role="listitem"
                >
                  <span className="wp-event-icon" aria-hidden="true">
                    <KIcon name={interval.type} />
                  </span>
                  <div className="wp-event-copy">
                    <h3>{TIMELINE_LABELS[displayType]}</h3>
                    <p className="wp-event-period">
                      <time dateTime={interval.started_at}>
                        {formatClock(interval.started_at, timeline.timezone)}
                      </time>
                      <span aria-hidden="true">–</span>
                      {presentation.isCurrent ? (
                        "Until now"
                      ) : (
                        <time dateTime={presentation.endedAt ?? undefined}>
                          {formatClock(presentation.endedAt, timeline.timezone)}
                        </time>
                      )}
                    </p>
                    {displaysWork &&
                      (interval.task_name || interval.project_name) && (
                        <p className="wp-event-context">
                          {interval.task_name ?? interval.project_name}
                        </p>
                      )}
                  </div>
                  <div className="wp-event-meta">
                    <strong aria-label="Duration">{elapsed}</strong>
                    <span className="wp-badge">
                      {presentation.isCurrent ? "Ongoing" : "Completed"}
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={`${interval.session_id}-${interval.started_at}-${index}`}
                className={`k-line-${displayType}`}
              >
                <i className="k-timeline-icon">
                  <KIcon name={interval.type} />
                </i>
                <span>
                  {formatClock(interval.started_at, timeline.timezone)} -{" "}
                  {presentation.isCurrent
                    ? "Until now"
                    : formatClock(presentation.endedAt, timeline.timezone)}
                </span>
                <b
                  title={
                    displaysWork
                      ? (interval.task_name ??
                        interval.project_name ??
                        TIMELINE_LABELS[displayType])
                      : TIMELINE_LABELS[displayType]
                  }
                >
                  {TIMELINE_LABELS[displayType]}
                  {displaysWork && (interval.task_name || interval.project_name)
                    ? ` · ${interval.task_name ?? interval.project_name}`
                    : ""}
                </b>
                <small>{elapsed}</small>
              </div>
            );
          },
        )}
      </div>
      {workspace && timeline.last_activity_at && (
        <footer className="wp-card-footer">
          <p>
            <TrackerIcon className="ri-refresh-line" aria-hidden="true" />
            Last activity{" "}
            <time dateTime={timeline.last_activity_at}>
              {formatClock(timeline.last_activity_at, timeline.timezone)}
            </time>
          </p>
        </footer>
      )}
    </section>
  );
}

function TasksView({
  status,
  taskTeams,
  trackableTasks,
  taskError,
  trackingControlMessage,
  isSubmittingTask,
  newTaskName,
  newTaskDescription,
  newTaskTeamId,
  newTaskProjectId,
  newTaskStartDate,
  newTaskDeadline,
  taskCompletionNote,
  newChecklistTitle,
  onTaskChange,
  onTaskStage,
  onChecklistToggle,
  onDeleteChecklistItems,
  onChecklistTitleChange,
  onAddChecklistItem,
  onTaskCompletionNoteChange,
  onTrackingToggle,
  onNewTaskNameChange,
  onNewTaskDescriptionChange,
  onNewTaskTeamChange,
  onNewTaskProjectChange,
  onNewTaskStartDateChange,
  onNewTaskDeadlineChange,
  onCreateTask,
}: {
  status: AgentStatus;
  taskTeams: Array<[string, string]>;
  trackableTasks: AgentTask[];
  taskError: string | null;
  trackingControlMessage: string | null;
  isSubmittingTask: boolean;
  newTaskName: string;
  newTaskDescription: string;
  newTaskTeamId: string;
  newTaskProjectId: string;
  newTaskStartDate: string;
  newTaskDeadline: string;
  taskCompletionNote: string;
  newChecklistTitle: string;
  onTaskChange: (taskId: string) => void;
  onTaskStage: (
    stage: "assigned" | "in_progress" | "ready_for_review" | "blocked",
    note?: string,
  ) => void;
  onChecklistToggle: (itemId: string, completed: boolean) => void;
  onDeleteChecklistItems: (itemIds: string[]) => Promise<boolean>;
  onChecklistTitleChange: (value: string) => void;
  onAddChecklistItem: () => void;
  onTaskCompletionNoteChange: (value: string) => void;
  onTrackingToggle: () => void;
  onNewTaskNameChange: (value: string) => void;
  onNewTaskDescriptionChange: (value: string) => void;
  onNewTaskTeamChange: (value: string) => void;
  onNewTaskProjectChange: (value: string) => void;
  onNewTaskStartDateChange: (value: string) => void;
  onNewTaskDeadlineChange: (value: string) => void;
  onCreateTask: () => void;
}) {
  const selectedTask = status.selectedTask;
  const checklist = useMemo(
    () => selectedTask?.checklist ?? [],
    [selectedTask?.checklist],
  );
  const [selectedChecklistItemIds, setSelectedChecklistItemIds] = useState<
    string[]
  >([]);
  const completedChecklistCount = checklist.filter(
    (item) => item.completed,
  ).length;
  const canEditSelectedTask =
    Boolean(selectedTask?.canUpdateStage) &&
    !["ready_for_review", "completed", "rejected", "cancelled"].includes(
      selectedTask?.stage ?? "",
    );

  useEffect(() => {
    setSelectedChecklistItemIds([]);
  }, [selectedTask?.id]);

  useEffect(() => {
    const availableIds = new Set(checklist.map((item) => item.id));
    setSelectedChecklistItemIds((current) =>
      current.filter((itemId) => availableIds.has(itemId)),
    );
  }, [checklist]);

  function toggleChecklistSelection(itemId: string) {
    setSelectedChecklistItemIds((current) =>
      current.includes(itemId)
        ? current.filter((selectedId) => selectedId !== itemId)
        : [...current, itemId],
    );
  }

  async function deleteSelectedChecklistItems() {
    const deleted = await onDeleteChecklistItems(selectedChecklistItemIds);
    if (deleted) setSelectedChecklistItemIds([]);
  }

  return (
    <section className="k-page workspace-page wp-tasks">
      <WorkspacePageHeader title="Tasks" description="Plan your work and keep your current task moving." icon="ri-task-line" actions={<span className="wp-badge">{trackableTasks.length} available</span>} />
      <div className="k-panel wp-task-request">
        <div className="wp-section-heading">
          <div><h2>Create task request</h2><p>Share the details of your next task for review.</p></div>
          <TrackerIcon className="ri-add-circle-line" aria-hidden="true" />
        </div>
        <div className="k-form-grid">
          <label className="wide">
            Task name
            <input
              value={newTaskName}
              maxLength={255}
              placeholder="What are you working on?"
              disabled={isSubmittingTask}
              onChange={(event) => onNewTaskNameChange(event.target.value)}
            />
          </label>
          <label className="wide">
            Description
            <textarea
              value={newTaskDescription}
              rows={3}
              maxLength={1000}
              placeholder="Expected outcome or useful context"
              disabled={isSubmittingTask}
              onChange={(event) =>
                onNewTaskDescriptionChange(event.target.value)
              }
            />
          </label>
          <label>
            Team
            <select
              value={newTaskTeamId}
              aria-label="Team"
              disabled={isSubmittingTask}
              onChange={(event) => onNewTaskTeamChange(event.target.value)}
            >
              <option value="">Select team</option>
              {taskTeams.map(([teamId, teamName]) => (
                <option key={teamId} value={teamId}>
                  {teamName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project
            <select
              value={newTaskProjectId}
              aria-label="Project"
              disabled={isSubmittingTask || !newTaskTeamId}
              onChange={(event) => onNewTaskProjectChange(event.target.value)}
            >
              <option value="">Select project</option>
              {status.projects
                .filter((project) => project.team_id === newTaskTeamId)
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Start date
            <input
              type="date"
              value={newTaskStartDate}
              disabled={isSubmittingTask}
              onChange={(event) => onNewTaskStartDateChange(event.target.value)}
            />
          </label>
          <label>
            Deadline
            <input
              type="date"
              min={newTaskStartDate || undefined}
              value={newTaskDeadline}
              disabled={isSubmittingTask}
              onChange={(event) => onNewTaskDeadlineChange(event.target.value)}
            />
          </label>
        </div>
        <button
          className="k-primary"
          disabled={!newTaskName.trim() || isSubmittingTask}
          onClick={onCreateTask}
        >
          {isSubmittingTask ? "Submitting..." : "Submit request"}
        </button>
      </div>

      <div className="k-panel wp-current-task">
        <div className="wp-section-heading">
          <div><h2>Current task</h2><p>Choose what you’re working on and update your progress.</p></div>
          <span className="wp-badge">{selectedTask ? selectedTask.stage.replaceAll("_", " ") : "No task selected"}</span>
        </div>
        <div className="k-form-grid">
          <label>
            Task
            <select
              value={status.selectedTask?.id ?? "none"}
              aria-label="Task"
              disabled={isSubmittingTask}
              onChange={(event) => onTaskChange(event.target.value)}
            >
              <option value="none">Choose a task</option>
              {trackableTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.teamName} / {task.projectName} / {task.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stage
            <select
              value={status.selectedTask?.stage ?? "assigned"}
              aria-label="Stage"
              disabled={
                !status.selectedTask ||
                isSubmittingTask ||
                !status.selectedTask.canUpdateStage
              }
              onChange={(event) =>
                onTaskStage(
                  event.target.value as
                    "assigned" | "in_progress" | "ready_for_review" | "blocked",
                )
              }
            >
              {status.selectedTask?.stage === "backlog" && (
                <option value="backlog">Backlog</option>
              )}
              <option value="assigned">Assigned</option>
              <option value="in_progress">In progress</option>
              <option value="ready_for_review">Submit as finished</option>
              <option value="blocked">Report blocked</option>
            </select>
          </label>
        </div>
        {selectedTask && (
          <div className="k-task-work-card">
            <div className="k-task-work-header">
              <div>
                <h3>{selectedTask.name}</h3>
                <p>
                  {selectedTask.teamName} / {selectedTask.projectName}
                  {selectedTask.description
                    ? ` · ${selectedTask.description}`
                    : ""}
                </p>
              </div>
              <span className="k-task-stage-pill">
                {selectedTask.stage.replaceAll("_", " ")}
              </span>
            </div>

            <div className="k-checklist-box">
              <div className="k-section-row">
                <strong>Checklist</strong>
                <small>
                  {completedChecklistCount}/{checklist.length || 0} complete
                </small>
              </div>
              {checklist.length > 0 ? (
                <div className="k-checklist-items">
                  {checklist.map((item) => {
                    const selected = selectedChecklistItemIds.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`k-checklist-item${item.completed ? " done" : ""}${selected ? " selected" : ""}`}
                      >
                        <label>
                          <input
                            type="checkbox"
                            checked={item.completed}
                            disabled={!canEditSelectedTask || isSubmittingTask}
                            onChange={(event) =>
                              onChecklistToggle(item.id, event.target.checked)
                            }
                          />
                          <span>{item.title}</span>
                        </label>
                        {canEditSelectedTask && (
                          <button
                            type="button"
                            className="k-checklist-select"
                            aria-pressed={selected}
                            disabled={isSubmittingTask}
                            onClick={() => toggleChecklistSelection(item.id)}
                          >
                            {selected ? "Selected" : "Select"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {canEditSelectedTask &&
                    selectedChecklistItemIds.length > 0 && (
                      <div className="k-checklist-delete-row">
                        <span>{selectedChecklistItemIds.length} selected</span>
                        <button
                          type="button"
                          disabled={isSubmittingTask}
                          onClick={() => void deleteSelectedChecklistItems()}
                        >
                          {isSubmittingTask
                            ? "Deleting..."
                            : `Delete selected (${selectedChecklistItemIds.length})`}
                        </button>
                      </div>
                    )}
                </div>
              ) : (
                <p className="k-muted">
                  No checklist yet. Add the steps you need to finish.
                </p>
              )}
              {canEditSelectedTask && (
                <div className="k-checklist-add">
                  <input
                    value={newChecklistTitle}
                    maxLength={500}
                    placeholder="Add a checklist step..."
                    disabled={isSubmittingTask}
                    onChange={(event) =>
                      onChecklistTitleChange(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onAddChecklistItem();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={!newChecklistTitle.trim() || isSubmittingTask}
                    onClick={onAddChecklistItem}
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            <label className="k-completion-note">
              What did you do?
              <textarea
                value={taskCompletionNote}
                maxLength={1000}
                rows={3}
                placeholder="Write what you completed, links, blockers, or delivery notes..."
                disabled={!canEditSelectedTask || isSubmittingTask}
                onChange={(event) =>
                  onTaskCompletionNoteChange(event.target.value)
                }
              />
            </label>
            <button
              className="k-primary"
              disabled={!canEditSelectedTask || isSubmittingTask}
              onClick={() =>
                onTaskStage("ready_for_review", taskCompletionNote)
              }
            >
              {isSubmittingTask ? "Submitting..." : "Complete / submit work"}
            </button>
          </div>
        )}
        <div className="k-task-list k-task-list-grid">
          {trackableTasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={status.selectedTask?.id === task.id ? "active" : ""}
              disabled={isSubmittingTask}
              onClick={() => onTaskChange(task.id)}
            >
              <span>{task.name}</span>
              <small>{task.projectName}</small>
              <b>{formatDuration(task.activeSeconds)}</b>
            </button>
          ))}
        </div>
        <div className="wp-task-controls">
          <button
            type="button"
            className={status.trackingPaused ? "k-primary" : "k-warning"}
            onClick={onTrackingToggle}
          >
            <TrackerIcon className={status.trackingPaused ? "ri-play-circle-line" : "ri-pause-circle-line"} aria-hidden="true" />
            {status.trackingPaused ? "Resume" : "Pause"}
          </button>
          <p>{status.breakStartedAt ? "You’re on a break. Resume when you’re ready to work." : status.trackingPaused ? "Resume when you’re ready to continue." : "Your current work session is being tracked."}</p>
        </div>
        {trackingControlMessage && (
          <p className="k-success">{trackingControlMessage}</p>
        )}
        {taskError && <p className="k-error">{taskError}</p>}
      </div>
    </section>
  );
}

type RequestCentreProps = {
  status: AgentStatus;
  timeRequestReason: string;
  timeRequestError: string | null;
  timeRequestSuccess: string | null;
  selectedIdleRequestKey: string;
  idleRequestOptions: IdleRequestOption[];
  earlyLeaveDate: string;
  earlyLeaveTime: string;
  earlyLeaveMinutes: number;
  earlyLeaveReason: string;
  expandedRequest: "idle" | "early" | "leave" | null;
  leaveStartDate: string;
  leaveEndDate: string;
  leaveReason: string;
  leaveRequestError: string | null;
  leaveRequestSuccess: string | null;
  isSubmittingLeaveRequest: boolean;
  isSubmittingTimeRequest: boolean;
  onLeaveStartDateChange: (value: string) => void;
  onLeaveEndDateChange: (value: string) => void;
  onLeaveReasonChange: (value: string) => void;
  onSubmitLeaveRequest: (event: FormEvent<HTMLFormElement>) => void;
  onTimeRequestReasonChange: (value: string) => void;
  onSelectedIdleRequestChange: (value: string) => void;
  onEarlyLeaveDateChange: (value: string) => void;
  onEarlyLeaveTimeChange: (value: string) => void;
  onEarlyLeaveReasonChange: (value: string) => void;
  onExpandedRequestChange: (value: "idle" | "early" | "leave" | null) => void;
  onSubmitIdleTimeRequest: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitEarlyLeaveRequest: (event: FormEvent<HTMLFormElement>) => void;
  // Extra cards must render inside this scrolling page. Rendered as siblings
  // they land in the app shell grid and overlap the page.
  leadingContent?: ReactNode;
  children?: ReactNode;
};

function RequestDialogPortal({ children }: { children: ReactNode }) {
  const frame = document.querySelector(".tracker-frame");
  return frame ? createPortal(<div className="workspace-page wp-requests request-dialog-portal">{children}</div>, frame) : children;
}

function RequestCentreView(props: RequestCentreProps) {
  const {
    status,
    idleRequestOptions,
    selectedIdleRequestKey,
    expandedRequest,
    earlyLeaveDate,
    earlyLeaveTime,
    earlyLeaveMinutes,
    earlyLeaveReason,
    leaveStartDate,
    leaveEndDate,
    leaveReason,
  } = props;
  const [requestFilter, setRequestFilter] = useState<
    "all" | "pending" | "approved" | "rejected" | "cancelled"
  >("all");
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const policy = status.requestPolicy;
  const workingDays = policy?.working_days ?? [0, 1, 2, 3, 4];
  const leaveBalance = status.leaveRequests?.balance.remaining_days ?? 0;
  const selectedLeaveDays = countWorkingDays(
    leaveStartDate,
    leaveEndDate,
    workingDays,
  );
  const expectedLeaveBalance = Math.max(0, leaveBalance - selectedLeaveDays);
  const weeklyRemaining = policy?.weekly_early_leave_remaining_minutes ?? 0;
  const weeklyAllowance = policy?.weekly_early_leave_minutes ?? 120;
  const scheduledShift =
    policy?.shift_start && policy.shift_end
      ? `${formatScheduledTime(policy.shift_start)} - ${formatScheduledTime(policy.shift_end)}`
      : "Not configured";
  const earlyLeaveIsWorkday = workingDays.includes(
    weekdayIndex(earlyLeaveDate),
  );
  const selectedIdle =
    idleRequestOptions.find((item) => item.key === selectedIdleRequestKey) ??
    idleRequestOptions[0] ??
    null;
  const maxIdleMinutes = selectedIdle
    ? Math.max(1, requestableIdleMinutes(selectedIdle))
    : 0;
  const requests = useMemo(
    () =>
      [
        ...status.timeAdjustmentRequests.map((request) => ({
          id: request.id,
          type:
            request.request_type === "idle_time"
              ? "Explain Idle Time"
              : request.request_type === "early_leave"
                ? "Early Leave Permission"
                : "Time Adjustment",
          period:
            request.request_type === "idle_time" && request.source_start_at
              ? `${formatClock(request.source_start_at, policy?.timezone ?? "UTC")} - ${formatClock(request.source_end_at, policy?.timezone ?? "UTC")}`
              : request.requested_date,
          duration: `${request.requested_minutes} min`,
          createdAt: request.created_at,
          status: request.status,
          reason: request.reason,
          note: request.admin_note,
        })),
        ...(status.leaveRequests?.requests ?? []).map((request) => ({
          id: request.id,
          type: "Annual Leave",
          period:
            request.start_date === request.end_date
              ? request.start_date
              : `${request.start_date} - ${request.end_date}`,
          duration: `${request.requested_days} working day${request.requested_days === 1 ? "" : "s"}`,
          createdAt: request.created_at ?? request.start_date,
          status: request.status,
          reason: request.reason ?? "",
          note: null,
        })),
      ].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      ),
    [policy?.timezone, status.leaveRequests, status.timeAdjustmentRequests],
  );
  const filteredRequests = requests.filter(
    (request) => requestFilter === "all" || request.status === requestFilter,
  );

  const toggle = (type: "idle" | "early" | "leave") =>
    props.onExpandedRequestChange(expandedRequest === type ? null : type);

  const closeRequest = useRef(props.onExpandedRequestChange);
  useEffect(() => {
    closeRequest.current = props.onExpandedRequestChange;
  }, [props.onExpandedRequestChange]);
  useEffect(() => {
    if (!expandedRequest) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.querySelector<HTMLElement>(".wp-requests .k-request-dialog");
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ) ?? []).filter(element => element.getClientRects().length > 0);
    (dialog?.querySelector<HTMLInputElement>('input[type="radio"]:checked') ?? focusable()[0])?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRequest.current(null);
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [expandedRequest]);

  return (
    <section className="k-page k-requests-page workspace-page wp-requests">
      <WorkspacePageHeader
        title="Time & Leave Requests"
        description="Manage your time, plan your leave, and keep track of every request."
        icon="ri-file-list-3-line"
        actions={<span className="wp-badge"><span className="request-review-dot" />{requests.filter(request => request.status === "pending").length} pending review</span>}
      />

      <section className="k-summary-strip" aria-label="Request balances">
        <div>
          <span className="request-balance-icon"><TrackerIcon className="ri-time-line" aria-hidden="true" /></span>
          <div className="request-balance-copy">
            <span>Today&apos;s scheduled shift</span>
            <strong>{scheduledShift}</strong>
            <small>Your regular working hours</small>
          </div>
        </div>
        <div>
          <span className="request-balance-icon"><TrackerIcon className="ri-timer-line" aria-hidden="true" /></span>
          <div className="request-balance-copy">
            <span>Weekly early-leave balance</span>
            <strong>{weeklyRemaining} <em>min remaining</em></strong>
            <small>Of {weeklyAllowance} minutes this week</small>
          </div>
        </div>
        <div>
          <span className="request-balance-icon"><TrackerIcon className="ri-calendar-check-line" aria-hidden="true" /></span>
          <div className="request-balance-copy">
            <span>Annual-leave balance</span>
            <strong>{leaveBalance} <em>working days</em></strong>
            <small>Available for your next leave</small>
          </div>
        </div>
      </section>

      {props.leadingContent}

      <section className="k-request-centre">
        <div className="k-section-heading">
          <div>
            <h2>Request Centre</h2>
            <p>Choose what you need. We&apos;ll guide you through the details.</p>
          </div>
          <span className="request-section-label">3 request types</span>
        </div>

        <article
          className={`k-request-option ${expandedRequest === "idle" ? "is-open" : ""}`}
        >
          <div className="k-request-option-row">
            <span className="k-request-icon">
              <KIcon name="idle" />
            </span>
            <div className="k-request-copy">
              <h3>Explain Idle Time</h3>
              <p>
                Explain an idle period detected during your scheduled shift.
              </p>
            </div>
            <strong className="k-request-state">
              {idleRequestOptions.length
                ? `${idleRequestOptions.length} idle period${idleRequestOptions.length === 1 ? " requires" : "s require"} explanation`
                : "No unexplained idle periods during your scheduled working hours."}
            </strong>
            <button
              type="button"
              className="k-request-action"
              disabled={!idleRequestOptions.length}
              aria-expanded={expandedRequest === "idle"}
              onClick={() => toggle("idle")}
            >
              Explain
            </button>
          </div>
          {expandedRequest === "idle" && (
            <RequestDialogPortal>
            <div
              className="k-request-form-shell"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  props.onExpandedRequestChange(null);
                }
              }}
            >
              <form
                className="k-form k-request-dialog k-idle-request-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="idle-request-title"
                onSubmit={props.onSubmitIdleTimeRequest}
              >
                <header className="k-request-dialog-header">
                  <span className="idle-dialog-icon"><TrackerIcon className="ri-hourglass-line" aria-hidden="true" /></span>
                  <div className="idle-dialog-heading">
                    <h2 id="idle-request-title">Explain Idle Time</h2>
                    <p>
                      Select a period, then tell HR what you were working on.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="k-dialog-close"
                    aria-label="Close request"
                    onClick={() => props.onExpandedRequestChange(null)}
                  >
                    <TrackerIcon className="ri-close-line" aria-hidden="true" />
                  </button>
                </header>
                <div className="idle-request-body">
                <div className="idle-request-selection">
                  <fieldset className="idle-periods">
                    <legend>Detected idle periods <span>{idleRequestOptions.length}</span></legend>
                    <div className="idle-period-list">
                      {idleRequestOptions.map(option => (
                        <label key={option.key} className="idle-period-option" data-selected={selectedIdle?.key === option.key}>
                          <input
                            type="radio"
                            name="idle-request-period"
                            value={option.key}
                            checked={selectedIdle?.key === option.key}
                            onChange={() => props.onSelectedIdleRequestChange(option.key)}
                            aria-label={`${formatClock(option.startedAt, status.todayTimeline?.timezone ?? policy?.timezone ?? "UTC")} to ${formatClock(option.endedAt, status.todayTimeline?.timezone ?? policy?.timezone ?? "UTC")}, ${requestableIdleMinutes(option)} minutes`}
                          />
                          <span className="idle-period-copy">
                            <strong>{formatClock(option.startedAt, status.todayTimeline?.timezone ?? policy?.timezone ?? "UTC")} – {formatClock(option.endedAt, status.todayTimeline?.timezone ?? policy?.timezone ?? "UTC")}</strong>
                            <small>{new Date(option.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: status.todayTimeline?.timezone ?? policy?.timezone ?? "UTC" })} · {formatDuration(option.durationSeconds)} recorded</small>
                          </span>
                          <span className="idle-period-minutes">{requestableIdleMinutes(option)} <small>min</small></span>
                        </label>
                      ))}
                      {!idleRequestOptions.length && <p className="idle-no-periods">No idle periods are available to explain.</p>}
                    </div>
                  </fieldset>
                  <aside className="idle-request-total" aria-label="Requested time" aria-live="polite">
                    <span className="idle-total-icon"><TrackerIcon className="ri-time-line" aria-hidden="true" /></span>
                    <span>Requested time</span>
                    <strong>{selectedIdle ? maxIdleMinutes : 0}<small>min</small></strong>
                    <p>The full selected period will be sent for review.</p>
                  </aside>
                </div>
                <label className="idle-request-reason" htmlFor="idle-request-reason">
                  <span className="idle-reason-heading"><span id="idle-reason-label">What were you doing?</span><small>Required</small></span>
                  <textarea
                    id="idle-request-reason"
                    aria-labelledby="idle-reason-label"
                    aria-describedby="idle-reason-help"
                    value={props.timeRequestReason}
                    onChange={(event) =>
                      props.onTimeRequestReasonChange(event.target.value)
                    }
                    minLength={10}
                    maxLength={1000}
                    placeholder="For example: I was on a client call and taking notes away from my computer."
                    required
                  />
                  <span className="idle-reason-help" id="idle-reason-help"><span>At least 10 characters. A brief explanation is enough.</span><span>{props.timeRequestReason.length}/1000</span></span>
                </label>
                {props.timeRequestError && (
                  <p className="k-error" role="alert">{props.timeRequestError}</p>
                )}
                {props.timeRequestSuccess && (
                  <p className="k-success" role="status">{props.timeRequestSuccess}</p>
                )}
                </div>
                <footer className="k-form-footer idle-request-footer">
                  <span className="idle-review-note"><TrackerIcon className="ri-information-line" aria-hidden="true" />HR will review your explanation.</span>
                  <div className="idle-request-actions">
                    <button type="button" className="idle-request-cancel" onClick={() => props.onExpandedRequestChange(null)}>Cancel</button>
                    <button
                      type="submit"
                      className="k-primary"
                      disabled={
                        props.isSubmittingTimeRequest ||
                        !selectedIdle ||
                        props.timeRequestReason.trim().length < 10
                      }
                    >
                      <TrackerIcon className="ri-send-plane-line" aria-hidden="true" />
                      {props.isSubmittingTimeRequest
                        ? "Submitting..."
                        : "Submit to HR"}
                    </button>
                  </div>
                </footer>
              </form>
            </div>
            </RequestDialogPortal>
          )}
        </article>

        <article
          className={`k-request-option ${expandedRequest === "early" ? "is-open" : ""}`}
        >
          <div className="k-request-option-row">
            <span className="k-request-icon">
              <KIcon name="timer" />
            </span>
            <div className="k-request-copy">
              <h3>Early Leave Permission</h3>
              <p>
                Request permission to leave before your scheduled shift ends.
              </p>
            </div>
            <strong className="k-request-state">
              {weeklyRemaining} of {weeklyAllowance} weekly minutes remaining
            </strong>
            <button
              type="button"
              className="k-request-action"
              disabled={weeklyRemaining < 1 || !policy?.shift_end}
              aria-expanded={expandedRequest === "early"}
              onClick={() => toggle("early")}
            >
              Request
            </button>
          </div>
          {expandedRequest === "early" && (
            <div
              className="k-request-form-shell"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  props.onExpandedRequestChange(null);
                }
              }}
            >
              <form
                className="k-form k-request-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="early-request-title"
                onSubmit={props.onSubmitEarlyLeaveRequest}
              >
                <header className="k-request-dialog-header">
                  <div>
                    <h2 id="early-request-title">Early Leave Permission</h2>
                    <p>
                      Request permission to leave before your scheduled shift
                      ends.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="k-dialog-close"
                    aria-label="Close request"
                    onClick={() => props.onExpandedRequestChange(null)}
                  >
                    ×
                  </button>
                </header>
                <div className="k-request-form-grid k-request-form-grid-four">
                  <label>
                    Selected date
                    <input
                      type="date"
                      min={localDateKey()}
                      value={earlyLeaveDate}
                      onChange={(event) =>
                        props.onEarlyLeaveDateChange(event.target.value)
                      }
                      required
                    />
                  </label>
                  <label>
                    Scheduled shift
                    <input value={scheduledShift} disabled />
                  </label>
                  <label>
                    Requested leaving time
                    <input
                      type="time"
                      min={policy?.shift_start ?? undefined}
                      max={policy?.shift_end ?? undefined}
                      value={earlyLeaveTime}
                      onChange={(event) =>
                        props.onEarlyLeaveTimeChange(event.target.value)
                      }
                      required
                    />
                  </label>
                  <label>
                    Requested minutes
                    <input value={`${earlyLeaveMinutes} min`} disabled />
                  </label>
                </div>
                {!earlyLeaveIsWorkday && (
                  <p className="k-error">
                    The selected date is not a scheduled working day.
                  </p>
                )}
                <label>
                  Reason (required)
                  <textarea
                    value={earlyLeaveReason}
                    onChange={(event) =>
                      props.onEarlyLeaveReasonChange(event.target.value)
                    }
                    minLength={3}
                    maxLength={1000}
                    placeholder="Doctor appointment, family emergency..."
                    required
                  />
                </label>
                <div className="k-form-footer">
                  <span>
                    {Math.max(0, weeklyRemaining - earlyLeaveMinutes)} min would
                    remain
                  </span>
                  <button
                    className="k-primary"
                    disabled={
                      props.isSubmittingTimeRequest ||
                      earlyLeaveMinutes < 1 ||
                      earlyLeaveMinutes > weeklyRemaining ||
                      !earlyLeaveIsWorkday
                    }
                  >
                    {props.isSubmittingTimeRequest
                      ? "Submitting..."
                      : "Submit to HR"}
                  </button>
                </div>
                {props.timeRequestError && (
                  <p className="k-error">{props.timeRequestError}</p>
                )}
                {props.timeRequestSuccess && (
                  <p className="k-success">{props.timeRequestSuccess}</p>
                )}
              </form>
            </div>
          )}
        </article>

        <article
          className={`k-request-option ${expandedRequest === "leave" ? "is-open" : ""}`}
        >
          <div className="k-request-option-row">
            <span className="k-request-icon">
              <KIcon name="calendar" />
            </span>
            <div className="k-request-copy">
              <h3>Annual Leave</h3>
              <p>Request one or more complete working days of annual leave.</p>
            </div>
            <strong className="k-request-state">
              {leaveBalance} working days available
            </strong>
            <button
              type="button"
              className="k-request-action"
              disabled={leaveBalance <= 0}
              aria-expanded={expandedRequest === "leave"}
              onClick={() => toggle("leave")}
            >
              Plan leave
            </button>
          </div>
          {expandedRequest === "leave" && (
            <div
              className="k-request-form-shell"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  props.onExpandedRequestChange(null);
                }
              }}
            >
              <form
                className="k-form k-request-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="leave-request-title"
                onSubmit={props.onSubmitLeaveRequest}
              >
                <header className="k-request-dialog-header">
                  <div>
                    <h2 id="leave-request-title">Annual Leave</h2>
                    <p>Request one or more complete scheduled working days.</p>
                  </div>
                  <button
                    type="button"
                    className="k-dialog-close"
                    aria-label="Close request"
                    onClick={() => props.onExpandedRequestChange(null)}
                  >
                    ×
                  </button>
                </header>
                <div className="k-request-form-grid k-request-form-grid-four">
                  <label>
                    From date
                    <input
                      type="date"
                      min={localDateKey()}
                      value={leaveStartDate}
                      onChange={(event) =>
                        props.onLeaveStartDateChange(event.target.value)
                      }
                      required
                    />
                  </label>
                  <label>
                    To date
                    <input
                      type="date"
                      min={leaveStartDate || localDateKey()}
                      value={leaveEndDate}
                      onChange={(event) =>
                        props.onLeaveEndDateChange(event.target.value)
                      }
                      required
                    />
                  </label>
                  <label>
                    Calculated working days
                    <input
                      value={`${selectedLeaveDays} day${selectedLeaveDays === 1 ? "" : "s"}`}
                      disabled
                    />
                  </label>
                  <label>
                    Expected balance
                    <input value={`${expectedLeaveBalance} days`} disabled />
                  </label>
                </div>
                <div className="k-request-calculation">
                  <span>Current balance</span>
                  <strong>{leaveBalance} days</strong>
                  <span>After approval</span>
                  <strong>{expectedLeaveBalance} days</strong>
                </div>
                <label>
                  Notes (optional)
                  <textarea
                    value={leaveReason}
                    onChange={(event) =>
                      props.onLeaveReasonChange(event.target.value)
                    }
                    maxLength={1000}
                    placeholder="Add any helpful context for HR..."
                  />
                </label>
                <div className="k-form-footer">
                  <span>Only scheduled working days are counted.</span>
                  <button
                    className="k-primary"
                    disabled={
                      props.isSubmittingLeaveRequest ||
                      selectedLeaveDays < 1 ||
                      selectedLeaveDays > leaveBalance
                    }
                  >
                    {props.isSubmittingLeaveRequest
                      ? "Submitting..."
                      : "Submit to HR"}
                  </button>
                </div>
                {props.leaveRequestError && (
                  <p className="k-error">{props.leaveRequestError}</p>
                )}
                {props.leaveRequestSuccess && (
                  <p className="k-success">{props.leaveRequestSuccess}</p>
                )}
              </form>
            </div>
          )}
        </article>
      </section>

      <section className="k-request-history">
        <div className="k-section-heading k-history-heading">
          <div>
            <h2>My Requests</h2>
            <span>Track every request from one place</span>
          </div>
          <div className="k-filter-chips" aria-label="Filter requests">
            {(
              ["all", "pending", "approved", "rejected", "cancelled"] as const
            ).map((filter) => (
              <button
                key={filter}
                type="button"
                className={requestFilter === filter ? "active" : ""}
                aria-pressed={requestFilter === filter}
                onClick={() => setRequestFilter(filter)}
              >
                {filter[0].toUpperCase() + filter.slice(1)}
                <span>{filter === "all" ? requests.length : requests.filter(request => request.status === filter).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="k-request-list">
          {filteredRequests.length ? (
            filteredRequests.map((request) => (
              <div className="k-request-record" key={request.id}>
                <div className="k-request-record-row">
                  <strong>{request.type}</strong>
                  <span className="request-record-period">{request.period}</span>
                  <span className="request-record-duration">{request.duration}</span>
                  <span className="request-record-submitted">Submitted {formatTimestamp(request.createdAt)}</span>
                  <em className={`k-request-status ${request.status}`}>
                    {request.status}
                  </em>
                  <button
                    type="button"
                    aria-expanded={openRequestId === request.id}
                    onClick={() =>
                      setOpenRequestId(
                        openRequestId === request.id ? null : request.id,
                      )
                    }
                  >
                    {openRequestId === request.id
                      ? "Hide details"
                      : "View details"}
                  </button>
                </div>
                {openRequestId === request.id && (
                  <div className="k-request-record-details">
                    <span>Reason</span>
                    <p>{request.reason || "No notes provided."}</p>
                    {request.note && (
                      <>
                        <span>Review note</span>
                        <p>{request.note}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="k-empty-request-list">
              <span className="request-empty-icon"><TrackerIcon className="ri-file-list-3-line" aria-hidden="true" /></span>
              <h3>No {requestFilter === "all" ? "" : `${requestFilter} `}requests yet</h3>
              <p>{requestFilter === "all" ? "Your requests and their review status will appear here." : "Try another filter to see the rest of your requests."}</p>
            </div>
          )}
        </div>
      </section>

      {props.children}
    </section>
  );
}

function meetingStatusLabel(status: MeetingSummary["status"]) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending review";
}

// The single lifecycle+sync label. A meeting is only "Pending review" once the
// server has confirmed its end; before that it is clearly a local/waiting state.
function meetingStateLabel(
  syncState: MeetingSummary["syncState"],
  status: MeetingSummary["status"],
  lifecycleState: MeetingSummary["lifecycleState"],
) {
  switch (syncState) {
    case "start_pending":
      return "In progress · waiting to sync";
    case "start_synced":
      return "In progress · synced";
    case "end_pending":
      return "Ending · waiting to sync";
    case "start_error":
    case "end_error":
      return "Sync failed · tap Retry";
    default:
      if (lifecycleState === "active") return "In progress";
      return meetingStatusLabel(status);
  }
}

// A CSS-class-friendly kind for the badge color.
function meetingStateKind(
  syncState: MeetingSummary["syncState"],
  status: MeetingSummary["status"],
  lifecycleState: MeetingSummary["lifecycleState"],
) {
  if (syncState === "start_error" || syncState === "end_error") return "failed";
  if (syncState === "start_pending" || syncState === "end_pending")
    return "waiting";
  if (lifecycleState === "active") return "inprogress";
  return status;
}

function BreakBankCard({ status }: { status: AgentStatus }) {
  const bank = status.breakBank;
  // Saved breaks are switched on per company from the dashboard; nothing new
  // appears while the company has them switched off.
  if (!bank || !bank.policy_active) {
    return null;
  }
  const used = bank.used_seconds ?? bank.approved_seconds;

  return (
    <section className="k-panel k-break-bank">
      <h2>Saved break time</h2>
      <p>
        When you work through a scheduled break, those minutes are saved. Idle
        time later today is covered from them automatically. There is nothing to
        claim. Saved minutes do not carry over to the next day.
      </p>
      <div className="k-break-bank-stats">
        <div>
          <span className="k-break-bank-label">Left today</span>
          <strong>{formatDuration(bank.remaining_seconds)}</strong>
        </div>
        <div>
          <span className="k-break-bank-label">Saved today</span>
          <strong>{formatDuration(bank.earned_seconds)}</strong>
        </div>
        <div>
          <span className="k-break-bank-label">Used on idle</span>
          <strong>{formatDuration(used)}</strong>
        </div>
      </div>
      {bank.paid_late_allowance_seconds > 0 && (
        <p className="k-break-bank-hint">
          Paid late allowance applied today:{" "}
          {formatDuration(bank.paid_late_allowance_seconds)}.
        </p>
      )}
    </section>
  );
}

function MeetingView({
  status,
  onRefresh,
}: {
  status: AgentStatus;
  onRefresh: () => Promise<void>;
}) {
  const active = status.activeMeeting;
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [expectedMinutes, setExpectedMinutes] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // A bare tick that forces a re-render every second while any meeting is
  // active, so every live timer (the top card AND each active Recent row, which
  // may be running on the server without a local active meeting) stays current.
  const [, setTick] = useState(0);
  const hasActiveRow =
    Boolean(active) ||
    status.meetings.some((meeting) => meeting.lifecycleState === "active");

  useEffect(() => {
    void window.khaliduo?.refreshMeetings();
  }, []);

  useEffect(() => {
    if (!hasActiveRow) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveRow]);

  async function handleRetry() {
    setRetrying(true);
    try {
      await window.khaliduo?.retryMeetingSync();
      await onRefresh();
    } finally {
      setRetrying(false);
    }
  }

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await window.khaliduo?.startMeeting({
        title,
        reason,
        expectedEndMinutes: expectedMinutes,
      });
      if (result?.success) {
        setTitle("");
        setReason("");
        setMessage(result.message ?? "Meeting started.");
      } else {
        setError(result?.message ?? "Could not start the meeting.");
      }
      await onRefresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEnd() {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await window.khaliduo?.endMeeting();
      if (result?.success) {
        setMessage(result.message ?? "Meeting ended.");
      } else {
        setError(result?.message ?? "Could not end the meeting.");
      }
      await onRefresh();
    } finally {
      setSubmitting(false);
    }
  }

  const elapsedSeconds = active
    ? Math.max(
        0,
        Math.floor((Date.now() - Date.parse(active.startedAt)) / 1000),
      )
    : 0;
  const expectedEndClock = active
    ? new Date(active.expectedEndAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <section className="k-page workspace-page wp-meetings">
      <WorkspacePageHeader
        title="Meeting Mode"
        description="Record meetings and calls, and track their review status."
        icon="ri-video-chat-line"
        actions={<span className={`wp-badge${active ? " is-success" : ""}`}>{active ? "Meeting in progress" : "Meetings & calls"}</span>}
      />
      <div className="meeting-layout">
      <article className="wp-card meeting-main">
        <header className="wp-card-heading">
          <div>
            <h2>{active ? "Your current meeting" : "Start a meeting"}</h2>
            <p>{active ? "Focus on the conversation. We’ll keep track of the time." : "Add a few details before your meeting or call begins."}</p>
          </div>
          <span className="meeting-card-icon"><TrackerIcon className="ri-video-chat-line" aria-hidden="true" /></span>
        </header>

        {active ? (
          <div className="meeting-active">
            <span className={`k-meeting-badge k-meeting-${meetingStateKind(active.syncState, "pending", "active")}`}>
              <i aria-hidden="true" />
              {meetingStateLabel(active.syncState, "pending", "active")}
            </span>
            <p className="meeting-elapsed-label">Time in meeting</p>
            <p className="k-meeting-elapsed" role="timer" aria-label="Meeting elapsed time">
              {formatDuration(elapsedSeconds)}
            </p>
            <p className="k-meeting-active-title">{active.title}</p>
            <p className="meeting-active-reason">{active.reason}</p>
            <div className="meeting-active-times">
              <div><span>Started at</span><strong>{new Date(active.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong></div>
              <div><span>Automatic end</span><strong>{expectedEndClock}</strong></div>
            </div>
            <p className="meeting-notice"><TrackerIcon className="ri-information-line" aria-hidden="true" />Time moves to pending review once the meeting end is confirmed.</p>
            {active.lastError && <p className="k-error" role="alert">{active.lastError}</p>}
            <div className="meeting-form-footer">
            <p>You can finish earlier at any time.</p>
            <button
              type="button"
              className="k-primary"
              onClick={() => void handleEnd()}
              disabled={submitting}
            >
              <TrackerIcon className="ri-stop-circle-line" aria-hidden="true" />
              {submitting ? "Ending…" : "End meeting"}
            </button>
            </div>
          </div>
        ) : (
          <form className="meeting-form" onSubmit={handleStart} aria-busy={submitting}>
            <div className="meeting-field">
              <label htmlFor="meeting-title">Meeting title <span>Required</span></label>
              <input
                id="meeting-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Client call, standup, workshop…"
                maxLength={255}
                disabled={submitting}
                required
              />
            </div>
            <div className="meeting-field">
              <label htmlFor="meeting-reason">Reason <span>Required</span></label>
              <textarea
                id="meeting-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Briefly describe the meeting"
                maxLength={1000}
                minLength={3}
                disabled={submitting}
                aria-describedby="meeting-reason-help"
                required
              />
              <div className="meeting-field-help" id="meeting-reason-help"><span>A short description helps your reviewer understand the time.</span><span>{reason.length}/1000</span></div>
            </div>
            <div className="meeting-field">
              <label htmlFor="meeting-duration">Expected duration</label>
              <div className="meeting-duration-controls">
              <div className="meeting-duration-input">
                <TrackerIcon className="ri-time-line" aria-hidden="true" />
              <input
                id="meeting-duration"
                type="number"
                value={expectedMinutes}
                onChange={(event) =>
                  setExpectedMinutes(Number(event.target.value) || 0)
                }
                min={1}
                max={720}
                disabled={submitting}
                aria-describedby="meeting-duration-help"
                required
              />
                <span>minutes</span>
              </div>
              <div className="meeting-presets" role="group" aria-label="Meeting duration presets">
                {[15, 30, 45, 60].map(minutes => <button key={minutes} type="button" aria-pressed={expectedMinutes === minutes} disabled={submitting} onClick={() => setExpectedMinutes(minutes)}>{minutes} min</button>)}
              </div>
              </div>
              <p className="meeting-field-help" id="meeting-duration-help">Choose 1–720 minutes. The meeting ends automatically after this time.</p>
            </div>
            <div className="meeting-form-footer">
            <p><TrackerIcon className="ri-time-line" aria-hidden="true" />Your meeting timer starts immediately.</p>
            <button type="submit" className="k-primary" disabled={submitting}>
              <TrackerIcon className="ri-video-chat-line" aria-hidden="true" />
              {submitting ? "Starting…" : "Start meeting"}
            </button>
            </div>
          </form>
        )}
        {error && <p className="k-error" role="alert">{error}</p>}
        {message && <p className="k-success" role="status">{message}</p>}
      </article>

      <aside className="wp-card meeting-guide" aria-label="How meeting mode works">
        <span className="meeting-guide-icon"><TrackerIcon className="ri-information-line" aria-hidden="true" /></span>
        <h2>How meeting mode works</h2>
        <p>Step away from your keyboard for a meeting or call, and keep the time on record.</p>
        <ol>
          <li><span>1</span><div><strong>Start & focus</strong><p>Add your meeting details and start the timer.</p></div></li>
          <li><span>2</span><div><strong>Your usual capture settings</strong><p>Screenshot capture follows your normal settings during the meeting.</p></div></li>
          <li><span>3</span><div><strong>Finish & send for review</strong><p>Time is sent for review after the meeting ends. Approved meetings are paid.</p></div></li>
        </ol>
        <p className="meeting-guide-note"><TrackerIcon className="ri-shield-check-line" aria-hidden="true" />If a meeting is rejected, your genuine activity is still preserved.</p>
      </aside>
      </div>

      <article className="wp-card meeting-history">
        <header className="wp-card-heading">
          <div>
            <h2>Recent meetings</h2>
            <p>Your conversations, recorded time and review status.</p>
          </div>
          <span className="wp-badge">{status.meetings.length} {status.meetings.length === 1 ? "meeting" : "meetings"}</span>
        </header>
        {status.meetings.length === 0 ? (
          <div className="meeting-empty">
            <span><TrackerIcon className="ri-calendar-event-line" aria-hidden="true" /></span>
            <div><h3>No meetings yet</h3><p>Start your first meeting above. Its time and status will appear here.</p></div>
          </div>
        ) : (
          <ul className="k-meeting-list">
            {status.meetings.map((meeting) => {
              const isActive = meeting.lifecycleState === "active";
              const badgeKind = meetingStateKind(
                meeting.syncState,
                meeting.status,
                meeting.lifecycleState,
              );
              const badgeLabel = meetingStateLabel(
                meeting.syncState,
                meeting.status,
                meeting.lifecycleState,
              );
              // Each active row computes its own elapsed time from its own
              // startedAt — a server-side active meeting shows real elapsed time
              // even when there is no local active meeting.
              const rowSeconds =
                isActive && meeting.endedAt === null
                  ? Math.max(
                      0,
                      Math.floor(
                        (Date.now() - Date.parse(meeting.startedAt)) / 1000,
                      ),
                    )
                  : meeting.recordedSeconds;
              const failed =
                meeting.syncState === "start_error" ||
                meeting.syncState === "end_error";
              return (
                <li key={meeting.id}>
                  <span className="meeting-row-icon"><TrackerIcon className="ri-video-chat-line" aria-hidden="true" /></span>
                  <div className="meeting-row-copy">
                    <strong>{meeting.title}</strong>
                    <span className="k-meeting-hint">
                      {new Date(meeting.startedAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · {new Date(meeting.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {failed && meeting.lastError && (
                      <p className="k-error" role="alert">{meeting.lastError}</p>
                    )}
                    {failed && (
                      <button
                        type="button"
                        className="k-linklike"
                        onClick={() => void handleRetry()}
                        disabled={retrying}
                      >
                        {retrying ? "Retrying…" : "Retry sync"}
                      </button>
                    )}
                  </div>
                  <div className="meeting-row-duration"><span>{isActive ? "Elapsed" : "Recorded"}</span><strong>{formatDuration(rowSeconds)}</strong></div>
                  <span className={`k-meeting-badge k-meeting-${badgeKind}`}>
                    {badgeLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}

function SettingsView({
  status,
  quotesEnabled,
  onQuotesEnabledChange,
  quoteMinutes,
  onQuoteMinutesChange,
  quoteError,
  onLogout,
  isLoggingOut,
}: {
  status: AgentStatus;
  quotesEnabled: boolean;
  onQuotesEnabledChange: (enabled: boolean) => void;
  quoteMinutes: number;
  onQuoteMinutesChange: (minutes: number) => boolean;
  quoteError: string | null;
  onLogout: () => void;
  isLoggingOut: boolean;
}) {
  const [quoteInterval, setQuoteInterval] = useState(String(quoteMinutes));
  const [quoteIntervalSaved, setQuoteIntervalSaved] = useState(false);
  useEffect(() => setQuoteInterval(String(quoteMinutes)), [quoteMinutes]);

  return (
    <section className="k-page k-settings-page">
      <header className="k-page-header">
        <div>
          <h1>Settings</h1>
          <p>Device information and account controls.</p>
        </div>
      </header>
      <section className="k-panel native-quote-settings">
        <header className="native-quote-settings-header">
          <span className="native-quote-settings-icon"><TrackerIcon className="ri-chat-quote-line" aria-hidden="true" /></span>
          <div>
            <h2>Quote notifications</h2>
            <p>Choose when a quote appears on your desktop.</p>
          </div>
        </header>
        <label className="native-quote-toggle" htmlFor="native-quote-enabled">
          <span>
            <strong>Enable quote notifications</strong>
            <small>Bottom right of your screen, even when Khaliduo is minimized.</small>
          </span>
          <input id="native-quote-enabled" type="checkbox" role="switch" aria-label="Enable quote notifications" checked={quotesEnabled} onChange={(event) => onQuotesEnabledChange(event.target.checked)} />
        </label>
        <form
          className="native-quote-interval"
          onSubmit={(event) => {
            event.preventDefault();
            setQuoteIntervalSaved(onQuoteMinutesChange(Number(quoteInterval)));
          }}
        >
          <label className="native-quote-interval-label" htmlFor="native-quote-minutes">Remind me every</label>
          <div className="native-quote-interval-controls">
            <div className="native-quote-duration">
              <TrackerIcon className="ri-time-line" aria-hidden="true" />
              <input
                id="native-quote-minutes"
                type="number"
                min={1}
                max={1440}
                step={1}
                required
                value={quoteInterval}
                aria-describedby="native-quote-interval-help"
                onChange={(event) => {
                  setQuoteInterval(event.target.value);
                  setQuoteIntervalSaved(false);
                }}
              />
              <span aria-hidden="true">minutes</span>
            </div>
            <button type="submit" className="k-primary"><TrackerIcon className="ri-check-line" aria-hidden="true" />Save interval</button>
          </div>
          <p id="native-quote-interval-help" className="native-quote-help"><TrackerIcon className="ri-information-line" aria-hidden="true" /><span>Choose 1–1440 minutes. Saving starts a new countdown.</span></p>
          {quoteIntervalSaved && !quoteError && (
            <p role="status" className="native-quote-feedback is-success">
              <TrackerIcon className="ri-check-line" aria-hidden="true" />
              <span>{quotesEnabled
                ? `Saved. Your next quote is in ${quoteMinutes} ${quoteMinutes === 1 ? "minute" : "minutes"}.`
                : "Interval saved. Quote notifications are off."}</span>
            </p>
          )}
        </form>
        {quoteError && <p role="alert" className="native-quote-feedback is-error"><TrackerIcon className="ri-information-line" aria-hidden="true" /><span>{quoteError}</span></p>}
      </section>
      <details className="k-panel k-system-panel" open>
        <summary>System details</summary>
        <dl className="k-details">
          <div>
            <dt>Current session</dt>
            <dd>{formatTimestamp(status.sessionStartedAt)}</dd>
          </div>
          <div>
            <dt>Connection</dt>
            <dd>{status.connectionStatus}</dd>
          </div>
          <div>
            <dt>Last screenshot</dt>
            <dd>{formatTimestamp(status.lastScreenshotAt)}</dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{formatTimestamp(status.lastSuccessfulSyncAt)}</dd>
          </div>
          <div>
            <dt>Agent version</dt>
            <dd>{status.agentVersion}</dd>
          </div>
          {status.diagnostics && (
            <>
              <div>
                <dt>Build</dt>
                <dd>
                  {status.diagnostics.buildIdentifier} ·{" "}
                  {status.diagnostics.environment}
                </dd>
              </div>
              <div>
                <dt>Process ID</dt>
                <dd>{status.diagnostics.processId}</dd>
              </div>
              <div>
                <dt>API base URL</dt>
                <dd className="k-details-mono">
                  {status.diagnostics.apiBaseUrl}
                </dd>
              </div>
              <div>
                <dt>Data directory</dt>
                <dd className="k-details-mono">
                  {status.diagnostics.userDataPath}
                </dd>
              </div>
            </>
          )}
        </dl>
      </details>
      <section className="k-panel k-device-account">
        <div className="k-device-account-heading">
          <div>
            <h2>Signed-in account</h2>
            <p className="k-muted">
              This employee account is linked to this Windows device.
            </p>
          </div>
          <span
            className={`k-connection-badge ${status.enrolled ? "online" : "offline"}`}
          >
            {status.enrolled ? "Enrolled" : "Not enrolled"}
          </span>
        </div>
        <dl className="k-details k-identity-details">
          <div>
            <dt>Employee</dt>
            <dd>{status.employeeName || "—"}</dd>
          </div>
          <div>
            <dt>Work email</dt>
            <dd>{status.employeeEmail || "—"}</dd>
          </div>
          <div>
            <dt>Device</dt>
            <dd>{status.deviceName || "—"}</dd>
          </div>
          <div>
            <dt>Device ID</dt>
            <dd className="k-mono">{status.deviceId || "—"}</dd>
          </div>
          <div>
            <dt>MAC address</dt>
            <dd className="k-mono">{status.macAddress || "—"}</dd>
          </div>
          <div>
            <dt>Local IP</dt>
            <dd className="k-mono">{status.localIpAddress || "—"}</dd>
          </div>
        </dl>
      </section>
      <section className="k-panel k-device-account k-device-actions">
        <h2>Device account</h2>
        <p className="k-muted">
          Sign out only when this computer should stop tracking this employee.
        </p>
        <button
          className="k-danger-button"
          onClick={onLogout}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? "Signing out..." : "Sign out from this device"}
        </button>
      </section>
    </section>
  );
}

function MoreView({
  status,
  timeRequestMinutes,
  timeRequestReason,
  timeRequestError,
  timeRequestSuccess,
  selectedIdleRequestKey,
  idleRequestOptions,
  earlyLeaveMinutes,
  earlyLeaveReason,
  leaveStartDate,
  leaveEndDate,
  leaveReason,
  leaveRequestError,
  leaveRequestSuccess,
  isSubmittingLeaveRequest,
  isSubmittingTimeRequest,
  onLeaveStartDateChange,
  onLeaveEndDateChange,
  onLeaveReasonChange,
  onSubmitLeaveRequest,
  onTimeRequestMinutesChange,
  onTimeRequestReasonChange,
  onSelectedIdleRequestChange,
  onEarlyLeaveMinutesChange,
  onEarlyLeaveReasonChange,
  onSubmitIdleTimeRequest,
  onSubmitEarlyLeaveRequest,
  onLogout,
  isLoggingOut,
}: {
  status: AgentStatus;
  timeRequestMinutes: number;
  timeRequestReason: string;
  timeRequestError: string | null;
  timeRequestSuccess: string | null;
  selectedIdleRequestKey: string;
  idleRequestOptions: IdleRequestOption[];
  earlyLeaveMinutes: number;
  earlyLeaveReason: string;
  leaveStartDate: string;
  leaveEndDate: string;
  leaveReason: string;
  leaveRequestError: string | null;
  leaveRequestSuccess: string | null;
  isSubmittingLeaveRequest: boolean;
  isSubmittingTimeRequest: boolean;
  onLeaveStartDateChange: (value: string) => void;
  onLeaveEndDateChange: (value: string) => void;
  onLeaveReasonChange: (value: string) => void;
  onSubmitLeaveRequest: (event: FormEvent<HTMLFormElement>) => void;
  onTimeRequestMinutesChange: (value: number) => void;
  onTimeRequestReasonChange: (value: string) => void;
  onSelectedIdleRequestChange: (value: string) => void;
  onEarlyLeaveMinutesChange: (value: number) => void;
  onEarlyLeaveReasonChange: (value: string) => void;
  onSubmitIdleTimeRequest: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitEarlyLeaveRequest: (event: FormEvent<HTMLFormElement>) => void;
  onLogout: () => void;
  isLoggingOut: boolean;
}) {
  const selectedIdle =
    idleRequestOptions.find(
      (option) => option.key === selectedIdleRequestKey,
    ) ??
    idleRequestOptions[0] ??
    null;
  const maxIdleMinutes = selectedIdle
    ? Math.max(1, requestableIdleMinutes(selectedIdle))
    : 0;
  const recentRequests = status.timeAdjustmentRequests.slice(0, 5);
  return (
    <section className="k-page">
      <details className="k-panel k-system-panel">
        <summary>System details</summary>
        <dl className="k-details">
          <div>
            <dt>Current session</dt>
            <dd>{formatTimestamp(status.sessionStartedAt)}</dd>
          </div>
          <div>
            <dt>Connection</dt>
            <dd>{status.connectionStatus}</dd>
          </div>
          <div>
            <dt>Last screenshot</dt>
            <dd>{formatTimestamp(status.lastScreenshotAt)}</dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{formatTimestamp(status.lastSuccessfulSyncAt)}</dd>
          </div>
          <div>
            <dt>Agent version</dt>
            <dd>{status.agentVersion}</dd>
          </div>
          {status.diagnostics && (
            <>
              <div>
                <dt>Build</dt>
                <dd>
                  {status.diagnostics.buildIdentifier} ·{" "}
                  {status.diagnostics.environment}
                </dd>
              </div>
              <div>
                <dt>Process ID</dt>
                <dd>{status.diagnostics.processId}</dd>
              </div>
              <div>
                <dt>API base URL</dt>
                <dd className="k-details-mono">
                  {status.diagnostics.apiBaseUrl}
                </dd>
              </div>
              <div>
                <dt>Data directory</dt>
                <dd className="k-details-mono">
                  {status.diagnostics.userDataPath}
                </dd>
              </div>
            </>
          )}
        </dl>
      </details>

      <div className="k-request-grid">
        <article className="k-panel k-request-card">
          <header className="k-request-card-header">
            <span className="k-request-icon">
              <KIcon name="calendar" />
            </span>
            <div>
              <h2>Holiday request</h2>
              <p className="k-muted">
                {status.leaveRequests?.balance.remaining_days ?? "-"} of{" "}
                {status.leaveRequests?.balance.credit_days ?? "-"} annual days
                available
              </p>
            </div>
          </header>
          <form className="k-form" onSubmit={onSubmitLeaveRequest}>
            <div className="k-form-grid">
              <label>
                From
                <input
                  type="date"
                  value={leaveStartDate}
                  onChange={(event) =>
                    onLeaveStartDateChange(event.target.value)
                  }
                  required
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={leaveEndDate}
                  onChange={(event) => onLeaveEndDateChange(event.target.value)}
                  required
                />
              </label>
            </div>
            <label>
              Reason (optional)
              <textarea
                value={leaveReason}
                onChange={(event) => onLeaveReasonChange(event.target.value)}
                maxLength={1000}
                placeholder="Family event, personal appointment..."
              />
            </label>
            <button className="k-primary" disabled={isSubmittingLeaveRequest}>
              {isSubmittingLeaveRequest ? "Sending..." : "Request holiday"}
            </button>
            {leaveRequestError && (
              <p className="k-error">{leaveRequestError}</p>
            )}
            {leaveRequestSuccess && (
              <p className="k-success">{leaveRequestSuccess}</p>
            )}
          </form>
          {status.leaveRequests?.requests?.length ? (
            <div className="k-mini-list">
              {status.leaveRequests.requests.slice(0, 3).map((request) => (
                <div key={request.id}>
                  <span>
                    {request.start_date} – {request.end_date}
                  </span>
                  <strong>{request.status}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </article>

        <article className="k-panel k-request-card k-request-card-highlight">
          <header className="k-request-card-header">
            <span className="k-request-icon">
              <KIcon name="idle" />
            </span>
            <div>
              <h2>Idle time correction</h2>
              <p className="k-muted">
                Explain completed idle time and send it for approval.
              </p>
            </div>
          </header>
          <form className="k-form" onSubmit={onSubmitIdleTimeRequest}>
            <label>
              Idle period
              <select
                value={selectedIdle?.key ?? ""}
                onChange={(event) =>
                  onSelectedIdleRequestChange(event.target.value)
                }
                disabled={!idleRequestOptions.length}
              >
                {idleRequestOptions.length ? (
                  idleRequestOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {formatClock(
                        option.startedAt,
                        status.todayTimeline?.timezone ?? "UTC",
                      )}{" "}
                      -{" "}
                      {formatClock(
                        option.endedAt,
                        status.todayTimeline?.timezone ?? "UTC",
                      )}
                      {" | "}
                      {formatDuration(option.durationSeconds)} idle | up to{" "}
                      {requestableIdleMinutes(option)} min
                    </option>
                  ))
                ) : (
                  <option value="">No idle time available</option>
                )}
              </select>
            </label>
            <div className="k-request-meter">
              <span>Idle period / maximum request</span>
              <strong>
                {selectedIdle
                  ? `${formatDuration(selectedIdle.durationSeconds)} / ${requestableIdleMinutes(selectedIdle)} min`
                  : "00:00:00 / 0 min"}
              </strong>
            </div>
            <label>
              Minutes to count
              <input
                id="time-request-minutes"
                type="number"
                min={1}
                max={maxIdleMinutes || 1}
                value={timeRequestMinutes}
                disabled={!selectedIdle}
                onChange={(event) =>
                  onTimeRequestMinutesChange(
                    Math.min(
                      Math.max(1, Number(event.target.value)),
                      maxIdleMinutes || 1,
                    ),
                  )
                }
              />
            </label>
            <label>
              What were you doing?
              <textarea
                id="time-request-reason"
                value={timeRequestReason}
                onChange={(event) =>
                  onTimeRequestReasonChange(event.target.value)
                }
                minLength={3}
                maxLength={1000}
                placeholder="Client call, offline task, meeting, system issue..."
                required
                disabled={!selectedIdle}
              />
            </label>
            <button
              className="k-primary"
              disabled={
                isSubmittingTimeRequest ||
                !selectedIdle ||
                timeRequestMinutes < 1
              }
            >
              {isSubmittingTimeRequest ? "Submitting..." : "Request idle time"}
            </button>
            {timeRequestError && <p className="k-error">{timeRequestError}</p>}
            {timeRequestSuccess && (
              <p className="k-success">{timeRequestSuccess}</p>
            )}
          </form>
        </article>

        <article className="k-panel k-request-card">
          <header className="k-request-card-header">
            <span className="k-request-icon">
              <KIcon name="timer" />
            </span>
            <div>
              <h2>Early leave</h2>
              <p className="k-muted">
                Request up to 2 hours. HR or an admin will review it.
              </p>
            </div>
          </header>
          <form className="k-form" onSubmit={onSubmitEarlyLeaveRequest}>
            <label>
              Date
              <input type="date" value={localDateKey()} disabled />
            </label>
            <label>
              Permission minutes
              <input
                type="number"
                min={1}
                max={120}
                value={earlyLeaveMinutes}
                onChange={(event) =>
                  onEarlyLeaveMinutesChange(
                    Math.min(120, Math.max(1, Number(event.target.value))),
                  )
                }
              />
            </label>
            <label>
              Reason
              <textarea
                value={earlyLeaveReason}
                onChange={(event) =>
                  onEarlyLeaveReasonChange(event.target.value)
                }
                minLength={3}
                maxLength={1000}
                placeholder="Doctor appointment, family emergency..."
                required
              />
            </label>
            <button
              className="k-secondary-action"
              disabled={isSubmittingTimeRequest || earlyLeaveMinutes < 1}
            >
              {isSubmittingTimeRequest ? "Submitting..." : "Request permission"}
            </button>
          </form>
        </article>
      </div>

      <div className="k-panel k-request-history">
        <h2>Recent time requests</h2>
        <div className="k-mini-list">
          {recentRequests.length ? (
            recentRequests.map((request) => (
              <div key={request.id}>
                <span>
                  {(request.request_type === "idle_time" && "Idle time") ||
                    (request.request_type === "early_leave" && "Early leave") ||
                    "Manual time"}{" "}
                  · {formatDuration(request.requested_minutes * 60)}
                </span>
                <strong>{request.status}</strong>
              </div>
            ))
          ) : (
            <div>
              <span>No time requests yet</span>
              <strong>-</strong>
            </div>
          )}
        </div>
      </div>

      <div className="k-panel k-device-account">
        <h2>Device account</h2>
        <p className="k-muted">
          Sign out only when this computer should stop tracking this employee.
        </p>
        <button
          className="k-danger-button"
          onClick={onLogout}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? "Signing out..." : "Sign out from this device"}
        </button>
      </div>
    </section>
  );
}

// Kept temporarily for compatibility with older renderer snapshots; the live
// application uses RequestCentreView above.
void MoreView;

export default App;
