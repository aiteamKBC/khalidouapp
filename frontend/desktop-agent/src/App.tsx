import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Swal, { type SweetAlertResult } from "sweetalert2";
import type { AgentStatus, IdleAlert, RecentScreenshot, WorkdayTimeline } from "./types/electron";
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

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Not available";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function localDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function App() {
  const [status, setStatus] = useState<AgentStatus>(fallbackStatus);
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeRequestMinutes, setTimeRequestMinutes] = useState(15);
  const [timeRequestReason, setTimeRequestReason] = useState("");
  const [timeRequestError, setTimeRequestError] = useState<string | null>(null);
  const [timeRequestSuccess, setTimeRequestSuccess] = useState<string | null>(
    null,
  );
  const [isSubmittingTimeRequest, setIsSubmittingTimeRequest] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskTeamId, setNewTaskTeamId] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [newTaskStartDate, setNewTaskStartDate] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [trackingControlMessage, setTrackingControlMessage] = useState<
    string | null
  >(null);
  const [isChangingTracking, setIsChangingTracking] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [recentScreenshots, setRecentScreenshots] = useState<RecentScreenshot[] | null>(null);
  const [isLoadingScreenshots, setIsLoadingScreenshots] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [summaryPeriod, setSummaryPeriod] = useState<
    "today" | "week" | "month"
  >("today");
  const [activeView, setActiveView] = useState<"home" | "tasks" | "more">(
    "home",
  );
  const shownIdleAlertId = useRef<string | null>(null);
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
    const interval = window.setInterval(() => void loadStatus(), 1000);

    return () => {
      mounted = false;
      removeIdleAlertListener();
      window.clearInterval(interval);
    };
  }, []);

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
  const timeBreakdown = useMemo(() => {
    const period = status.timeSummary?.[summaryPeriod];
    const segments = [
      {
        label: "Worked",
        seconds:
          summaryPeriod === "today"
            ? status.workedTodaySeconds
            : (period?.tracked_active_seconds ?? 0),
        className: "worked",
        counted: true,
      },
      {
        label: "Idle",
        seconds:
          period?.idle_seconds ??
          (summaryPeriod === "today" ? status.idleSeconds : 0),
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
    status.idleSeconds,
    status.timeSummary,
    status.workedTodaySeconds,
    summaryPeriod,
  ]);
  const countedPeriodSeconds = timeBreakdown.segments
    .filter((segment) => segment.counted)
    .reduce((total, segment) => total + segment.seconds, 0);
  const targetProgress = Math.max(
    0,
    Math.min(100, status.dailyTargetProgressPercent),
  );

  async function refreshStatusAfterEnrollment() {
    const nextStatus = await window.khaliduo?.getAgentStatus();
    if (nextStatus) {
      setStatus(nextStatus);
    }
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

  async function handleCodeEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEnrollmentError(null);
    if (!window.khaliduo) {
      setEnrollmentError(desktopRuntimeMessage);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await window.khaliduo?.enrollDevice(enrollmentCode);
      if (!result?.success) {
        setEnrollmentError(result?.message ?? "Enrollment failed.");
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
    if (
      !Number.isFinite(timeRequestMinutes) ||
      timeRequestMinutes < 1 ||
      timeRequestMinutes > 720
    ) {
      setTimeRequestError("Minutes must be between 1 and 720.");
      return;
    }
    if (timeRequestReason.trim().length < 3) {
      setTimeRequestError(
        "Write a reason of at least 3 characters before sending.",
      );
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
      const nextStatus = await window.khaliduo.getAgentStatus();
      setStatus(nextStatus);
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
      const result = await window.khaliduo.setCurrentTask(
        taskId === "none" ? null : taskId,
      );
      if (!result.success) {
        setTaskError(result.message ?? "Task selection failed.");
        return;
      }
      const nextStatus = await window.khaliduo.getAgentStatus();
      setStatus(nextStatus);
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
      setStatus(await window.khaliduo.getAgentStatus());
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
    }
    setStatus(await window.khaliduo.getAgentStatus());
    setIsSubmittingTask(false);
  }

  async function handleTrackingToggle() {
    if (!window.khaliduo || !status.enrolled) {
      return;
    }
    setTrackingControlMessage(null);
    setIsChangingTracking(true);
    try {
      const result = status.trackingPaused
        ? await window.khaliduo.resumeTracking()
        : await window.khaliduo.pauseTracking();
      if (!result.success) {
        setTrackingControlMessage(
          result.message ?? "The tracking state could not be changed.",
        );
        return;
      }
      setTrackingControlMessage(
        result.message ??
          (status.trackingPaused
            ? "Tracking resumed. Screenshots follow the company schedule."
            : "Tracking paused. No screenshots will be taken on this device."),
      );
      const nextStatus = await window.khaliduo.getAgentStatus();
      setStatus(nextStatus);
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

  async function handleLoadRecentScreenshots() {
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
  }

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
    if (shownIdleAlertId.current === alert.id) {
      return;
    }
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
      if (pauseResult?.message) {
        setTrackingControlMessage(pauseResult.message);
      }
      const nextStatus = await window.khaliduo?.getAgentStatus();
      if (nextStatus) setStatus(nextStatus);
    } else if (result.dismiss === Swal.DismissReason.cancel) {
      setActiveView("more");
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

  return (
    <main className="status-window">
      <header className="header">
        <div className="brand-lockup">
          <img
            className="brand-icon"
            src="./khaliduo-icon.png"
            alt="Khaliduo by Kent Consultancy"
          />
          <div>
            <p className="eyebrow">Kent Consultancy</p>
            <h1>Khaliduo</h1>
            <p className="window-label">Your workday companion</p>
          </div>
        </div>
        <span className={`status-pill status-${status.trackingStatus}`}>
          {statusLabel}
        </span>
      </header>

      {["available", "downloading", "ready"].includes(status.updateStatus) && (
        <section className="required-update" role="status" aria-live="assertive">
          <strong>
            Required update {status.updateVersion ? `v${status.updateVersion}` : ""}
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

      {!status.enrolled && (
        <section className="enrollment">
          <div className="enrollment-heading">
            <strong>Sign in to set up this computer</strong>
            <span>Your device will be linked to your employee account.</span>
          </div>
          <form
            className="credential-enrollment"
            onSubmit={handleCredentialEnrollment}
          >
            <label htmlFor="employee-email">Work email</label>
            <input
              id="employee-email"
              type="email"
              value={employeeEmail}
              onChange={(event) => setEmployeeEmail(event.target.value)}
              autoComplete="email"
              placeholder="name@company.com"
              disabled={isSubmitting}
              required
            />
            <label htmlFor="employee-password">Password</label>
            <input
              id="employee-password"
              type="password"
              value={employeePassword}
              onChange={(event) => setEmployeePassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Employee password"
              disabled={isSubmitting}
              minLength={8}
              required
            />
            <button type="submit" disabled={isSubmitting || !isDesktopRuntime}>
              {isSubmitting ? "Signing in..." : "Sign in and link device"}
            </button>
            <p className="enrollment-help">
              Your password is used only for this sign-in and is never saved on
              this computer. The device token is protected by Windows secure
              storage.
            </p>
          </form>
          <details className="enrollment-fallback">
            <summary>Use a one-time enrollment code instead</summary>
            <form onSubmit={handleCodeEnrollment}>
              <label htmlFor="enrollment-code">Enrollment code</label>
              <div className="enrollment-row">
                <input
                  id="enrollment-code"
                  value={enrollmentCode}
                  onChange={(event) => setEnrollmentCode(event.target.value)}
                  autoComplete="one-time-code"
                  placeholder="KH-XXXXXXXXXXXX"
                  disabled={isSubmitting}
                  required
                />
                <button
                  type="submit"
                  disabled={isSubmitting || !isDesktopRuntime}
                >
                  {isSubmitting ? "Enrolling" : "Enroll"}
                </button>
              </div>
              <p className="enrollment-help">
                Paste the full one-time KH- code generated from the employee
                profile in the admin dashboard.
              </p>
            </form>
          </details>
          {enrollmentError && <p className="form-error">{enrollmentError}</p>}
        </section>
      )}

      {status.enrolled && (
        <>
          <section className="purpose-banner">
            <span>{status.trackingPaused ? "Paused" : "Running"}</span>
            <strong>{formatDuration(countedPeriodSeconds)}</strong>
            <p>
              {status.selectedTask
                ? `${status.selectedTask.name} / ${status.selectedTask.teamName}`
                : "Choose a task to make today's record easier to review."}
            </p>
          </section>

          <nav className="app-view-tabs" aria-label="Desktop app sections">
            {(["home", "tasks", "more"] as const).map((view) => (
              <button
                key={view}
                type="button"
                className={activeView === view ? "active" : ""}
                aria-current={activeView === view ? "page" : undefined}
                onClick={() => setActiveView(view)}
              >
                {view === "home"
                  ? "Home"
                  : view === "tasks"
                    ? "Tasks"
                    : "More"}
              </button>
            ))}
          </nav>
        </>
      )}

      {(!status.enrolled || activeView === "home") && (
        <div className="app-view app-view-home">
          {status.enrolled && (
            <section className="work-focus timer-board" aria-label="Current work summary">
              <div className="work-focus-time">
                <span>Current session</span>
                <strong>{formatDuration(countedPeriodSeconds)}</strong>
                <small>
                  {status.trackingPaused ? "Paused" : `${statusLabel} now`}
                </small>
              </div>
              <div className="work-focus-task">
                <span>Current task</span>
                <strong>{status.selectedTask?.name ?? "No task selected"}</strong>
                <small>
                  {status.selectedTask
                    ? `${status.selectedTask.teamName} / ${status.selectedTask.projectName}`
                    : "Choose a task before you start focused work."}
                </small>
              </div>
              <div className="work-focus-actions">
                <button
                  type="button"
                  className={
                    status.trackingPaused
                      ? "focus-action resume-button"
                      : "focus-action pause-button"
                  }
                  onClick={() => void handleTrackingToggle()}
                  disabled={isChangingTracking}
                >
                  {isChangingTracking
                    ? "Please wait..."
                    : status.trackingPaused
                      ? "Resume"
                      : "Pause"}
                </button>
                <button
                  type="button"
                  className="focus-action manage-tasks-button"
                  onClick={() => setActiveView("tasks")}
                >
                  Manage tasks
                </button>
              </div>
              <div className="daily-target">
                <div>
                  <span>Daily target</span>
                  <strong>
                    {formatDuration(status.workedTodaySeconds)} / {formatDuration(status.dailyTargetSeconds)}
                  </strong>
                </div>
                <b>{targetProgress}%</b>
                <div className="target-bar">
                  <i style={{ width: `${targetProgress}%` }} />
                </div>
              </div>
            </section>
          )}

      {status.enrolled && (
        <section
          className={`tracking-control ${status.trackingPaused ? "tracking-paused" : "tracking-running"}`}
        >
          <div>
            <span>
              {status.trackingPaused ? "Tracking paused" : "Tracking active"}
            </span>
            <strong>
              {status.trackingPaused
                ? "No screenshots will be taken."
                : "Screenshots may be taken on the company schedule."}
            </strong>
            <p>
              {status.trackingPaused
                ? "Khaliduo stays paused until you resume it or sign in to Windows again."
                : "Use Pause before hiding the window whenever you need screenshots to stop."}
            </p>
          </div>
          <button
            type="button"
            className={status.trackingPaused ? "resume-button" : "pause-button"}
            onClick={() => void handleTrackingToggle()}
            disabled={isChangingTracking}
          >
            {isChangingTracking
              ? "Please wait…"
              : status.trackingPaused
                ? "Resume tracking"
                : "Pause tracking"}
          </button>
          {trackingControlMessage && (
            <p className="tracking-control-message">{trackingControlMessage}</p>
          )}
        </section>
      )}

      <section className="identity">
        <p className="section-title">Employee identity</p>
        <div className="employee-row">
          <span className="employee-avatar">
            {status.employeeAvatarUrl ? (
              <img src={status.employeeAvatarUrl} alt={status.employeeName} />
            ) : (
              status.employeeName.slice(0, 2).toUpperCase()
            )}
          </span>
          <div>
            <strong>{status.employeeName}</strong>
            <small>
              {status.enrolled ? "Linked employee" : "Enrollment required"}
            </small>
          </div>
          <span
            className={`connection-state connection-${status.connectionStatus}`}
          >
            ● {status.connectionStatus}
          </span>
        </div>
        <div className="computer-row">
          <span>▣</span>
          <div>
            <small>Computer</small>
            <strong>{status.deviceName}</strong>
          </div>
        </div>
      </section>

      {status.enrolled && (
        <button
          type="button"
          className="employee-dashboard-button"
          onClick={() => void handleOpenDashboard()}
          disabled={isOpeningDashboard}
        >
          <span>
            {isOpeningDashboard ? "Opening dashboard..." : "My web dashboard"}
          </span>
          <strong>View my time, screenshots, points and manual requests</strong>
        </button>
      )}
      {dashboardError && (
        <p className="form-error dashboard-error">{dashboardError}</p>
      )}

      {status.enrolled && (
        <section className="pulse-grid" aria-label="Work pulse">
          <div>
            <span>Today tracked</span>
            <strong>{formatDuration(status.workedTodaySeconds)}</strong>
          </div>
          <div>
            <span>Activity</span>
            <strong>{status.activityPercent}%</strong>
          </div>
          <div>
            <span>Idle time</span>
            <strong>{formatDuration(status.idleSeconds)}</strong>
          </div>
        </section>
      )}

      {status.enrolled && status.recentTasks.length > 0 && (
        <section className="recent-tasks-panel">
          <div className="panel-heading">
            <strong>Recent tasks</strong>
            <button type="button" onClick={() => setActiveView("tasks")}>
              View all
            </button>
          </div>
          <div className="recent-task-list">
            {status.recentTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className={status.selectedTask?.id === task.id ? "active" : ""}
                disabled={isSubmittingTask}
                onClick={() => void handleTaskChange(task.id)}
              >
                <span>{task.name}</span>
                <small>{task.projectName}</small>
                <strong>{formatDuration(task.trackedSeconds)}</strong>
              </button>
            ))}
          </div>
        </section>
      )}

      {status.enrolled && (
        <section className="recent-screenshots">
          <div className="recent-screenshots-heading">
            <div>
              <span>My screenshots</span>
              <strong>Review the latest four captures</strong>
            </div>
            <div>
              <button type="button" onClick={() => void handleLoadRecentScreenshots()} disabled={isLoadingScreenshots}>
                {isLoadingScreenshots ? "Loading..." : recentScreenshots ? "Refresh" : "Show last 4"}
              </button>
              <button type="button" onClick={() => void handleOpenDashboard("screenshots")} disabled={isOpeningDashboard}>
                View all
              </button>
            </div>
          </div>
          {recentScreenshots && (
            <div className="recent-screenshot-grid">
              {recentScreenshots.map((screenshot) => (
                <figure key={screenshot.id}>
                  <img src={screenshot.dataUrl} alt={screenshot.displayName ?? "Work screenshot"} />
                  <figcaption>{formatTimestamp(screenshot.capturedAt)}</figcaption>
                </figure>
              ))}
              {recentScreenshots.length === 0 && <p>No screenshots have been uploaded yet.</p>}
            </div>
          )}
          {screenshotError && <p className="form-error">{screenshotError}</p>}
        </section>
      )}

      <section className="summary-panel" aria-label="Time summary">
        <div
          className="summary-period-tabs"
          role="tablist"
          aria-label="Summary period"
        >
          {(["today", "week", "month"] as const).map((period) => (
            <button
              key={period}
              type="button"
              role="tab"
              aria-selected={summaryPeriod === period}
              className={summaryPeriod === period ? "active" : ""}
              onClick={() => setSummaryPeriod(period)}
            >
              {period === "today"
                ? "Today"
                : period === "week"
                  ? "This week"
                  : "This month"}
            </button>
          ))}
        </div>
        <div className="metrics">
          <div>
            <span>Counted time</span>
            <strong>{formatDuration(countedPeriodSeconds)}</strong>
          </div>
          <div>
            <span>Worked</span>
            <strong>{formatDuration(timeBreakdown.segments[0].seconds)}</strong>
          </div>
          <div>
            <span>Idle</span>
            <strong>{formatDuration(timeBreakdown.segments[1].seconds)}</strong>
          </div>
        </div>
      </section>

      {status.enrolled && (
        <section className="time-breakdown" aria-label="Time breakdown">
          <div className="time-breakdown-heading">
            <strong>Time breakdown</strong>
            <span>Worked, idle and manual-time decisions</span>
          </div>
          <div className="time-breakdown-bar">
            {timeBreakdown.segments.map((segment) =>
              segment.seconds > 0 ? (
                <span
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
          <div className="time-breakdown-legend">
            {timeBreakdown.segments.map((segment) => (
              <div key={segment.label}>
                <span className={`legend-dot segment-${segment.className}`} />
                <span>
                  {segment.label} ·{" "}
                  {segment.counted ? "counted" : "not counted"}
                </span>
                <strong>{formatDuration(segment.seconds)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}
      {status.enrolled && status.todayTimeline && (
        <TodayActivity timeline={status.todayTimeline} />
      )}
        </div>
      )}

      {status.enrolled && activeView === "tasks" && (
        <div className="app-view app-view-tasks">
      {status.enrolled && (
        <section className="current-work">
          <p className="section-title">Current task</p>
          <div className="current-work-header">
            <div>
              <span>Current work</span>
              <strong>{status.selectedTask?.name ?? "No task selected"}</strong>
            </div>
            <select
              value={status.selectedTask?.id ?? "none"}
              disabled={isSubmittingTask}
              onChange={(event) => void handleTaskChange(event.target.value)}
            >
              <option value="none" disabled>
                Choose a task
              </option>
              {trackableTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.teamName} / {task.projectName} / {task.name}
                  {` (${task.stage.replaceAll("_", " ")})`}
                </option>
              ))}
            </select>
          </div>
              <div className="task-meta">
            <span>{status.selectedTask?.teamName ?? "No team"}</span>
            <span>{status.selectedTask?.projectName ?? "No project"}</span>
            <select
              aria-label="Task stage"
              value={status.selectedTask?.stage ?? "assigned"}
              disabled={
                !status.selectedTask ||
                isSubmittingTask ||
                !status.selectedTask.canUpdateStage
              }
              onChange={(event) =>
                void handleTaskStage(
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
          </div>
          {trackableTasks.length > 0 && (
            <div className="task-switch-list" aria-label="Available tasks">
              {trackableTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className={status.selectedTask?.id === task.id ? "active" : ""}
                  disabled={isSubmittingTask}
                  onClick={() => void handleTaskChange(task.id)}
                >
                  <span>{task.name}</span>
                  <strong>{formatDuration(task.activeSeconds)}</strong>
                  <small>
                    {status.selectedTask?.id === task.id ? "Tracking this task" : "Switch to task"}
                  </small>
                </button>
              ))}
            </div>
          )}
          {status.selectedTask && !status.selectedTask.canUpdateStage && (
            <p className="task-permission-note">
              You can select and track this task as a collaborator, but only the
              primary assignee can change its status.
            </p>
          )}
          <button
            type="button"
            className={
              status.trackingPaused
                ? "task-toggle task-resume"
                : "task-toggle task-pause"
            }
            onClick={() => void handleTrackingToggle()}
            disabled={isChangingTracking}
          >
            {isChangingTracking
              ? "Please wait..."
              : status.trackingPaused
                ? "▶ Resume"
                : "Ⅱ Pause"}
          </button>
        </section>
      )}

      {status.enrolled && (
        <section className="task-request">
          <p className="section-title">Create task request</p>
          <div className="quick-task-row">
            <label>
              <span>Task name</span>
              <input
                value={newTaskName}
                maxLength={255}
                placeholder="What are you working on?"
                disabled={isSubmittingTask}
                onChange={(event) => setNewTaskName(event.target.value)}
              />
            </label>
          </div>
          <div className="quick-task-options">
            <label className="quick-task-description">
              <span>Description</span>
              <input
                value={newTaskDescription}
                maxLength={1000}
                placeholder="Expected outcome or useful context"
                disabled={isSubmittingTask}
                onChange={(event) => setNewTaskDescription(event.target.value)}
              />
            </label>
            <label>
              <span>Team</span>
              <select
                value={newTaskTeamId}
                disabled={isSubmittingTask}
                onChange={(event) => {
                  setNewTaskTeamId(event.target.value);
                  setNewTaskProjectId("");
                }}
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
              <span>Project</span>
              <select
                value={newTaskProjectId}
                disabled={isSubmittingTask || !newTaskTeamId}
                onChange={(event) => setNewTaskProjectId(event.target.value)}
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
            <div className="workflow-guide">
              <span>Workflow</span>
              <div>
                <b>Assigned</b>
                <i>›</i>
                <b>In progress</b>
                <i>›</i>
                <b>Review</b>
                <i>›</i>
                <b>Completed</b>
              </div>
              <small>
                New tasks wait for manager approval before they appear in
                Current task.
              </small>
            </div>
            <label>
              <span>Start date</span>
              <input
                type="date"
                value={newTaskStartDate}
                disabled={isSubmittingTask}
                onChange={(event) => setNewTaskStartDate(event.target.value)}
              />
            </label>
            <label>
              <span>Deadline</span>
              <input
                type="date"
                min={newTaskStartDate || undefined}
                value={newTaskDeadline}
                disabled={isSubmittingTask}
                onChange={(event) => setNewTaskDeadline(event.target.value)}
              />
            </label>
          </div>
          <div className="quick-task-actions">
            <span>
              Review the details before submitting for admin approval.
            </span>
            <button
              type="button"
              disabled={!newTaskName.trim() || isSubmittingTask}
              onClick={() => void handleCreateTask()}
            >
              {isSubmittingTask && (
                <span className="button-spinner" aria-hidden="true" />
              )}
              {isSubmittingTask ? "Submitting..." : "Submit request"}
            </button>
          </div>
          {trackingControlMessage && (
            <p className="form-success">{trackingControlMessage}</p>
          )}
          {trackableTasks.length === 0 && (
            <p className="form-error">
              No trackable tasks yet. Submit what you are working on above for
              manager approval.
            </p>
          )}
          {taskError && <p className="form-error">{taskError}</p>}
        </section>
      )}
        </div>
      )}

      {(!status.enrolled || activeView === "more") && (
        <div className="app-view app-view-more">
      <details className="details">
        <summary>System details</summary>
        <dl>
          <div>
            <dt>Current Session</dt>
            <dd>{formatTimestamp(status.sessionStartedAt)}</dd>
          </div>
          <div>
            <dt>Connection</dt>
            <dd>{status.connectionStatus}</dd>
          </div>
          <div>
            <dt>Last Screenshot</dt>
            <dd>{formatTimestamp(status.lastScreenshotAt)}</dd>
          </div>
          <div>
            <dt>Last Sync</dt>
            <dd>{formatTimestamp(status.lastSuccessfulSyncAt)}</dd>
          </div>
          <div>
            <dt>Agent Version</dt>
            <dd>{status.agentVersion}</dd>
          </div>
        </dl>
      </details>

      {status.enrolled && (
        <section className="time-request">
          <form onSubmit={handleTimeRequest}>
            <div className="time-request-header">
              <div>
                <span>Manual time request</span>
              </div>
            </div>
            <p className="time-request-help">
              Use this for offline work or meetings. You can send while tracking
              or paused; pending time is not counted until an admin approves it.
            </p>
            <label>
              Date
              <input type="date" value={localDateKey()} disabled />
            </label>
            <span className="field-label">Duration</span>
            <div className="duration-grid">
              <label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={Math.floor(timeRequestMinutes / 60)}
                  onChange={(event) =>
                    setTimeRequestMinutes(
                      Number(event.target.value) * 60 +
                        (timeRequestMinutes % 60),
                    )
                  }
                />{" "}
                hours
              </label>
              <label>
                <input
                  id="time-request-minutes"
                  type="number"
                  min={0}
                  max={59}
                  value={timeRequestMinutes % 60}
                  onChange={(event) =>
                    setTimeRequestMinutes(
                      Math.floor(timeRequestMinutes / 60) * 60 +
                        Number(event.target.value),
                    )
                  }
                />{" "}
                minutes
              </label>
            </div>
            <label htmlFor="time-request-reason">Reason</label>
            <textarea
              id="time-request-reason"
              value={timeRequestReason}
              onChange={(event) => setTimeRequestReason(event.target.value)}
              minLength={3}
              maxLength={1000}
              placeholder="Offline meeting, client visit, workshop..."
              required
            />
            <button
              type="submit"
              className="request-submit"
              disabled={isSubmittingTimeRequest || timeRequestMinutes < 1}
            >
              {isSubmittingTimeRequest && (
                <span className="button-spinner" aria-hidden="true" />
              )}
              {isSubmittingTimeRequest ? "Submitting..." : "Submit request"}
            </button>
            <small className="request-note">
              ⓘ Manual time entries require administrator approval before they
              count toward your total.
            </small>
            {timeRequestError && (
              <p className="form-error">{timeRequestError}</p>
            )}
            {timeRequestSuccess && (
              <p className="form-success">{timeRequestSuccess}</p>
            )}
          </form>
          {status.timeAdjustmentRequests.length > 0 && (
            <ul className="time-request-list">
              {status.timeAdjustmentRequests.slice(0, 3).map((request) => (
                <li key={request.id}>
                  <span>{request.requested_minutes}m</span>
                  <strong className={`request-${request.status}`}>
                    {request.status}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {status.enrolled && (
        <section className="account-actions">
          <div>
            <strong>Device account</strong>
            <span>Sign out only when this computer should stop tracking this employee.</span>
          </div>
          <button
            type="button"
            className="logout-button"
            onClick={() => void handleLogout()}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? "Signing out..." : "Sign out from this device"}
          </button>
        </section>
      )}
        </div>
      )}

      <footer className="privacy">
        <span>Khaliduo v{status.agentVersion}</span>
        <span>Kent Consultancy © 2026</span>
        <span className={`connection-${status.connectionStatus}`}>
          ●{" "}
          {status.lastSuccessfulSyncAt
            ? `Synced ${formatTimestamp(status.lastSuccessfulSyncAt)}`
            : "Not synced"}
        </span>
        <small>{status.privacyNotice}</small>
      </footer>
    </main>
  );
}

function TodayActivity({ timeline }: { timeline: WorkdayTimeline }) {
  const labels = {
    worked: "Worked",
    idle: "Idle",
    locked: "Locked",
    sleeping: "Sleeping",
  } as const;

  return (
    <section className="today-activity" aria-label="Today's activity">
      <div className="today-activity-heading">
        <div>
          <span>Today's activity</span>
          <strong>
            {timeline.first_started_at
              ? `${formatClock(timeline.first_started_at, timeline.timezone)} - ${timeline.is_running ? "Now" : formatClock(timeline.last_ended_at, timeline.timezone)}`
              : "No activity"}
          </strong>
        </div>
        <span>{timeline.intervals.length} periods</span>
      </div>
      <div className="today-activity-list">
        {timeline.intervals.map((interval, index) => (
          <div key={`${interval.session_id}-${interval.started_at}-${index}`}>
            <span className={`activity-state activity-state-${interval.type}`}>
              {labels[interval.type]}
            </span>
            <strong>
              {formatClock(interval.started_at, timeline.timezone)} - {interval.ended_at ? formatClock(interval.ended_at, timeline.timezone) : "Now"}
            </strong>
            <span>
              {formatDuration(
                interval.is_current
                  ? Math.max(0, Math.floor((Date.now() - new Date(interval.started_at).getTime()) / 1000))
                  : interval.duration_seconds,
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatClock(value: string | null, timezone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

export default App;
