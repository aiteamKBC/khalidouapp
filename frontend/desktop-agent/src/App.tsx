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
  RecentScreenshot,
  WorkdayTimeline,
} from "./types/electron";
import "sweetalert2/dist/sweetalert2.min.css";
import "./App.css";

const fallbackStatus: AgentStatus = {
  enrolled: false,
  employeeName: "Not enrolled",
  employeeAvatarUrl: null,
  deviceName: "Windows device",
  trackingStatus: "starting",
  trackingPaused: false,
  sessionStartedAt: null,
  workedTodaySeconds: 0,
  activeSeconds: 0,
  idleSeconds: 0,
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
  lastIdleAlert: null,
  updateStatus: "idle",
  updateVersion: null,
  updatePercent: null,
  privacyNotice:
    "While this enrolled device is active, unlocked, and connected to AC power, company policy may capture periodic workplace screenshots even when no task timer is selected. It does not record typed text, passwords, webcam, microphone, or personal files.",
};

const TRACKABLE_TASK_STAGES = new Set(["backlog", "assigned", "in_progress"]);
const THEME_STORAGE_KEY = "khaliduo-theme";
const LIGHT_DEFAULT_RESET_KEY = "khaliduo-desktop-light-default-applied";

type TimelineInterval = WorkdayTimeline["intervals"][number];
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
  if (window.localStorage.getItem(LIGHT_DEFAULT_RESET_KEY) !== "1") {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    window.localStorage.setItem(LIGHT_DEFAULT_RESET_KEY, "1");
    return "light";
  }
  return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
    ? "dark"
    : "light";
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

