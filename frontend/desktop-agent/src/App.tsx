import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Swal, { type SweetAlertResult } from "sweetalert2";
import type { AgentProject, AgentStatus, AgentTask, IdleAlert, RecentScreenshot, WorkdayTimeline } from "./types/electron";
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
  connectionStatus: "offline",
  lastScreenshotAt: null,
  lastSuccessfulSyncAt: null,
  agentVersion: "1.0.0",
  tasks: [],
  projects: [],
  selectedTask: null,
  timeAdjustmentRequests: [],
  timeSummary: null,
  dailyTargetSeconds: 8 * 60 * 60,
  dailyTargetProgressPercent: 0,
  activityPercent: 0,
  recentTasks: [],
  todayTimeline: null,
  lastIdleAlert: null,
  updateStatus: "idle",
  updateVersion: null,
  updatePercent: null,
  privacyNotice:
    "This application records working time, online status, idle status, and periodic screenshots during work sessions. It does not record typed text, passwords, webcam, microphone, or personal files.",
};

const TRACKABLE_TASK_STAGES = new Set(["backlog", "assigned", "in_progress"]);

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((safeSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = Math.floor(safeSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
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

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "KD";
}

function App() {
  const [status, setStatus] = useState<AgentStatus>(fallbackStatus);
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeView, setActiveView] = useState<"home" | "tasks" | "more">("home");
  const [projectFilterId, setProjectFilterId] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  const [timeRequestMinutes, setTimeRequestMinutes] = useState(15);
  const [timeRequestReason, setTimeRequestReason] = useState("");
  const [timeRequestError, setTimeRequestError] = useState<string | null>(null);
  const [timeRequestSuccess, setTimeRequestSuccess] = useState<string | null>(null);
  const [isSubmittingTimeRequest, setIsSubmittingTimeRequest] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskTeamId, setNewTaskTeamId] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [newTaskStartDate, setNewTaskStartDate] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [trackingControlMessage, setTrackingControlMessage] = useState<string | null>(null);
  const [isChangingTracking, setIsChangingTracking] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [recentScreenshots, setRecentScreenshots] = useState<RecentScreenshot[] | null>(null);
  const [isLoadingScreenshots, setIsLoadingScreenshots] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.localStorage.getItem("khaliduo-theme") === "dark" ? "dark" : "light",
  );
  const shownIdleAlertId = useRef<string | null>(null);
  const promptedUpdateVersion = useRef<string | null>(null);
  const updatePromptActive = useRef(false);
  const screenshotsLoadedForEnrollment = useRef(false);
  const isDesktopRuntime = Boolean(window.khaliduo);
  const desktopRuntimeMessage =
    "Open Khaliduo desktop app to enroll this device. The browser preview cannot access the secure desktop identity store.";

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
  }, []);

  useEffect(() => {
    if (status.updateStatus !== "ready") return;
    void showRequiredUpdate(status.updateVersion);
  }, [status.updateStatus, status.updateVersion]);

  useEffect(() => {
    if (status.selectedTask?.projectId) {
      setProjectFilterId(status.selectedTask.projectId);
    }
  }, [status.selectedTask?.projectId]);

  useEffect(() => {
    window.localStorage.setItem("khaliduo-theme", theme);
  }, [theme]);

  const statusLabel = useMemo(
    () => status.trackingStatus.charAt(0).toUpperCase() + status.trackingStatus.slice(1),
    [status.trackingStatus],
  );

  const taskTeams = useMemo(
    () =>
      Array.from(
        new Map(status.projects.map((project) => [project.team_id, project.team_name])).entries(),
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
      status.projects.find((project) => project.id === status.selectedTask?.projectId) ??
      null,
    [projectFilterId, status.projects, status.selectedTask?.projectId],
  );

  const timeBreakdown = useMemo(() => {
    const period = status.timeSummary?.today;
    const segments = [
      {
        label: "Worked",
        seconds: status.workedTodaySeconds,
        className: "worked",
        counted: true,
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
      total: Math.max(1, segments.reduce((total, segment) => total + segment.seconds, 0)),
    };
  }, [status.idleSeconds, status.timeSummary, status.workedTodaySeconds]);

  const countedTodaySeconds = timeBreakdown.segments
    .filter((segment) => segment.counted)
    .reduce((total, segment) => total + segment.seconds, 0);
  const targetProgress = Math.max(0, Math.min(100, status.dailyTargetProgressPercent));
  const isPaused = status.trackingPaused || status.trackingStatus === "paused";
  const isTracking =
    status.enrolled &&
    !isPaused &&
    ["active", "idle", "locked", "sleeping", "starting"].includes(status.trackingStatus);
  const isRunning = isTracking && ["active", "starting"].includes(status.trackingStatus);
  const timerTone = isPaused ? "paused" : isRunning ? "running" : "stopped";
  const statusText = isPaused ? "Paused" : isTracking ? "Running" : "No timer running";

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
      const result = await window.khaliduo.enrollWithCredentials(employeeEmail, password);
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

  async function handleCodeEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEnrollmentError(null);
    if (!window.khaliduo) {
      setEnrollmentError(desktopRuntimeMessage);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await window.khaliduo.enrollDevice(enrollmentCode);
      if (!result.success) {
        setEnrollmentError(result.message ?? "Enrollment failed.");
        return;
      }

      setEnrollmentCode("");
      await refreshStatusAfterEnrollment();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTimeRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTimeRequestError(null);
    setTimeRequestSuccess(null);
    if (!window.khaliduo || !status.enrolled) {
      setTimeRequestError("Device must be enrolled before sending a request.");
      return;
    }
    if (!Number.isFinite(timeRequestMinutes) || timeRequestMinutes < 1 || timeRequestMinutes > 720) {
      setTimeRequestError("Minutes must be between 1 and 720.");
      return;
    }
    if (timeRequestReason.trim().length < 3) {
      setTimeRequestError("Write a reason of at least 3 characters before sending.");
      return;
    }

    setIsSubmittingTimeRequest(true);
    try {
      const result = await window.khaliduo.createTimeAdjustmentRequest(
        timeRequestMinutes,
        timeRequestReason,
      );
      if (!result.success) {
        setTimeRequestError(result.message ?? "Request failed.");
        return;
      }
      setTimeRequestReason("");
      setTimeRequestSuccess("Request sent.");
      if (result.status) setStatus(result.status);
    } finally {
      setIsSubmittingTimeRequest(false);
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
      const result = await window.khaliduo.setCurrentTask(taskId === "none" ? null : taskId);
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
      setTrackingControlMessage(result.message ?? "Task submitted for manager approval.");
      if (result.status) setStatus(result.status);
    } finally {
      setIsSubmittingTask(false);
    }
  }

  async function handleTaskStage(
    stage: "assigned" | "in_progress" | "ready_for_review" | "blocked",
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
      stage === "blocked"
        ? window
            .prompt(
              "Describe the obstacle blocking this task. Reporting it will stop tracking this task.",
            )
            ?.trim()
        : stage === "ready_for_review"
          ? window.prompt("Submit as finished. Add an optional note for the reviewer.")?.trim()
          : undefined;
    if (stage === "blocked" && !note) {
      setIsSubmittingTask(false);
      return;
    }
    const result = await window.khaliduo.updateTaskStage(status.selectedTask.id, stage, note);
    if (!result.success) {
      setTaskError(result.message ?? "Task stage update failed.");
    } else if (stage === "blocked") {
      setTrackingControlMessage(
        "Task reported blocked and removed from tracking. Use the employee dashboard to resume it after the obstacle is cleared.",
      );
    } else if (stage === "ready_for_review") {
      setTrackingControlMessage("Finished work submitted. Waiting for approval.");
    }
    if (result.status) {
      setStatus(result.status);
    }
    setIsSubmittingTask(false);
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
      const result = shouldResume
        ? await window.khaliduo.resumeTracking()
        : await window.khaliduo.pauseTracking();
      if (!result.success) {
        setTrackingControlMessage(result.message ?? "The tracking state could not be changed.");
        return;
      }
      setTrackingControlMessage(
        result.message ??
          (shouldResume
            ? "Tracking resumed. Screenshots follow the company schedule."
            : "Tracking paused. No screenshots will be taken on this device."),
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
        setDashboardError(result?.message ?? "The employee dashboard could not be opened.");
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
        setScreenshotError(result.message ?? "Recent screenshots could not be loaded.");
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
        await Swal.fire("Sign out failed", result.message ?? "Please try again.", "error");
        return;
      }
      setStatus(await window.khaliduo.getAgentStatus());
      setActiveView("home");
      setEmployeePassword("");
      setEnrollmentCode("");
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
      setActiveView("more");
      setTimeRequestMinutes(lostMinutes);
      setTimeRequestReason("Offline meeting or work completed while away from the computer.");
      window.setTimeout(() => document.getElementById("time-request-reason")?.focus(), 50);
    }
  }

  async function showRequiredUpdate(version: string | null) {
    const promptKey = version ?? "ready";
    if (updatePromptActive.current || promptedUpdateVersion.current === promptKey) return;
    promptedUpdateVersion.current = promptKey;
    updatePromptActive.current = true;
    window.khaliduo?.setUpdateAttention(true);

    try {
      while (true) {
        const result = await Swal.fire({
          title: "Required update",
          html: `<strong>Khaliduo ${version ? `v${version}` : ""} is ready to install.</strong><br/>You must install this update now to continue using the app. Your active session will be closed safely and Khaliduo will restart automatically.`,
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
        if (installResult?.success !== false) {
          return;
        }
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
      window.khaliduo?.setUpdateAttention(status.updateStatus === "ready");
      if (status.updateStatus !== "ready") {
        promptedUpdateVersion.current = null;
      }
    }
  }

  return (
    <main className="k-app" data-tone={timerTone} data-theme={theme}>
      <header className="k-titlebar">
        <div className="k-brand">
          <img src="./khaliduo-icon.png" alt="Khaliduo" />
          <strong>Kent Consultancy</strong>
        </div>
        <span className="k-chip">
          {statusText} {status.enrolled ? formatDuration(countedTodaySeconds) : ""}
        </span>
        <span className="k-spacer" />
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
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
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
          <strong>Required update {status.updateVersion ? `v${status.updateVersion}` : ""}</strong>
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
          enrollmentCode={enrollmentCode}
          enrollmentError={enrollmentError}
          isSubmitting={isSubmitting}
          isDesktopRuntime={isDesktopRuntime}
          onEmailChange={setEmployeeEmail}
          onPasswordChange={setEmployeePassword}
          onEnrollmentCodeChange={setEnrollmentCode}
          onCredentialEnrollment={handleCredentialEnrollment}
          onCodeEnrollment={handleCodeEnrollment}
        />
      ) : (
        <>
          <Sidebar
            activeView={activeView}
            status={status}
            onViewChange={setActiveView}
            onOpenDashboard={() => void handleOpenDashboard()}
            onLogout={() => void handleLogout()}
          isLoggingOut={isLoggingOut}
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
              onTaskChange={(taskId) => void handleTaskChange(taskId)}
              onTaskStage={(stage) => void handleTaskStage(stage)}
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
          {activeView === "more" && (
            <MoreView
              status={status}
              timeRequestMinutes={timeRequestMinutes}
              timeRequestReason={timeRequestReason}
              timeRequestError={timeRequestError}
              timeRequestSuccess={timeRequestSuccess}
              isSubmittingTimeRequest={isSubmittingTimeRequest}
              onTimeRequestMinutesChange={setTimeRequestMinutes}
              onTimeRequestReasonChange={setTimeRequestReason}
              onSubmitTimeRequest={handleTimeRequest}
              onLogout={() => void handleLogout()}
              isLoggingOut={isLoggingOut}
            />
          )}
        </>
      )}

      <footer className="k-statusbar">
        <span>{isPaused ? "Timer paused" : isRunning ? "Timer running" : "Idle"}</span>
        <span className={status.connectionStatus === "online" ? "k-ok" : "k-danger"}>
          {status.connectionStatus === "online" ? "Synced" : "Offline"}
        </span>
        <span>Today {formatDuration(status.workedTodaySeconds)}</span>
        <span>Activity {status.activityPercent}%</span>
        <span>v{status.agentVersion}</span>
      </footer>
    </main>
  );
}

function EnrollmentView({
  employeeEmail,
  employeePassword,
  enrollmentCode,
  enrollmentError,
  isSubmitting,
  isDesktopRuntime,
  onEmailChange,
  onPasswordChange,
  onEnrollmentCodeChange,
  onCredentialEnrollment,
  onCodeEnrollment,
}: {
  employeeEmail: string;
  employeePassword: string;
  enrollmentCode: string;
  enrollmentError: string | null;
  isSubmitting: boolean;
  isDesktopRuntime: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onEnrollmentCodeChange: (value: string) => void;
  onCredentialEnrollment: (event: FormEvent<HTMLFormElement>) => void;
  onCodeEnrollment: (event: FormEvent<HTMLFormElement>) => void;
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
        <details>
          <summary>Use a one-time enrollment code instead</summary>
          <form className="k-form" onSubmit={onCodeEnrollment}>
            <label>
              Enrollment code
              <input
                value={enrollmentCode}
                onChange={(event) => onEnrollmentCodeChange(event.target.value)}
                autoComplete="one-time-code"
                placeholder="KH-XXXXXXXXXXXX"
                disabled={isSubmitting}
                required
              />
            </label>
            <button type="submit" disabled={isSubmitting || !isDesktopRuntime}>
              {isSubmitting ? "Enrolling..." : "Enroll"}
            </button>
          </form>
        </details>
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
  onLogout,
  isLoggingOut,
  isTracking,
}: {
  activeView: "home" | "tasks" | "more";
  status: AgentStatus;
  onViewChange: (view: "home" | "tasks" | "more") => void;
  onOpenDashboard: () => void;
  onLogout: () => void;
  isLoggingOut: boolean;
  isTracking: boolean;
}) {
  return (
    <aside className="k-sidebar">
      <nav>
        <span className="k-nav-title">Main</span>
        <button className={activeView === "home" ? "active" : ""} onClick={() => onViewChange("home")}>
          Timer
        </button>
        <button className={activeView === "tasks" ? "active" : ""} onClick={() => onViewChange("tasks")}>
          Tasks <b>{status.tasks.length}</b>
        </button>
        <button className={activeView === "more" ? "active" : ""} onClick={() => onViewChange("more")}>
          More
        </button>
        <span className="k-nav-title">Online</span>
        <button onClick={onOpenDashboard}>Dashboard</button>
      </nav>
      <div className="k-user">
        <span className="k-avatar">
          {status.employeeAvatarUrl ? <img src={status.employeeAvatarUrl} alt={status.employeeName} /> : initials(status.employeeName)}
        </span>
        <div>
          <strong>{status.employeeName}</strong>
          <small className={status.connectionStatus === "online" || isTracking ? "k-ok" : "k-danger"}>
            {status.connectionStatus === "online"
              ? "Online - Synced"
              : isTracking
                ? "Online - Sync pending"
                : "Offline"}
          </small>
        </div>
      </div>
      <button className="k-plain-danger" onClick={onLogout} disabled={isLoggingOut}>
        {isLoggingOut ? "Signing out..." : "Sign out"}
      </button>
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
    segments: Array<{ label: string; seconds: number; className: string; counted: boolean }>;
    total: number;
  };
  targetProgress: number;
  countedTodaySeconds: number;
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
}) {
  const isPaused = status.trackingPaused || status.trackingStatus === "paused";
  const shouldResume =
    isPaused || status.trackingStatus === "offline" || status.trackingStatus === "error";
  return (
    <section className="k-home">
      <div className="k-center">
        <div className="k-selectors">
          <label>
            Project
            <select value={projectFilterId} onChange={(event) => onProjectChange(event.target.value)}>
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

        <div className="k-hero" style={{ "--progress": targetProgress } as CSSProperties}>
          <span className="k-hero-pill">{isPaused ? "Paused" : statusLabel}</span>
          <div className="k-ring">
            <strong>{formatDuration(countedTodaySeconds)}</strong>
            <small>{targetProgress}% of {formatDuration(status.dailyTargetSeconds)}</small>
          </div>
          <p>
            {selectedProject?.name ?? status.selectedTask?.projectName ?? "No project"} -{" "}
            {status.selectedTask?.name ?? "No task selected"}
          </p>
          <div className="k-actions">
            <button
              type="button"
              className={shouldResume ? "k-primary" : "k-warning"}
              onClick={onTrackingToggle}
              disabled={isChangingTracking}
            >
              {isChangingTracking ? "Please wait..." : shouldResume ? "Resume" : "Pause"}
            </button>
          </div>
          <div className="k-hero-meta">
            <div>
              <span>Activity</span>
              <strong>{status.activityPercent}%</strong>
            </div>
            <div>
              <span>Session</span>
              <strong>{formatDuration(status.activeSeconds)}</strong>
            </div>
            <div>
              <span>Idle</span>
              <strong>{formatDuration(status.idleSeconds)}</strong>
            </div>
          </div>
        </div>

        <div className="k-stat-grid">
          <Stat label="Today" value={formatDuration(status.workedTodaySeconds)} />
          <Stat label="This week" value={formatDuration(status.timeSummary?.week.tracked_active_seconds ?? 0)} />
          <Stat label="Session" value={formatDuration(status.activeSeconds)} />
          <Stat label="Activity" value={`${status.activityPercent}%`} tone="good" />
          <Stat label="Idle" value={formatDuration(status.idleSeconds)} tone="warn" />
        </div>

        <section className="k-breakdown">
          <div className="k-row">
            <strong>Daily target</strong>
            <span>{formatDuration(status.workedTodaySeconds)} / {formatDuration(status.dailyTargetSeconds)} - {targetProgress}%</span>
          </div>
          <div className="k-breakdown-bar">
            {timeBreakdown.segments.map((segment) =>
              segment.seconds > 0 ? (
                <i
                  key={segment.label}
                  className={`segment-${segment.className}`}
                  style={{ width: `${(segment.seconds / timeBreakdown.total) * 100}%` }}
                  title={`${segment.label}: ${formatDuration(segment.seconds)}`}
                />
              ) : null,
            )}
          </div>
          <div className="k-legend">
            {timeBreakdown.segments.map((segment) => (
              <span key={segment.label}>
                <i className={`segment-${segment.className}`} /> {segment.label} {formatDuration(segment.seconds)}
              </span>
            ))}
          </div>
        </section>
      </div>

      <aside className="k-right">
        <section className="k-side-section">
          <div className="k-row">
            <strong>Latest screenshot</strong>
            <button type="button" onClick={onOpenScreenshots} disabled={isOpeningDashboard}>
              View all
            </button>
          </div>
          {!recentScreenshots && (
            <button type="button" className="k-shot-placeholder" onClick={onLoadScreenshots} disabled={isLoadingScreenshots}>
              {isLoadingScreenshots ? "Loading..." : "Show latest capture"}
            </button>
          )}
          {recentScreenshots?.[0] && (
            <figure className="k-shot">
              <img src={recentScreenshots[0].dataUrl} alt={recentScreenshots[0].displayName ?? "Latest screenshot"} />
              <figcaption>
                <span>{formatTimestamp(recentScreenshots[0].capturedAt)}</span>
                <b className="k-ok">Synced</b>
              </figcaption>
            </figure>
          )}
          {recentScreenshots?.length === 0 && <p className="k-muted">No screenshots have been uploaded yet.</p>}
          {screenshotError && <p className="k-error">{screenshotError}</p>}
          {dashboardError && <p className="k-error">{dashboardError}</p>}
        </section>
        {status.todayTimeline && <Timeline timeline={status.todayTimeline} />}
        {status.recentTasks.length > 0 && (
          <section className="k-side-section">
            <strong>Recent tasks</strong>
            <div className="k-task-list">
              {status.recentTasks.map((task) => (
                <button key={task.id} type="button" onClick={() => onTaskChange(task.id)}>
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className={tone ? `k-stat k-${tone}` : "k-stat"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Timeline({ timeline }: { timeline: WorkdayTimeline }) {
  const labels = {
    worked: "Worked",
    idle: "Idle",
    locked: "Locked",
    sleeping: "Sleeping",
  } as const;
  return (
    <section className="k-side-section">
      <strong>Today's timeline</strong>
      <div className="k-timeline">
        {timeline.intervals.slice(-6).map((interval, index) => (
          <div key={`${interval.session_id}-${interval.started_at}-${index}`} className={`k-line-${interval.type}`}>
            <span>
              {formatClock(interval.started_at, timeline.timezone)} -{" "}
              {interval.is_current ? "Now" : formatClock(interval.ended_at, timeline.timezone)}
            </span>
            <b>{labels[interval.type]}</b>
            <small>
              {formatDuration(
                interval.is_current
                  ? Math.max(0, Math.floor((Date.now() - new Date(interval.started_at).getTime()) / 1000))
                  : interval.duration_seconds,
              )}
            </small>
          </div>
        ))}
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
  onTaskChange,
  onTaskStage,
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
  onTaskChange: (taskId: string) => void;
  onTaskStage: (stage: "assigned" | "in_progress" | "ready_for_review" | "blocked") => void;
  onTrackingToggle: () => void;
  onNewTaskNameChange: (value: string) => void;
  onNewTaskDescriptionChange: (value: string) => void;
  onNewTaskTeamChange: (value: string) => void;
  onNewTaskProjectChange: (value: string) => void;
  onNewTaskStartDateChange: (value: string) => void;
  onNewTaskDeadlineChange: (value: string) => void;
  onCreateTask: () => void;
}) {
  return (
    <section className="k-page">
      <div className="k-panel">
        <h2>Create task request</h2>
        <div className="k-form-grid">
          <label className="wide">
            Task name
            <input value={newTaskName} maxLength={255} placeholder="What are you working on?" disabled={isSubmittingTask} onChange={(event) => onNewTaskNameChange(event.target.value)} />
          </label>
          <label className="wide">
            Description
            <input value={newTaskDescription} maxLength={1000} placeholder="Expected outcome or useful context" disabled={isSubmittingTask} onChange={(event) => onNewTaskDescriptionChange(event.target.value)} />
          </label>
          <label>
            Team
            <select value={newTaskTeamId} disabled={isSubmittingTask} onChange={(event) => onNewTaskTeamChange(event.target.value)}>
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
            <select value={newTaskProjectId} disabled={isSubmittingTask || !newTaskTeamId} onChange={(event) => onNewTaskProjectChange(event.target.value)}>
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
            <input type="date" value={newTaskStartDate} disabled={isSubmittingTask} onChange={(event) => onNewTaskStartDateChange(event.target.value)} />
          </label>
          <label>
            Deadline
            <input type="date" min={newTaskStartDate || undefined} value={newTaskDeadline} disabled={isSubmittingTask} onChange={(event) => onNewTaskDeadlineChange(event.target.value)} />
          </label>
        </div>
        <button className="k-primary" disabled={!newTaskName.trim() || isSubmittingTask} onClick={onCreateTask}>
          {isSubmittingTask ? "Submitting..." : "Submit request"}
        </button>
      </div>

      <div className="k-panel">
        <h2>Current task</h2>
        <div className="k-form-grid">
          <label>
            Task
            <select value={status.selectedTask?.id ?? "none"} disabled={isSubmittingTask} onChange={(event) => onTaskChange(event.target.value)}>
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
              disabled={!status.selectedTask || isSubmittingTask || !status.selectedTask.canUpdateStage}
              onChange={(event) => onTaskStage(event.target.value as "assigned" | "in_progress" | "ready_for_review" | "blocked")}
            >
              {status.selectedTask?.stage === "backlog" && <option value="backlog">Backlog</option>}
              <option value="assigned">Assigned</option>
              <option value="in_progress">In progress</option>
              <option value="ready_for_review">Submit as finished</option>
              <option value="blocked">Report blocked</option>
            </select>
          </label>
        </div>
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
        <button className={status.trackingPaused ? "k-primary" : "k-warning"} onClick={onTrackingToggle}>
          {status.trackingPaused ? "Resume" : "Pause"}
        </button>
        {trackingControlMessage && <p className="k-success">{trackingControlMessage}</p>}
        {taskError && <p className="k-error">{taskError}</p>}
      </div>
    </section>
  );
}

function MoreView({
  status,
  timeRequestMinutes,
  timeRequestReason,
  timeRequestError,
  timeRequestSuccess,
  isSubmittingTimeRequest,
  onTimeRequestMinutesChange,
  onTimeRequestReasonChange,
  onSubmitTimeRequest,
  onLogout,
  isLoggingOut,
}: {
  status: AgentStatus;
  timeRequestMinutes: number;
  timeRequestReason: string;
  timeRequestError: string | null;
  timeRequestSuccess: string | null;
  isSubmittingTimeRequest: boolean;
  onTimeRequestMinutesChange: (value: number) => void;
  onTimeRequestReasonChange: (value: string) => void;
  onSubmitTimeRequest: (event: FormEvent<HTMLFormElement>) => void;
  onLogout: () => void;
  isLoggingOut: boolean;
}) {
  return (
    <section className="k-page">
      <details className="k-panel" open>
        <summary>System details</summary>
        <dl className="k-details">
          <div><dt>Current session</dt><dd>{formatTimestamp(status.sessionStartedAt)}</dd></div>
          <div><dt>Connection</dt><dd>{status.connectionStatus}</dd></div>
          <div><dt>Last screenshot</dt><dd>{formatTimestamp(status.lastScreenshotAt)}</dd></div>
          <div><dt>Last sync</dt><dd>{formatTimestamp(status.lastSuccessfulSyncAt)}</dd></div>
          <div><dt>Agent version</dt><dd>{status.agentVersion}</dd></div>
        </dl>
      </details>

      <div className="k-panel">
        <h2>Manual time request</h2>
        <form className="k-form" onSubmit={onSubmitTimeRequest}>
          <label>
            Date
            <input type="date" value={localDateKey()} disabled />
          </label>
          <div className="k-form-grid">
            <label>
              Hours
              <input
                type="number"
                min={0}
                max={12}
                value={Math.floor(timeRequestMinutes / 60)}
                onChange={(event) => onTimeRequestMinutesChange(Number(event.target.value) * 60 + (timeRequestMinutes % 60))}
              />
            </label>
            <label>
              Minutes
              <input
                id="time-request-minutes"
                type="number"
                min={0}
                max={59}
                value={timeRequestMinutes % 60}
                onChange={(event) => onTimeRequestMinutesChange(Math.floor(timeRequestMinutes / 60) * 60 + Number(event.target.value))}
              />
            </label>
          </div>
          <label>
            Reason
            <textarea
              id="time-request-reason"
              value={timeRequestReason}
              onChange={(event) => onTimeRequestReasonChange(event.target.value)}
              minLength={3}
              maxLength={1000}
              placeholder="Offline meeting, client visit, workshop..."
              required
            />
          </label>
          <button className="k-primary" disabled={isSubmittingTimeRequest || timeRequestMinutes < 1}>
            {isSubmittingTimeRequest ? "Submitting..." : "Submit request"}
          </button>
          {timeRequestError && <p className="k-error">{timeRequestError}</p>}
          {timeRequestSuccess && <p className="k-success">{timeRequestSuccess}</p>}
        </form>
      </div>

      <div className="k-panel">
        <h2>Device account</h2>
        <p className="k-muted">Sign out only when this computer should stop tracking this employee.</p>
        <button className="k-danger-button" onClick={onLogout} disabled={isLoggingOut}>
          {isLoggingOut ? "Signing out..." : "Sign out from this device"}
        </button>
      </div>
    </section>
  );
}

export default App;
