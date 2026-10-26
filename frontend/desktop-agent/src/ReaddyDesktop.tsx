import { TrackerStage } from "./tracker-ui/TrackerWorkspace";
import type { RecentScreenshot } from "./types/electron";
import { useState, type FormEvent, type ReactNode } from "react";
import type { AgentStatus, AgentTask } from "./types/electron";

// Native bindings for the Readdy tracker design, project daf9820f-f19f-4eeb-98d5-07878050b82c, V211 (version 15259656).
export type DesktopView =
  "home" | "tasks" | "requests" | "meeting" | "settings";

function duration(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function ReaddyHome({
  status,
  workedSeconds,
  visibleTasks,
  projectFilterId,
  onProjectChange,
  onTaskChange,
  onTrackingToggle,
  changingTracking,
  submittingTask,
  sessionNote,
  onSessionNoteChange,
  message,
  error,
  taskRequest,
  manualRequest,
  children,
  recentScreenshots,
  onOpenScreenshots,
}: {
  status: AgentStatus;
  workedSeconds: number;
  activeSeconds: number;
  visibleTasks: AgentTask[];
  projectFilterId: string;
  onProjectChange: (id: string) => void;
  onTaskChange: (id: string) => void;
  onTrackingToggle: () => void;
  changingTracking: boolean;
  submittingTask: boolean;
  sessionNote: string;
  onSessionNoteChange: (note: string) => void;
  message: string | null;
  error: string | null;
  taskRequest: ReactNode;
  manualRequest: ReactNode;
  children: ReactNode;
  recentScreenshots: RecentScreenshot[] | null;
  onOpenScreenshots: () => void;
}) {
  const today = status.timeSummary?.today;
  const running =
    !status.trackingPaused &&
    !["paused", "offline", "error"].includes(status.trackingStatus);
  const zone = status.todayTimeline?.timezone ?? status.requestPolicy?.timezone;
  const time = (value: string | null | undefined) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleTimeString([], {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const latest = recentScreenshots?.[0];
  return (
    <section className="rd-workspace" aria-label="Time tracking workspace">
      <TrackerStage
        name={status.employeeName}
        avatar={status.employeeAvatarUrl}
        projects={status.projects}
        projectId={projectFilterId}
        onProjectChange={onProjectChange}
        tasks={visibleTasks.map((task) => ({
          id: task.id,
          name: task.name,
          projectId: task.projectId,
        }))}
        taskId={status.selectedTask?.id ?? ""}
        onTaskChange={(id) => onTaskChange(id || "none")}
        selectionDisabled={submittingTask}
        note={sessionNote}
        onNoteChange={onSessionNoteChange}
        running={running}
        stateLabel={
          status.trackingPaused
            ? "Paused"
            : status.scheduledBreak
              ? "On break"
              : status.trackingStatus === "active"
                ? "Paid shift active"
                : status.trackingStatus
        }
        seconds={workedSeconds}
        targetSeconds={status.dailyTargetSeconds}
        sessionSeconds={status.activeSeconds}
        weekSeconds={status.timeSummary?.week.active_seconds ?? 0}
        activityPct={status.activityPercent}
        idleSeconds={Math.max(
          today?.idle_seconds ?? 0,
          status.todayTimeline?.idle_seconds ?? 0,
          status.eligibleIdleSeconds,
        )}
        overtimeSeconds={status.extraSeconds}
        approvedSeconds={today?.manual_approved_seconds ?? 0}
        pendingSeconds={today?.manual_pending_seconds ?? 0}
        rejectedSeconds={today?.manual_rejected_seconds ?? 0}
        shiftLabel={
          status.requestPolicy?.shift_start && status.requestPolicy.shift_end
            ? status.requestPolicy.shift_start +
              " – " +
              status.requestPolicy.shift_end
            : "Not configured"
        }
        startedAt={time(
          status.todayTimeline?.first_started_at ?? status.sessionStartedAt,
        )}
        lastActivityAt={time(status.todayTimeline?.last_activity_at)}
        onToggle={onTrackingToggle}
        controlBusy={changingTracking || submittingTask}
        onExplainIdle={() =>
          document
            .querySelector<HTMLDetailsElement>(".rd-workday-details")
            ?.setAttribute("open", "")
        }
        screenshot={
          latest ? (
            <img
              src={latest.dataUrl}
              alt={latest.displayName ?? "Latest workplace screenshot"}
            />
          ) : null
        }
        screenshotTime={time(latest?.capturedAt)}
        onOpenShots={onOpenScreenshots}
        timeline={(status.todayTimeline?.intervals ?? []).map(
          (item, index) => ({
            id: String(index),
            label: item.task_name ?? item.type.replaceAll("_", " "),
            time:
              (time(item.started_at) ?? "—") +
              " – " +
              (item.is_current ? "Until now" : (time(item.ended_at) ?? "—")),
            seconds: item.duration_seconds,
            kind: item.type,
          }),
        )}
      >
        {message && (
          <p className="rd-message" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="rd-error" role="alert">
            {error}
          </p>
        )}
      </TrackerStage>
      {taskRequest}
      {manualRequest}
      <details className="rd-card rd-workday-details">
        <summary>Workday details &amp; screenshots</summary>
        {children}
      </details>
    </section>
  );
}

export function NativeInsights({ status }: { status: AgentStatus }) {
  return (
    <section className="k-page">
      <h1 className="tracker-heading">Insights</h1>
      {(["today", "week", "month"] as const).map((key) => {
        const period = status.timeSummary?.[key];
        return (
          <article className="rd-card" key={key}>
            <h2>
              {key === "today"
                ? "Today"
                : key === "week"
                  ? "This week"
                  : "This month"}
            </h2>
            <strong className="app-num" style={{ fontSize: 28 }}>
              {duration(period?.active_seconds ?? 0)}
            </strong>
            <p>
              Tracked {duration(period?.tracked_active_seconds ?? 0)} · Manual
              approved {duration(period?.manual_approved_seconds ?? 0)}
            </p>
            <p>
              Pending {duration(period?.manual_pending_seconds ?? 0)} · Idle{" "}
              {duration(period?.idle_seconds ?? 0)}
            </p>
          </article>
        );
      })}
    </section>
  );
}

export type TaskRequestValues = {
  name: string;
  description: string;
  teamId: string;
  projectId: string;
  startDate: string;
  deadline: string;
};

export function ReaddyTaskRequest({
  status,
  teams,
  values,
  onChange,
  onSubmit,
  submitting,
  error,
}: {
  status: AgentStatus;
  teams: Array<[string, string]>;
  values: TaskRequestValues;
  onChange: (field: keyof TaskRequestValues, value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const [sent, setSent] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSent(true);
    onSubmit();
  };
  return (
    <article className="rd-card">
      <h2>Create task request</h2>
      <form className="rd-form" onSubmit={submit}>
        <fieldset disabled={submitting}>
          <label>
            Task name
            <input
              required
              maxLength={255}
              value={values.name}
              placeholder="Enter task name"
              onChange={(event) => {
                setSent(false);
                onChange("name", event.target.value);
              }}
            />
          </label>
          <label>
            Description
            <textarea
              aria-label="Description"
              rows={3}
              maxLength={1000}
              value={values.description}
              placeholder="Brief description of the task"
              onChange={(event) => onChange("description", event.target.value)}
            />
            <small className="rd-count">{values.description.length}/1000</small>
          </label>
          <div className="rd-form-grid">
            <label>
              Team
              <select
                aria-label="Team"
                required
                value={values.teamId}
                onChange={(event) => onChange("teamId", event.target.value)}
              >
                <option value="">Select team</option>
                {teams.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                aria-label="Project"
                required
                disabled={!values.teamId}
                value={values.projectId}
                onChange={(event) => onChange("projectId", event.target.value)}
              >
                <option value="">Select project</option>
                {status.projects
                  .filter((project) => project.team_id === values.teamId)
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="rd-workflow">
            <h3>Workflow</h3>
            <ol>
              {["Assigned", "In progress", "Review", "Completed"].map(
                (stage) => (
                  <li key={stage}>{stage}</li>
                ),
              )}
            </ol>
            <p>
              New tasks are sent to your manager for approval before tracking.
            </p>
          </div>
          <div className="rd-form-grid">
            <label>
              Start date
              <input
                type="date"
                value={values.startDate}
                onChange={(event) => onChange("startDate", event.target.value)}
              />
            </label>
            <label>
              Deadline
              <input
                type="date"
                min={values.startDate || undefined}
                value={values.deadline}
                onChange={(event) => onChange("deadline", event.target.value)}
              />
            </label>
          </div>
          <button
            type="submit"
            className="rd-primary"
            disabled={!values.name.trim() || !values.projectId || submitting}
          >
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </fieldset>
        {error && (
          <p className="rd-error" role="alert">
            {error}
          </p>
        )}
        {sent && !submitting && !error && !values.name && (
          <p className="rd-message" role="status">
            Task request sent for manager approval.
          </p>
        )}
        <p className="rd-help">
          Your request will be sent to an administrator for review. Track
          approval in Tasks.
        </p>
      </form>
    </article>
  );
}

export function ReaddyManualRequest({
  status,
  onStatusChange,
}: {
  status: AgentStatus;
  onStatusChange: (status: AgentStatus) => void;
}) {
  const localToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: status.requestPolicy?.timezone,
  }).format(new Date());
  const [date, setDate] = useState(localToday);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const requestedMinutes = Number(hours) * 60 + Number(minutes);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSent(false);
    if (!window.khaliduo || !status.enrolled || submitting) return;
    if (
      !Number.isInteger(requestedMinutes) ||
      requestedMinutes < 1 ||
      requestedMinutes > 720
    ) {
      setError("Request between 1 minute and 12 hours.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Add a reason of at least 3 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await window.khaliduo.createTimeAdjustmentRequest({
        requestType: "manual_time",
        requestedDate: date,
        requestedMinutes,
        reason: reason.trim(),
      });
      if (!result.success) {
        setError(
          result.message ?? "The request could not be sent. Please try again.",
        );
        return;
      }
      if (result.status) onStatusChange(result.status);
      setHours("");
      setMinutes("");
      setReason("");
      setSent(true);
    } catch {
      setError(
        "The request could not be sent. Your details are saved here; please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <article className="rd-card">
      <h2>Manual time request</h2>
      <form className="rd-form" onSubmit={submit}>
        <fieldset disabled={submitting}>
          <label>
            Date
            <input
              type="date"
              required
              value={date}
              max={localToday}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <div>
            <p className="rd-field-label">Duration</p>
            <div className="rd-duration-inputs">
              <label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  step={1}
                  placeholder="0"
                  aria-label="Hours"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                />
                <span>hours</span>
              </label>
              <label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={1}
                  placeholder="0"
                  aria-label="Minutes"
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
                <span>minutes</span>
              </label>
            </div>
          </div>
          <label>
            Reason
            <textarea
              aria-label="Reason"
              rows={3}
              required
              minLength={3}
              maxLength={1000}
              placeholder="Explain why this time should be logged manually"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <small className="rd-count">{reason.length}/1000</small>
          </label>
          <button
            className="rd-primary"
            type="submit"
            disabled={
              submitting ||
              requestedMinutes < 1 ||
              requestedMinutes > 720 ||
              reason.trim().length < 3
            }
          >
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </fieldset>
        {error && (
          <p className="rd-error" role="alert">
            {error}
          </p>
        )}
        {sent && (
          <p className="rd-message" role="status">
            Manual time request sent for approval.
          </p>
        )}
        <p className="rd-help">
          Manual time entries require administrator approval before they count
          toward your total.
        </p>
      </form>
    </article>
  );
}