function idleRequestKey(input: {
  session_id?: string;
  work_session_id?: string | null;
  started_at?: string;
  ended_at?: string | null;
  source_start_at?: string | null;
  source_end_at?: string | null;
}) {
  return `${input.session_id ?? input.work_session_id ?? ""}|${input.started_at ?? input.source_start_at ?? ""}|${input.ended_at ?? input.source_end_at ?? ""}`;
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
  | "locked"
  | "sleeping"
  | "settings";

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
    settings: (
      <>
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
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

function formatTimestamp(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatClock(value: string | null, timezone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
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
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
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

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "KD"
  );
}

function App() {
  const [status, setStatus] = useState<AgentStatus>(fallbackStatus);
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeView, setActiveView] = useState<
    "home" | "tasks" | "requests" | "settings"
  >("home");
  const [projectFilterId, setProjectFilterId] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  const [timeRequestMinutes, setTimeRequestMinutes] = useState(15);
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
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const shownIdleAlertId = useRef<string | null>(null);
  const promptedUpdateVersion = useRef<string | null>(null);
  const updatePromptActive = useRef(false);
  const updateStatusRef = useRef(status.updateStatus);
  updateStatusRef.current = status.updateStatus;
  const screenshotsLoadedForEnrollment = useRef(false);
  const isDesktopRuntime = Boolean(window.khaliduo);
  const desktopRuntimeMessage =
    "Open Khaliduo desktop app to enroll this device. The browser preview cannot access the secure desktop identity store.";

  const showRequiredUpdate = useCallback(async (version: string | null) => {
    const promptKey = version ?? "ready";
    if (
      updatePromptActive.current ||
      promptedUpdateVersion.current === promptKey
    )
      return;
    promptedUpdateVersion.current = promptKey;
    updatePromptActive.current = true;
    window.khaliduo?.setUpdateAttention(true);

    try {
      while (true) {
        const result = await Swal.fire({
          title: "Required update",
          text: `Khaliduo ${version ? `v${version}` : ""} is ready to install. You must install this update now to continue using the app. Your active session will be closed safely and Khaliduo will restart automatically.`,
          icon: "info",
          confirmButtonText: "Install update now",
          confirmButtonColor: "#e91e63",
          allowEscapeKey: false,
          allowOutsideClick: false,
          showCancelButton: false,
          showCloseButton: false,
          backdrop: true,
          heightAuto: false,
        });
        if (!result.isConfirmed) continue;

        const installResult = await window.khaliduo?.installUpdate();
        if (installResult?.success !== false) return;
        await Swal.fire({
          title: "Update could not start",
          text: installResult?.message ?? "Please try again.",
          icon: "error",
          confirmButtonText: "Try again",
          allowEscapeKey: false,
          allowOutsideClick: false,
          showCancelButton: false,
          showCloseButton: false,
        });
      }
    } finally {
      updatePromptActive.current = false;
      window.khaliduo?.setUpdateAttention(updateStatusRef.current === "ready");
      if (updateStatusRef.current !== "ready")
        promptedUpdateVersion.current = null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadStatus() {
      const nextStatus = await window.khaliduo?.getAgentStatus();
      if (mounted && nextStatus) {
        setStatus(nextStatus);
        if (nextStatus.lastIdleAlert) {
          void showIdleAlert(nextStatus.lastIdleAlert);
        }
      }
    }

    if (!window.khaliduo) {
      setEnrollmentError(desktopRuntimeMessage);
      return undefined;
    }

    void loadStatus();
    const removeIdleAlertListener =
      window.khaliduo.onIdleAlert?.((alert) => {
        void showIdleAlert(alert);
      }) ?? (() => undefined);
    const removeRequiredUpdateListener =
      window.khaliduo.onRequiredUpdate?.((update) => {
        void showRequiredUpdate(update.version);
      }) ?? (() => undefined);
    const interval = window.setInterval(() => void loadStatus(), 1000);

    return () => {
      mounted = false;
      removeIdleAlertListener();
      removeRequiredUpdateListener();
      window.clearInterval(interval);
    };
  }, [desktopRuntimeMessage, showRequiredUpdate]);

  useEffect(() => {
    if (status.updateStatus !== "ready") return;
    void showRequiredUpdate(status.updateVersion);
  }, [showRequiredUpdate, status.updateStatus, status.updateVersion]);

  useEffect(() => {
    if (status.selectedTask?.projectId) {
      setProjectFilterId(status.selectedTask.projectId);
    }
  }, [status.selectedTask?.projectId]);

  useEffect(() => {
    if (projectFilterId || status.selectedTask || status.projects.length === 0) {
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

  const timeBreakdown = useMemo(() => {
    const period = status.timeSummary?.today;
    const segments = [
      {
        label: "Normal shift work",
        seconds: status.normalSeconds,
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
        seconds: period?.idle_seconds ?? status.idleSeconds,
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
    status.idleSeconds,
    status.normalSeconds,
    status.timeSummary,
  ]);

  const idleRequestOptions = useMemo<IdleRequestOption[]>(() => {
    const timeline = status.todayTimeline;
    const policy = status.requestPolicy;
    const shiftStart = timeToMinutes(policy?.shift_start);
    const shiftEnd = timeToMinutes(policy?.shift_end);
    if (!timeline || !policy || shiftStart === null || shiftEnd === null)
      return [];
    if (
      !policy.working_days.includes(weekdayIndex(timeline.date)) ||
      shiftEnd <= shiftStart
    )
      return [];
    const requestedByIdle = new Map<string, number>();
    for (const request of status.timeAdjustmentRequests) {
      if (request.request_type !== "idle_time" || request.status === "rejected")
        continue;
      const key = idleRequestKey(request);
      requestedByIdle.set(
        key,
        (requestedByIdle.get(key) ?? 0) + request.requested_minutes * 60,
      );
    }
    return timeline.intervals
      .filter(
        (interval): interval is TimelineInterval & { ended_at: string } =>
          interval.type === "idle" &&
          Boolean(interval.ended_at) &&
          !interval.is_current &&
          interval.duration_seconds >= 60,
      )
      .filter(
        (interval) =>
          localDateAt(interval.started_at, policy.timezone) === timeline.date &&
          localDateAt(interval.ended_at, policy.timezone) === timeline.date &&
          localMinutesAt(interval.started_at, policy.timezone) >= shiftStart &&
          localMinutesAt(interval.ended_at, policy.timezone) <= shiftEnd,
      )
      .map((interval) => {
        const key = idleRequestKey(interval);
        return {
          key,
          sessionId: interval.session_id,
          startedAt: interval.started_at,
          endedAt: interval.ended_at,
          durationSeconds: interval.duration_seconds,
          availableSeconds: Math.max(
            0,
            interval.duration_seconds - (requestedByIdle.get(key) ?? 0),
          ),
          projectName: interval.project_name,
          taskName: interval.task_name,
        };
      })
      .filter((option) => option.availableSeconds >= 60)
      .reverse();
  }, [
    status.requestPolicy,
    status.timeAdjustmentRequests,
    status.todayTimeline,
  ]);

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
    if (!selectedIdleRequest) return;
    const maxMinutes = Math.max(
      1,
      Math.floor(selectedIdleRequest.availableSeconds / 60),
    );
    setTimeRequestMinutes((minutes) =>
      Math.min(Math.max(1, minutes), maxMinutes),
    );
  }, [selectedIdleRequest]);

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
  const normalSeconds = status.enrolled
    ? status.normalSeconds
    : Math.min(countedTodaySeconds, status.dailyTargetSeconds);
  const extraSeconds = status.enrolled
    ? status.extraSeconds
    : Math.max(0, countedTodaySeconds - status.dailyTargetSeconds);
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
  const isExtraTime = extraSeconds > 0;
  const timerTone = isPaused
    ? "paused"
    : isRunning
      ? isExtraTime
        ? "overtime"
        : "running"
      : "stopped";
  const statusText = isPaused
    ? "Paused"
    : isTracking
      ? isExtraTime
        ? "Overtime"
        : "Running"
      : "No timer running";

  async function refreshStatusAfterEnrollment() {
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
    const maxMinutes = Math.max(
      1,
      Math.floor(selectedIdleRequest.availableSeconds / 60),
    );
    if (
      !Number.isFinite(timeRequestMinutes) ||
      timeRequestMinutes < 1 ||
      timeRequestMinutes > maxMinutes
    ) {
      setTimeRequestError(
        `You can request up to ${maxMinutes} minute(s) from this idle period.`,
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
        requestedMinutes: timeRequestMinutes,
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
      setTimeRequestSuccess("Idle time request sent for review.");
      setSelectedIdleRequestKey("");
      if (result.status) setStatus(result.status);
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
    } finally {
      setIsSubmittingTask(false);
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
    setIsSubmittingTask(false);
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
    } finally {
      setIsSubmittingTask(false);
    }
  }

  async function handleTrackingToggle() {
    if (!window.khaliduo || !status.enrolled) return;
    setTrackingControlMessage(null);
    setIsChangingTracking(true);
    try {
      const shouldResume =
        status.trackingPaused ||
        status.trackingStatus === "paused" ||
        status.trackingStatus === "offline" ||
        status.trackingStatus === "error";
      let pauseOptions:
        { requestedMinutes?: number; reason?: string } | undefined;
      if (!shouldResume) {
        const remainingSeconds = status.paidPauseBalanceRemainingSeconds ?? 600;
        if (remainingSeconds < 60) {
          await Swal.fire({
            title: "Daily pause limit reached",
            text: "You have used your paid pause allowance for today. Please request extra pause time from HR or admin.",
            icon: "info",
            confirmButtonText: "OK",
            confirmButtonColor: "#2b1b67",
          });
          return;
        }
        const remainingMinutes = Math.floor(remainingSeconds / 60);
        const pauseChoice = await Swal.fire({
          title: "Start paid pause",
          text: `You have ${remainingMinutes} minute(s) available today.`,
          input: "number",
          inputValue: Math.min(5, remainingMinutes),
          inputAttributes: {
            min: "1",
            max: String(remainingMinutes),
            step: "1",
          },
          showCancelButton: true,
          confirmButtonText: "Start pause",
          cancelButtonText: "Cancel",
          confirmButtonColor: "#d28a00",
          inputValidator: (value) => {
            const minutes = Number(value);
            if (
              !Number.isFinite(minutes) ||
              minutes < 1 ||
              minutes > remainingMinutes
            ) {
              return `Choose between 1 and ${remainingMinutes} minute(s).`;
            }
            return null;
          },
        });
        if (!pauseChoice.isConfirmed) return;
        pauseOptions = { requestedMinutes: Number(pauseChoice.value) };
      }
      const result = shouldResume
        ? await window.khaliduo.resumeTracking()
        : await window.khaliduo.pauseTracking(pauseOptions);
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
            : "Paid pause started. Tracking and screenshots continue under company policy."),
      );
      setStatus(await window.khaliduo.getAgentStatus());
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
    } finally {
      setIsLoadingScreenshots(false);
    }
  }, [isLoadingScreenshots]);

  useEffect(() => {
    if (!status.enrolled || screenshotsLoadedForEnrollment.current) return;
    screenshotsLoadedForEnrollment.current = true;
    void handleLoadRecentScreenshots();
  }, [handleLoadRecentScreenshots, status.enrolled]);

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
    const lostMinutes = Math.max(1, Math.round(alert.lostSeconds / 60));
    let result: SweetAlertResult;
    try {
      result = await Swal.fire({
        title: "Do you want to continue tracking?",
        text: `Mouse activity returned after ${formatDuration(alert.lostSeconds)} of idle time. Continue tracking, stop now, or request the time manually if you were in an offline meeting or doing other work away from the computer.`,
        icon: "warning",
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: "Continue tracking",
        denyButtonText: "Stop tracking",
        cancelButtonText: "Request manual time",
        confirmButtonColor: "#1f7a4d",
        denyButtonColor: "#842029",
        allowEscapeKey: false,
        allowOutsideClick: false,
      });
    } finally {
      window.khaliduo?.setIdleAlertAttention(false);
    }

    if (result.isDenied) {
      const pauseResult = await window.khaliduo?.pauseTracking();
      if (pauseResult?.message) setTrackingControlMessage(pauseResult.message);
      const nextStatus = await window.khaliduo?.getAgentStatus();
      if (nextStatus) setStatus(nextStatus);
    } else if (result.dismiss === Swal.DismissReason.cancel) {
      setExpandedRequest("idle");
      setActiveView("requests");
      setTimeRequestMinutes(lostMinutes);
      setTimeRequestReason(
        "Offline meeting or work completed while away from the computer.",
      );
      window.setTimeout(
        () => document.getElementById("time-request-reason")?.focus(),
        50,
      );
    }
  }

  async function handleUpdateButton() {
    if (!window.khaliduo || isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      const result =
        status.updateStatus === "ready"
          ? await window.khaliduo.installUpdate()
          : await window.khaliduo.checkForUpdates();
      if (result?.success === false) {
        await Swal.fire({
          title: "Update check failed",
          text: result.message ?? "Khaliduo could not check for updates.",
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
    status.updateStatus === "ready"
      ? "Install update"
      : status.updateStatus === "downloading"
        ? `Updating ${Math.round(status.updatePercent ?? 0)}%`
        : status.updateStatus === "available"
          ? "Downloading update"
          : isCheckingUpdate || status.updateStatus === "checking"
            ? "Checking..."
            : "Check update";
  const updateButtonDisabled =
    isCheckingUpdate ||
    status.updateStatus === "checking" ||
    status.updateStatus === "downloading" ||
    status.updateStatus === "available";

  return (
    <main className="k-app" data-tone={timerTone} data-theme={theme}>
      <header className="k-titlebar">
        <div className="k-brand">
          <img src="./khaliduo-icon.png" alt="Khaliduo" />
          <strong>Kent Consultancy</strong>
        </div>
        <span className="k-chip">
          {statusText}{" "}
          {status.enrolled ? formatDuration(countedTodaySeconds) : ""}
        </span>
        <span className="k-spacer" />
        {status.screenshotMonitoringEnabled && (
          <span
            className={`k-capture-indicator ${status.screenshotCaptureActive ? "is-active" : "is-paused"}`}
            title={
              status.screenshotCaptureActive
                ? "Workplace screenshots are active"
                : status.powerSource === "battery"
                  ? "Screenshots pause while this device is on battery"
                  : "Screenshot monitoring is temporarily paused"
            }
          >
            <span aria-hidden="true">●</span>
            {status.screenshotCaptureActive ? "Screenshots active" : "Screenshots paused"}
          </span>
        )}
        <button
          type="button"
          className={`k-sync k-sync-${status.connectionStatus}`}
          onClick={() => void refreshStatusAfterEnrollment()}
          title="Refresh status"
        >
          {status.connectionStatus === "online" ? "Synced" : "Offline"}
        </button>
        {status.enrolled && (
          <button
            type="button"
            className="k-title-button"
            onClick={() => void handleOpenDashboard()}
            disabled={isOpeningDashboard}
          >
            Dashboard
          </button>
        )}
        <button
          type="button"
          className="k-theme-button"
          onClick={() => void handleUpdateButton()}
          disabled={updateButtonDisabled}
          title="Check for Khaliduo updates now"
        >
          {updateButtonLabel}
        </button>
        <button
          type="button"
          className="k-theme-button"
          onClick={() =>
            setTheme((current) => (current === "dark" ? "light" : "dark"))
          }
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <div className="k-window-controls" aria-label="Window controls">
          <button
            type="button"
            aria-label="Minimize"
            onClick={() => void window.khaliduo?.minimizeWindow()}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Maximize or restore"
            onClick={() => void window.khaliduo?.toggleMaximizeWindow()}
          >
            □
          </button>
          <button
            type="button"
            aria-label="Close"
            className="k-window-close"
            onClick={() => void window.khaliduo?.closeWindow()}
          >
            ×
          </button>
        </div>
      </header>

      {["available", "downloading", "ready"].includes(status.updateStatus) && (
        <section className="k-update" role="status" aria-live="assertive">
          <strong>
            Required update{" "}
            {status.updateVersion ? `v${status.updateVersion}` : ""}
          </strong>
          <span>
            {status.updateStatus === "ready"
              ? "Ready to install. Follow the installation message to continue."
              : status.updateStatus === "downloading"
                ? `Downloading: ${Math.round(status.updatePercent ?? 0)}%`
                : "Preparing the required download..."}
          </span>
        </section>
      )}

      {!status.enrolled ? (
        <EnrollmentView
          employeeEmail={employeeEmail}
          employeePassword={employeePassword}
          enrollmentError={enrollmentError}
          isSubmitting={isSubmitting}
          isDesktopRuntime={isDesktopRuntime}
          onEmailChange={setEmployeeEmail}
          onPasswordChange={setEmployeePassword}
          onCredentialEnrollment={handleCredentialEnrollment}
        />
      ) : (
        <>
          <Sidebar
            activeView={activeView}
            status={status}
            onViewChange={setActiveView}
            onOpenDashboard={() => void handleOpenDashboard()}
            isTracking={isTracking}
          />
          {activeView === "home" && (
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
                  setTimeRequestMinutes(
                    Math.max(1, Math.floor(option.availableSeconds / 60)),
                  );
                }
                setExpandedRequest("idle");
                setActiveView("requests");
              }}
            />
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
              status={status}
              timeRequestMinutes={timeRequestMinutes}
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
              onTimeRequestMinutesChange={setTimeRequestMinutes}
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
            />
          )}
          {activeView === "settings" && (
            <SettingsView
              status={status}
              onLogout={() => void handleLogout()}
              isLoggingOut={isLoggingOut}
            />
          )}
        </>
      )}

      <footer className="k-statusbar">
        <span>
          {isPaused ? "Timer paused" : isRunning ? "Timer running" : "Idle"}
        </span>
        <span
          className={status.connectionStatus === "online" ? "k-ok" : "k-danger"}
        >
          {status.connectionStatus === "online" ? "Synced" : "Offline"}
        </span>
        <span>Normal today {formatDuration(countedTodaySeconds)}</span>
        <span>Activity {status.activityPercent}%</span>
        <span>v{status.agentVersion}</span>
      </footer>
    </main>
  );
}

function EnrollmentView({
  employeeEmail,
  employeePassword,
  enrollmentError,
  isSubmitting,
  isDesktopRuntime,
  onEmailChange,
  onPasswordChange,
  onCredentialEnrollment,
}: {
  employeeEmail: string;
  employeePassword: string;
  enrollmentError: string | null;
  isSubmitting: boolean;
  isDesktopRuntime: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onCredentialEnrollment: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="k-enrollment">
      <div className="k-panel k-enroll-card">
        <h2>Sign in to set up this computer</h2>
        <p>Your device will be linked to your employee account.</p>
        <form className="k-form" onSubmit={onCredentialEnrollment}>
          <label>
            Work email
            <input
              type="email"
              value={employeeEmail}
              onChange={(event) => onEmailChange(event.target.value)}
              autoComplete="email"
              placeholder="name@company.com"
              disabled={isSubmitting}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={employeePassword}
              onChange={(event) => onPasswordChange(event.target.value)}
              autoComplete="current-password"
              placeholder="Employee password"
              disabled={isSubmitting}
              minLength={8}
              required
            />
          </label>
          <button type="submit" disabled={isSubmitting || !isDesktopRuntime}>
            {isSubmitting ? "Signing in..." : "Sign in and link device"}
          </button>
        </form>
        {enrollmentError && <p className="k-error">{enrollmentError}</p>}
      </div>
    </section>
  );
}

function Sidebar({
  activeView,
  status,
  onViewChange,
  onOpenDashboard,
  isTracking,
}: {
  activeView: "home" | "tasks" | "requests" | "settings";
  status: AgentStatus;
  onViewChange: (view: "home" | "tasks" | "requests" | "settings") => void;
  onOpenDashboard: () => void;
  isTracking: boolean;
}) {
  return (
    <aside className="k-sidebar">
      <nav>
        <span className="k-nav-title">Main</span>
        <button
          className={activeView === "home" ? "active" : ""}
          onClick={() => onViewChange("home")}
        >
          <KIcon name="timer" />
          <span>Timer</span>
        </button>
        <button
          className={activeView === "tasks" ? "active" : ""}
          onClick={() => onViewChange("tasks")}
        >
          <KIcon name="tasks" />
          <span>Tasks</span>
          <b>{status.tasks.length}</b>
        </button>
        <button
          className={activeView === "requests" ? "active" : ""}
          onClick={() => onViewChange("requests")}
        >
          <KIcon name="calendar" />
          <span>Requests</span>
        </button>
        <button
          className={activeView === "settings" ? "active" : ""}
          onClick={() => onViewChange("settings")}
        >
          <KIcon name="settings" />
          <span>Settings</span>
        </button>
        <span className="k-nav-title">Online</span>
        <button onClick={onOpenDashboard}>
          <KIcon name="dashboard" />
          <span>Dashboard</span>
        </button>
      </nav>
      <div className="k-user">
        <span className="k-avatar">
          {status.employeeAvatarUrl ? (
            <img src={status.employeeAvatarUrl} alt={status.employeeName} />
          ) : (
            initials(status.employeeName)
          )}
        </span>
        <div>
          <strong>{status.employeeName}</strong>
          <small
            className={
              status.connectionStatus === "online" || isTracking
                ? "k-ok"
                : "k-danger"
            }
          >
            {status.connectionStatus === "online"
              ? "Online - Synced"
              : isTracking
                ? "Online - Sync pending"
                : "Offline"}
          </small>
        </div>
      </div>
    </aside>
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
  const todayIdleSeconds =
    status.timeSummary?.today.idle_seconds ?? status.idleSeconds;
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
          <span className="k-hero-icon">
            <KIcon name="briefcase" />
          </span>
          <span className="k-hero-pill">
            {isPaused ? "Paused" : statusLabel}
          </span>
          {overtimeLabel && (
            <span className="k-overtime-pill">{overtimeLabel}</span>
          )}
          <div
            className="k-ring"
            aria-label={`Worked ${formatDuration(countedTodaySeconds)} of ${formatDuration(status.dailyTargetSeconds)}`}
          >
            <span className="k-gauge-mark mark-0">0h</span>
            <span className="k-gauge-mark mark-2">2h</span>
            <span className="k-gauge-mark mark-4">4h</span>
            <span className="k-gauge-mark mark-6">6h</span>
            <span className="k-gauge-mark mark-8">8h</span>
            <div className="k-gauge-readout">
              <strong>{formatDuration(countedTodaySeconds)}</strong>
              <small>
                {targetProgress}% of {formatDuration(status.dailyTargetSeconds)}
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
              <span>Activity</span>
              <strong>{status.activityPercent}%</strong>
            </div>
            <div>
              <span>Current session</span>
              <strong>{formatDuration(status.activeSeconds)}</strong>
            </div>
            <div>
              <span>Normal</span>
              <strong>{formatDuration(normalSeconds)}</strong>
            </div>
            <div>
              <span>Overtime</span>
              <strong>{formatDuration(extraSeconds)}</strong>
              <small className="k-meta-note">{overtimeStatus}</small>
            </div>
            <div>
              <span>Idle</span>
              <strong>{formatDuration(todayIdleSeconds)}</strong>
              <button
                type="button"
                className="k-meta-action"
                onClick={() => onRequestManualTime(idleRequestOptions[0])}
                disabled={!idleRequestOptions.length}
              >
                Request idle time
              </button>
            </div>
          </div>
        </div>

        <section className="k-workday-time-strip" aria-label="Today's workday timing">
          <div>
            <span>Started at</span>
            <strong>
              {status.todayTimeline?.first_started_at
                ? formatClock(
                    status.todayTimeline.first_started_at,
                    status.todayTimeline.timezone,
                  )
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
                : "—"}
            </strong>
          </div>
          <div>
            <span>Ended at</span>
            <strong>
              {status.todayTimeline?.is_running
                ? "In progress"
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
          <Stat
            label="Today"
            value={formatDuration(countedTodaySeconds)}
          />
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
                <b className="k-ok">Synced</b>
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
  idleRequestOptions,
  onRequestIdleTime,
}: {
  timeline: WorkdayTimeline;
  idleRequestOptions: IdleRequestOption[];
  onRequestIdleTime: (option: IdleRequestOption) => void;
}) {
  const labels = {
    worked: "Worked",
    idle: "Idle",
    locked: "Locked",
    sleeping: "Sleeping",
  } as const;
  const idleOptionsByKey = new Map(
    idleRequestOptions.map((option) => [option.key, option]),
  );
  return (
    <section className="k-side-section">
      <strong>Today's timeline</strong>
      <div className="k-timeline">
        {timeline.intervals.slice(-6).map((interval, index) => {
          const idleOption =
            interval.type === "idle"
              ? idleOptionsByKey.get(idleRequestKey(interval))
              : undefined;
          return (
            <div
              key={`${interval.session_id}-${interval.started_at}-${index}`}
              className={`k-line-${interval.type}`}
            >
              <i className="k-timeline-icon">
                <KIcon name={interval.type} />
              </i>
              <span>
                {formatClock(interval.started_at, timeline.timezone)} -{" "}
                {interval.is_current
                  ? "Now"
                  : formatClock(interval.ended_at, timeline.timezone)}
              </span>
              <b
                title={
                  interval.type === "worked"
                    ? interval.task_name ?? interval.project_name ?? labels[interval.type]
                    : labels[interval.type]
                }
              >
                {labels[interval.type]}
                {interval.type === "worked" &&
                (interval.task_name || interval.project_name)
                  ? ` · ${interval.task_name ?? interval.project_name}`
                  : ""}
              </b>
              <small>
                {formatDuration(
                  interval.is_current
                    ? Math.max(
                        0,
                        Math.floor(
                          (Date.now() -
                            new Date(interval.started_at).getTime()) /
                            1000,
                        ),
                      )
                    : interval.duration_seconds,
                )}
              </small>
              {idleOption ? (
                <button
                  type="button"
                  className="k-timeline-request"
                  onClick={() => onRequestIdleTime(idleOption)}
                >
                  Request
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
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
  const checklist = selectedTask?.checklist ?? [];
  const completedChecklistCount = checklist.filter(
    (item) => item.completed,
  ).length;
  const canEditSelectedTask =
    Boolean(selectedTask?.canUpdateStage) &&
    !["ready_for_review", "completed", "rejected", "cancelled"].includes(
      selectedTask?.stage ?? "",
    );

  return (
    <section className="k-page">
      <div className="k-panel">
        <h2>Create task request</h2>
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
            <input
              value={newTaskDescription}
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

      <div className="k-panel">
        <h2>Current task</h2>
        <div className="k-form-grid">
          <label>
            Task
            <select
              value={status.selectedTask?.id ?? "none"}
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
                  {checklist.map((item) => (
                    <label
                      key={item.id}
                      className={item.completed ? "done" : ""}
                    >
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
                  ))}
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
        <button
          className={status.trackingPaused ? "k-primary" : "k-warning"}
          onClick={onTrackingToggle}
        >
          {status.trackingPaused ? "Resume" : "Pause"}
        </button>
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
  timeRequestMinutes: number;
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
  onTimeRequestMinutesChange: (value: number) => void;
  onTimeRequestReasonChange: (value: string) => void;
  onSelectedIdleRequestChange: (value: string) => void;
  onEarlyLeaveDateChange: (value: string) => void;
  onEarlyLeaveTimeChange: (value: string) => void;
  onEarlyLeaveReasonChange: (value: string) => void;
  onExpandedRequestChange: (value: "idle" | "early" | "leave" | null) => void;
  onSubmitIdleTimeRequest: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitEarlyLeaveRequest: (event: FormEvent<HTMLFormElement>) => void;
};

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
    ? Math.max(1, Math.floor(selectedIdle.availableSeconds / 60))
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

  useEffect(() => {
    if (!expandedRequest) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onExpandedRequestChange(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expandedRequest, props]);

  return (
    <section className="k-page k-requests-page">
      <header className="k-page-header">
        <div>
          <h1>Time &amp; Leave Requests</h1>
          <p>
            Submit and track work-time explanations, permissions, and leave.
          </p>
        </div>
      </header>

      <section className="k-summary-strip" aria-label="Request balances">
        <div>
          <span>Today&apos;s scheduled shift</span>
          <strong>{scheduledShift}</strong>
        </div>
        <div>
          <span>Weekly early-leave balance</span>
          <strong>
            {weeklyRemaining} of {weeklyAllowance} min remaining
          </strong>
        </div>
        <div>
          <span>Annual-leave balance</span>
          <strong>{leaveBalance} working days</strong>
        </div>
      </section>

      <section className="k-request-centre">
        <div className="k-section-heading">
          <h2>Request Centre</h2>
          <span>Choose one request type</span>
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
                ? `${idleRequestOptions.length} idle period${idleRequestOptions.length === 1 ? "" : "s"} require explanation`
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
                aria-labelledby="idle-request-title"
                onSubmit={props.onSubmitIdleTimeRequest}
              >
                <header className="k-request-dialog-header">
                  <div>
                    <h2 id="idle-request-title">Explain Idle Time</h2>
                    <p>Choose the detected period and explain the work you completed.</p>
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
                <div className="k-request-form-grid">
                  <label>
                    Idle period
                    <select
                      value={selectedIdle?.key ?? ""}
                      onChange={(event) =>
                        props.onSelectedIdleRequestChange(event.target.value)
                      }
                      disabled={!idleRequestOptions.length}
                    >
                      {idleRequestOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {formatClock(
                            option.startedAt,
                            status.todayTimeline?.timezone ?? "UTC",
                          )}{" "}
                          -{" "}
                          {formatClock(
                            option.endedAt,
                            status.todayTimeline?.timezone ?? "UTC",
                          )}{" "}
                          · {formatDuration(option.availableSeconds)} available
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Minutes to count
                    <input
                      type="number"
                      min={1}
                      max={maxIdleMinutes || 1}
                      value={props.timeRequestMinutes}
                      disabled={!selectedIdle}
                      onChange={(event) =>
                        props.onTimeRequestMinutesChange(
                          Math.min(
                            Math.max(1, Number(event.target.value)),
                            maxIdleMinutes || 1,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <label>
                  What were you doing?
                  <textarea
                    value={props.timeRequestReason}
                    onChange={(event) =>
                      props.onTimeRequestReasonChange(event.target.value)
                    }
                    minLength={10}
                    maxLength={1000}
                    placeholder="Client call, meeting, offline work, or a system issue..."
                    required
                  />
                  <small>Required · at least 10 characters</small>
                </label>
                <div className="k-form-footer">
                  <span>
                    Eligible:{" "}
                    {selectedIdle
                      ? formatDuration(selectedIdle.availableSeconds)
                      : "00:00:00"}
                  </span>
                  <button
                    className="k-primary"
                    disabled={
                      props.isSubmittingTimeRequest ||
                      !selectedIdle ||
                      props.timeRequestReason.trim().length < 10
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
                    <p>Request permission to leave before your scheduled shift ends.</p>
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
                onClick={() => setRequestFilter(filter)}
              >
                {filter[0].toUpperCase() + filter.slice(1)}
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
                  <span>{request.period}</span>
                  <span>{request.duration}</span>
                  <span>Submitted {formatTimestamp(request.createdAt)}</span>
                  <em className={`k-request-status ${request.status}`}>
                    {request.status}
                  </em>
                  <button
                    type="button"
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
              No {requestFilter === "all" ? "" : `${requestFilter} `}requests
              yet.
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function SettingsView({
  status,
  onLogout,
  isLoggingOut,
}: {
  status: AgentStatus;
  onLogout: () => void;
  isLoggingOut: boolean;
}) {
  return (
    <section className="k-page k-settings-page">
      <header className="k-page-header">
        <div>
          <h1>Settings</h1>
          <p>Device information and account controls.</p>
        </div>
      </header>
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
        </dl>
      </details>
      <section className="k-panel k-device-account">
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
    ? Math.max(1, Math.floor(selectedIdle.availableSeconds / 60))
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
                      {" · "}
                      {formatDuration(option.availableSeconds)} available
                    </option>
                  ))
                ) : (
                  <option value="">No idle time available</option>
                )}
              </select>
            </label>
            <div className="k-request-meter">
              <span>Available to request</span>
              <strong>
                {selectedIdle
                  ? formatDuration(selectedIdle.availableSeconds)
                  : "00:00:00"}
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
