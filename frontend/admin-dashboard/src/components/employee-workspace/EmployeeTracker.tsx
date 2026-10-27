import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  employeeScreenshots,
  createEmployeeTask,
  type PortalProject,
  type PortalTask,
  type PortalSummary,
} from "@/api/employee-portal";
import { ProtectedImage } from "@/components/ProtectedImage";
import { jwtSubjectScopeKey } from "@/lib/private-query-scope";
import { retryTransientRequest } from "@/api/client";
import { TrackerFrame, TrackerStage } from "../tracker-ui/TrackerWorkspace";
import type { Employee, TimeSummary } from "./model";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { countedSeconds } from "./model";
import type { Appearance, AppearancePatch } from "../../../../shared/appearance-store";

export default function EmployeeTracker({
  token,
  profile,
  summary,
  summaries,
  projects,
  tasks,
  shiftLabel,
  theme,
  onThemeChange,
  appearance,
  onAppearanceChange,
  onDashboard,
  onLogout,
  onProfile,
  onQuotes,
  onRequestTime,
  panels,
  refreshError,
}: {
  token: string;
  profile: Employee;
  summary: PortalSummary;
  summaries: TimeSummary[];
  projects: PortalProject[];
  tasks: PortalTask[];
  shiftLabel: string;
  theme: "light" | "dark";
  onThemeChange: () => void;
  appearance: Appearance;
  onAppearanceChange: (patch: AppearancePatch) => void;
  onDashboard: () => void;
  onLogout: () => void;
  onProfile: () => void;
  onQuotes: () => void;
  onRequestTime: () => void;
  panels: Record<"tasks" | "screenshots" | "attendance" | "insights" | "requests", ReactNode>;
  refreshError: boolean;
}) {
  const client = useQueryClient();
  const scope = ["employee-portal", jwtSubjectScopeKey(token)];
  const [view, setView] = useState("tracker");
  const [projectSelection, setProjectId] = useState<string | null>(null);
  const projectId =
    projectSelection ??
    projects.find((project) => project.name.trim().toLowerCase() === "general work")?.id ??
    (projects.length === 1 ? projects[0].id : "");
  const [taskId, setTaskId] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const creatingTask = useRef(false);
  const day = summary.todayTimeline.date;
  const shots = useQuery({
    queryKey: [...scope, "screenshots", day],
    queryFn: ({ signal }) => employeeScreenshots(token, day, signal),
    enabled: view === "tracker",
    staleTime: 30_000,
    refetchInterval: view === "tracker" ? 30_000 : false,
    retry: retryTransientRequest,
  });
  const createTask = useMutation({
    mutationFn: (input: { name: string; projectId: string }) => createEmployeeTask(token, input),
    onSuccess: (task) => {
      setNewTaskName("");
      setTaskMessage(
        task.stage === "new_requests" ? "Task sent for manager approval." : "Task created.",
      );
      void client.invalidateQueries({ queryKey: scope });
    },
    onError: (error) =>
      setTaskError(
        error instanceof Error ? error.message : "Could not create the task. Please try again.",
      ),
    onSettled: () => {
      creatingTask.current = false;
    },
  });
  const submitQuickTask = () => {
    const name = newTaskName.trim();
    if (!name || name.length > 255 || creatingTask.current) return;
    setTaskError(null);
    setTaskMessage(null);
    if (!projectId) {
      setTaskError("Choose a project for the new task.");
      return;
    }
    creatingTask.current = true;
    createTask.mutate({ name, projectId });
  };
  const today = summary.today;
  const running = summary.todayTimeline.isRunning;
  const stateLabel = running
    ? "Paid shift active"
    : summary.todayTimeline.lastEndedAt
      ? "Shift ended"
      : "Not started";
  const time = (value?: string | null) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleTimeString([], {
          timeZone: summary.todayTimeline.timezone,
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const active = summary.todayTimeline.intervals.find((item) => item.isCurrent);
  const sessionSeconds = active?.sessionId
    ? summary.todayTimeline.intervals
        .filter((item) => item.sessionId === active.sessionId && item.type === "worked")
        .reduce((sum, item) => sum + item.durationSeconds, 0)
    : 0;
  const activityBase = today.tracked_active_seconds + today.idle_seconds;
  const screenshot = shots.data?.[0];
  return (
    <TrackerFrame
      name={profile.name}
      email={profile.email}
      avatar={profile.avatar}
      logo="/khaliduo-icon.png"
      theme={theme}
      onThemeChange={onThemeChange}
      appearance={appearance}
      onAppearanceChange={onAppearanceChange}
      sections={[
        { id: "tracker", label: "Tracker", icon: "ri-timer-line" },
        { id: "screenshots", label: "Screenshots", icon: "ri-image-line" },
        { id: "tasks", label: "Tasks", icon: "ri-task-line" },
        { id: "attendance", label: "Attendance", icon: "ri-focus-line" },
        { id: "insights", label: "Insights", icon: "ri-bar-chart-line" },
        { id: "requests", label: "Requests", icon: "ri-inbox-line" },
      ]}
      view={view}
      onViewChange={setView}
      seconds={countedSeconds(summaries[0].breakdown)}
      running={running}
      stateLabel={stateLabel}
      shiftLabel={shiftLabel}
      shotsLabel="Workplace captures"
      synced={!refreshError && !shots.isError}
      onSync={() => void client.invalidateQueries({ queryKey: scope })}
      onDashboard={onDashboard}
      headerControls={
        <>
          <button
            className="app-nav-btn"
            type="button"
            onClick={onQuotes}
            aria-label="Quote reminders"
            title="Quote reminders"
          >
            <WorkspaceIcon className="ri-notification-3-line" aria-hidden="true" />
          </button>
          <button
            className="app-nav-btn"
            type="button"
            onClick={onProfile}
            aria-label="Edit profile"
          >
            Profile
          </button>
          <button className="app-nav-btn" type="button" onClick={onLogout} aria-label="Log out">
            ↪
          </button>
        </>
      }
    >
      {view === "tracker" ? (
        <TrackerStage
          name={profile.name}
          avatar={profile.avatar}
          projects={projects}
          projectId={projectId}
          onProjectChange={(id) => {
            setProjectId(id);
            setTaskId("");
          }}
          tasks={tasks
            .filter((task) => !["cancelled", "rejected", "completed"].includes(task.stage))
            .map((task) => ({ id: task.id, name: task.name, projectId: task.project_id }))}
          taskId={taskId}
          onTaskChange={setTaskId}
          selectionDisabled={createTask.isPending}
          note={newTaskName}
          onNoteChange={(value) => {
            setNewTaskName(value);
            setTaskError(null);
            setTaskMessage(null);
          }}
          noteSaving={createTask.isPending}
          onNoteSubmit={submitQuickTask}
          running={running}
          stateLabel={stateLabel}
          seconds={countedSeconds(summaries[0].breakdown)}
          targetSeconds={summaries[0].breakdown.targetSeconds}
          sessionSeconds={sessionSeconds}
          weekSeconds={countedSeconds(summaries[1].breakdown)}
          activityPct={activityBase ? (today.tracked_active_seconds / activityBase) * 100 : null}
          idleSeconds={today.idle_seconds}
          overtimeSeconds={summary.daily_attendance.recorded_overtime_seconds}
          approvedSeconds={today.manual_approved_seconds}
          pendingSeconds={today.manual_pending_seconds}
          rejectedSeconds={today.manual_rejected_seconds}
          shiftLabel={shiftLabel}
          startedAt={time(summary.todayTimeline.firstStartedAt)}
          lastActivityAt={time(summary.todayTimeline.lastActivityAt)}
          onExplainIdle={onRequestTime}
          screenshot={
            screenshot ? (
              <ProtectedImage
                src={screenshot.thumbnailUrl}
                authToken={token}
                alt="Latest workplace capture"
              />
            ) : shots.isPending ? (
              <p role="status">Loading capture…</p>
            ) : null
          }
          screenshotTime={time(screenshot?.captured_at)}
          onOpenShots={() => setView("screenshots")}
          onOpenAttendance={() => setView("attendance")}
          synced={!refreshError}
          timeline={summary.todayTimeline.intervals.map((item, index) => ({
            id: `${item.sessionId}-${index}`,
            label: item.taskName ?? item.type,
            time: `${time(item.startedAt) ?? "—"} – ${item.isCurrent ? "Until now" : (time(item.endedAt) ?? "—")}`,
            seconds: item.durationSeconds,
            kind: item.type,
            current: item.isCurrent,
            category: item.workCategory,
          }))}
        >
          {taskError && <p role="alert">{taskError}</p>}
          {taskMessage && <p role="status">{taskMessage}</p>}
          {shots.isError && (
            <p role="alert">Could not refresh the latest capture. Use Retry sync to try again.</p>
          )}
        </TrackerStage>
      ) : (
        panels[view as keyof typeof panels]
      )}
    </TrackerFrame>
  );
}
