import SelectMenu from "../tracker-ui/SelectMenu";
import EmployeeTracker from "./EmployeeTracker";
import MotionPage from "@/components/motion/MotionPage";
import AnimatedText from "@/components/motion/AnimatedText";
import HeroRays from "@/components/motion/HeroRays";
import StarButton from "@/components/motion/StarButton";
import { useWorkspaceTheme } from "./useWorkspaceTheme";
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  employeeMe,
  employeeSummary,
  employeeTasks,
  employeeProjects,
  employeeWorkProfile,
  employeeTimeRequests,
  employeeLeaveRequests,
  employeeNotifications,
  employeeTaskWorkspace,
  createEmployeeTask,
  updateEmployeeTask,
  createEmployeeChecklistItem,
  updateEmployeeChecklistItem,
  createEmployeeTaskComment,
  uploadEmployeeTaskAttachment,
  createEmployeeTimeRequest,
  createEmployeeLeaveRequest,
  updateEmployeeProfile,
  readEmployeeNotification,
  type PortalTask,
} from "@/api/employee-portal";
import { ApiClientError, retryTransientRequest } from "@/api/client";
import { jwtSubjectScopeKey } from "@/lib/private-query-scope";
import { useNotePrompt } from "@/components/note-prompt-dialog";
import { WorkdayTimeline } from "@/components/workday-timeline";
import Header from "./Header";
import Tabs, { type TabKey } from "./Tabs";
import TimeSummaryCards from "./TimeSummaryCards";
import BreakdownDrawer from "./BreakdownDrawer";
import TaskTable from "./TaskTable";
import TaskDrawer from "./TaskDrawer";
import AddTaskDrawer, { type NewTaskPayload } from "./AddTaskDrawer";
import AttendancePanel from "./AttendancePanel";
import RequestsPanel from "./RequestsPanel";
import {
  HolidayDrawer,
  ManualTimeDrawer,
  RequestDetailDrawer,
  type HolidayPayload,
  type ManualTimePayload,
} from "./RequestDrawers";
import ProfileDrawer from "./ProfileDrawer";
import QuoteReminders from "./QuoteReminders";
import ScreenshotsPanel from "./ScreenshotsPanel";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { fmtDate, fmtSeconds } from "./format";
import {
  mapEmployee,
  mapTask,
  mapRequests,
  mapSummaries,
  mapAttendance,
  mapActivity,
} from "./adapters";
import type { SummaryKey, TaskStatus } from "./model";

type DrawerState =
  "none" | "breakdown" | "task" | "add-task" | "manual" | "holiday" | "profile" | "request-detail";
const PAGE_SIZE = 7;

export default function EmployeeWorkspace({
  token,
  onLogout,
  initialMode = "dashboard",
}: {
  token: string;
  onLogout: () => void;
  initialMode?: "dashboard" | "tracker";
}) {
  const { theme, toggleTheme } = useWorkspaceTheme();
  const [trackerMode, setTrackerMode] = useState(initialMode === "tracker");
  const client = useQueryClient();
  const { prompt, dialog: notePromptDialog } = useNotePrompt();
  const key = useMemo(() => ["employee-portal", jwtSubjectScopeKey(token)] as const, [token]);
  const [tab, setTab] = useState<TabKey>(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("view") === "screenshots"
      ? "screenshots"
      : "overview",
  );
  const [drawer, setDrawer] = useState<DrawerState>("none");
  const [quotesOpen, setQuotesOpen] = useState(false);
  const [breakdownScope, setBreakdownScope] = useState<SummaryKey>("today");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [taskPage, setTaskPage] = useState(1);
  const live = {
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: retryTransientRequest,
  };
  const me = useQuery({
    queryKey: [...key, "me"],
    queryFn: ({ signal }) => employeeMe(token, signal),
    retry: retryTransientRequest,
  });
  const summaryQuery = useQuery({
    queryKey: [...key, "summary"],
    queryFn: ({ signal }) => employeeSummary(token, signal),
    ...live,
  });
  const tasksQuery = useQuery({
    queryKey: [...key, "tasks"],
    queryFn: ({ signal }) => employeeTasks(token, signal),
    ...live,
  });
  const projectsQuery = useQuery({
    queryKey: [...key, "projects"],
    queryFn: ({ signal }) => employeeProjects(token, signal),
    staleTime: 300_000,
    retry: retryTransientRequest,
  });
  const workProfile = useQuery({
    queryKey: [...key, "work-profile"],
    queryFn: ({ signal }) => employeeWorkProfile(token, signal),
    staleTime: 300_000,
    retry: retryTransientRequest,
  });
  const timeRequests = useQuery({
    queryKey: [...key, "requests"],
    queryFn: ({ signal }) => employeeTimeRequests(token, signal),
    staleTime: 30_000,
    retry: retryTransientRequest,
  });
  const leaveRequests = useQuery({
    queryKey: [...key, "leave-requests"],
    queryFn: ({ signal }) => employeeLeaveRequests(token, signal),
    staleTime: 30_000,
    retry: retryTransientRequest,
  });
  const notificationsQuery = useQuery({
    queryKey: [...key, "notifications"],
    queryFn: ({ signal }) => employeeNotifications(token, signal),
    ...live,
    refetchInterval: 30_000,
  });
  const workspace = useQuery({
    queryKey: [...key, "task-workspace", activeTaskId],
    queryFn: ({ signal }) => employeeTaskWorkspace(token, activeTaskId!, signal),
    enabled: drawer === "task" && Boolean(activeTaskId),
    retry: retryTransientRequest,
  });
  const write = useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const perform = async (operation: () => Promise<unknown>, message: string, close = true) => {
    try {
      await write.mutateAsync(operation);
      if (close) setDrawer("none");
      setToast(message);
      return true;
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "The change could not be saved. Please try again.",
      );
      return false;
    }
  };
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleLogout = () => {
    client.removeQueries({ queryKey: ["employee-portal"] });
    client.removeQueries({ queryKey: ["protected-image", "employee"] });
    onLogout();
  };
  const openTask = (id: string) => {
    setActiveTaskId(id);
    setDrawer("task");
  };
  const openRequest = (id: string) => {
    setActiveRequestId(id);
    setDrawer("request-detail");
  };
  const handleStatusChange = async (taskId: string, status: TaskStatus) => {
    const task = tasksQuery.data?.find((item) => item.id === taskId);
    if (!task?.can_update_stage) return;
    const stage = {
      "Not started": "assigned",
      "In progress": "in_progress",
      "In review": "ready_for_review",
      Blocked: "blocked",
      Completed: "completed",
    }[status];
    let note: string | undefined;
    if (stage === "blocked" || stage === "ready_for_review" || task.stage === "blocked") {
      setDrawer("none");
      const value = await prompt({
        title:
          stage === "blocked"
            ? "Why is this task blocked?"
            : task.stage === "blocked"
              ? "How was the blocker resolved?"
              : "Submit task for review",
        placeholder: "Add a note for your manager",
        required: stage !== "ready_for_review",
      });
      setDrawer("task");
      if (value === null) return;
      note = value || undefined;
    }
    await perform(
      () => updateEmployeeTask(token, taskId, { stage, note }),
      "Task status updated",
      false,
    );
  };
  const handleToggleChecklist = (taskId: string, itemId: string) => {
    const item = tasksQuery.data
      ?.find((task) => task.id === taskId)
      ?.checklist?.find((item) => item.id === itemId);
    if (item)
      void perform(
        () => updateEmployeeChecklistItem(token, taskId, itemId, { completed: !item.completed }),
        "Checklist updated",
        false,
      );
  };
  const handleAddChecklist = (taskId: string, title: string) =>
    perform(() => createEmployeeChecklistItem(token, taskId, title), "Checklist item added", false);
  const handleAddComment = (taskId: string, body: string) =>
    perform(() => createEmployeeTaskComment(token, taskId, body), "Comment added", false);
  const handleUpload = (taskId: string, file: File) =>
    perform(
      () => uploadEmployeeTaskAttachment(token, taskId, file),
      "File attached to task",
      false,
    );
  const handleAddTask = async (payload: NewTaskPayload) => {
    const priority = payload.priority.toLowerCase() as PortalTask["priority"];
    if (
      await perform(
        () =>
          createEmployeeTask(token, {
            projectId: payload.project,
            name: payload.name,
            description: payload.description || undefined,
            startDate: payload.startDate || undefined,
            deadline: payload.deadline || undefined,
            priority,
          }),
        "Task submitted",
      )
    )
      setTaskPage(1);
  };
  const handleManualTime = (payload: ManualTimePayload) =>
    perform(
      () =>
        createEmployeeTimeRequest(token, {
          requestedDate: payload.date,
          requestedMinutes: payload.minutes,
          reason: payload.reason,
        }),
      "Time request sent for review",
    );
  const handleHoliday = (payload: HolidayPayload) =>
    perform(
      () =>
        createEmployeeLeaveRequest(token, {
          startDate: payload.from,
          endDate: payload.to,
          leaveType: "annual",
          reason: payload.reason || undefined,
        }),
      "Holiday request sent for review",
    );
  const handleProfileSave = (values: { name: string; avatar: string }) =>
    perform(
      () => updateEmployeeProfile(token, { name: values.name, avatarUrl: values.avatar || null }),
      "Profile updated",
    );
  const markRead = (id?: string) => {
    const unread = (notificationsQuery.data ?? []).filter(
      (item) => !item.read_at && (!id || item.id === id),
    );
    void perform(
      () => Promise.all(unread.map((item) => readEmployeeNotification(token, item.id))),
      "Notifications updated",
      false,
    );
    const notification = notificationsQuery.data?.find((item) => item.id === id);
    if (notification?.task_id) openTask(notification.task_id);
  };

  const sessionExpired = [me.error, summaryQuery.error].some(
    (error) => error instanceof ApiClientError && (error.status === 401 || error.status === 403),
  );
  if (sessionExpired)
    return (
      <div className="employee-workspace grid place-items-center p-8">
        <div className="k-card p-8 text-center">
          <h1 className="text-xl font-semibold">Your session expired</h1>
          <button
            className="mt-4 rounded-lg bg-ew-solid px-4 py-2 text-white"
            onClick={handleLogout}
          >
            Sign in again
          </button>
        </div>
      </div>
    );
  if (!me.data || !summaryQuery.data)
    return (
      <div className="employee-workspace grid place-items-center p-8">
        <div
          className={
            me.isError || summaryQuery.isError
              ? "k-card min-w-60 p-8 text-center"
              : "p-8 text-center"
          }
          role={me.isError || summaryQuery.isError ? "alert" : "status"}
        >
          {me.isError || summaryQuery.isError ? (
            <h1 className="text-xl font-semibold">Could not load your workspace</h1>
          ) : (
            <>
              <span
                className="mx-auto block size-10 rounded-full border-[3px] border-ew-line border-t-ew-brand border-r-ew-pink motion-safe:animate-spin"
                aria-hidden="true"
              />
              <span className="sr-only">Loading your workspace</span>
            </>
          )}
          {(me.isError || summaryQuery.isError) && (
            <button
              className="mt-4 rounded-lg bg-ew-solid px-4 py-2 text-white"
              onClick={() => {
                void me.refetch();
                void summaryQuery.refetch();
              }}
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );

  const profile = mapEmployee(me.data);
  const summaries = mapSummaries(summaryQuery.data, workProfile.data);
  const attendance = mapAttendance(summaryQuery.data, workProfile.data);
  const todayActivity = mapActivity(summaryQuery.data);
  const tasks = (tasksQuery.data ?? []).map((task) => mapTask(task));
  const activeBackendTask = tasksQuery.data?.find((task) => task.id === activeTaskId);
  const activeTask = activeBackendTask ? mapTask(activeBackendTask, workspace.data) : null;
  const requests = mapRequests(timeRequests.data ?? [], leaveRequests.data).sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const activeRequest = requests.find((item) => item.id === activeRequestId) ?? null;
  const breakdownSummary = summaries.find((item) => item.key === breakdownScope) ?? summaries[0];
  const notifications = (notificationsQuery.data ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    body: item.message,
    at: new Date(item.created_at).toLocaleString(),
    unread: !item.read_at,
    icon: "ri-notification-3-line",
  }));
  const unreadCount = notifications.filter((item) => item.unread).length;
  const pendingApprovals = tasks.filter((task) => task.approval === "Pending").length;
  const allowance = {
    annualTotal: leaveRequests.data?.balance.credit_days ?? 0,
    annualRemaining: leaveRequests.data?.balance.remaining_days ?? 0,
  };
  const filteredTasks = tasks.filter(
    (task) =>
      (statusFilter === "all" || task.status === statusFilter) &&
      `${task.name} ${task.project} ${task.team}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const currentPage = Math.min(taskPage, pageCount);
  const pagedTasks = filteredTasks.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const nextTask = tasks
    .filter((task) => task.deadline && task.status !== "Completed")
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  const now = new Date();
  const greeting =
    now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const sectionErrors = [
    tasksQuery,
    projectsQuery,
    workProfile,
    timeRequests,
    leaveRequests,
    notificationsQuery,
  ].filter((item) => item.isError);

  // The view below preserves the selected Readdy design; all data and writes use
  // the application's existing employee APIs and server approval rules.

  return (
    <MotionPage
      className={`employee-workspace readdy-tracker-ui ${theme === "dark" ? "dark" : ""}`}
      scrollContainer={trackerMode ? "[data-motion-scroller]" : undefined}
    >
      {trackerMode ? (
        <EmployeeTracker
          refreshError={sectionErrors.length > 0}
          token={token}
          profile={profile}
          summary={summaryQuery.data}
          summaries={summaries}
          projects={projectsQuery.data ?? []}
          tasks={tasksQuery.data ?? []}
          shiftLabel={`${attendance.shiftStart} – ${attendance.shiftEnd}`}
          theme={theme}
          onThemeChange={toggleTheme}
          onDashboard={() => setTrackerMode(false)}
          onLogout={handleLogout}
          onProfile={() => setDrawer("profile")}
          onQuotes={() => setQuotesOpen(true)}
          onRequestTime={() => setDrawer("manual")}
          panels={{
            screenshots: <ScreenshotsPanel token={token} />,
            tasks: (
              <section className="k-card p-3.5">
                <div className="flex items-center justify-between">
                  <h1>My tasks</h1>
                  <button
                    type="button"
                    className="rounded-md bg-ew-solid px-3 py-2 text-white"
                    onClick={() => setDrawer("add-task")}
                  >
                    Add task
                  </button>
                </div>
                <TaskTable tasks={tasks} onOpen={openTask} />
              </section>
            ),
            attendance: (
              <>
                <AttendancePanel attendance={attendance} activity={todayActivity} />
                <section className="k-card mt-3 p-3.5">
                  <WorkdayTimeline timeline={summaryQuery.data.todayTimeline} />
                </section>
              </>
            ),
            insights: (
              <TimeSummaryCards
                summaries={summaries}
                onBreakdown={(key) => {
                  setBreakdownScope(key);
                  setDrawer("breakdown");
                }}
              />
            ),
            requests: (
              <RequestsPanel
                requests={requests}
                allowance={allowance}
                onRequestTime={() => setDrawer("manual")}
                onRequestHoliday={() => setDrawer("holiday")}
                onView={openRequest}
              />
            ),
          }}
        />
      ) : (
        <>
          <div
            className="k-wm k-wm-horse"
            aria-hidden="true"
            style={{
              WebkitMaskImage: 'url("/employee-workspace/horse.png")',
              maskImage: 'url("/employee-workspace/horse.png")',
            }}
          />
          <div
            className="k-wm k-wm-bird"
            aria-hidden="true"
            style={{
              WebkitMaskImage: 'url("/employee-workspace/bird.png")',
              maskImage: 'url("/employee-workspace/bird.png")',
            }}
          />

          <Header
            theme={theme}
            onToggleTheme={toggleTheme}
            onOpenTracker={() => setTrackerMode(true)}
            employee={profile}
            notifications={notifications}
            unreadCount={unreadCount}
            shiftLabel={`${attendance.shiftStart} – ${attendance.shiftEnd}`}
            trackingActive={attendance.status === "active"}
            onOpenProfile={() => setDrawer("profile")}
            onOpenQuotes={() => setQuotesOpen(true)}
            onDownloadApp={() => {
              window.location.assign("/download");
            }}
            onLogout={handleLogout}
            onMarkAllRead={() => markRead()}
            onOpenNotification={(id) => markRead(id)}
          />

          <main
            id="main"
            className="relative z-10 mx-auto w-full max-w-[1400px] px-4 pb-14 pt-4 md:px-6"
          >
            <div className="motion-hero flex flex-wrap items-end justify-between gap-3">
              <HeroRays />
              <div className="min-w-0">
                <p className="k-label">{dateLabel}</p>
                <h1 className="mt-1 font-ew-heading text-[22px] font-semibold leading-tight text-ew-plum md:text-[26px]">
                  <AnimatedText text={`${greeting}, ${profile.firstName}`} />
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full border border-ew-line bg-ew-card px-2 py-[3px] text-[11px] font-semibold text-ew-ink-2">
                    <span className="flex h-3 w-3 items-center justify-center">
                      <WorkspaceIcon
                        className="ri-time-line text-[11px] text-ew-pink"
                        aria-hidden="true"
                      />
                    </span>
                    {attendance.shiftLabel}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-ew-bg-2 px-2 py-[3px] text-[11px] font-semibold text-ew-ink-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-ew-ok" aria-hidden="true" />
                    {attendance.status === "active" ? "Shift active" : "No active shift"}
                  </span>
                  <span className="hidden items-center gap-1 rounded-full border border-ew-line bg-ew-card px-2 py-[3px] text-[11px] text-ew-muted sm:inline-flex">
                    {attendance.lateMinutes} min late after {attendance.graceMinutes} min grace
                  </span>
                  {pendingApprovals > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-ew-warn-2 px-2 py-[3px] text-[11px] font-semibold text-ew-warn">
                      {pendingApprovals} awaiting approval
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <StarButton
                  type="button"
                  onClick={() => setDrawer("manual")}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md bg-ew-solid px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-ew-solid-2"
                >
                  <span className="flex h-4 w-4 items-center justify-center">
                    <WorkspaceIcon className="ri-timer-line text-[13px]" aria-hidden="true" />
                  </span>
                  Request time
                </StarButton>
                <button
                  type="button"
                  onClick={() => setDrawer("holiday")}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-ew-plum bg-ew-card px-3 py-2 text-[12.5px] font-semibold text-ew-plum transition-colors hover:bg-ew-bg-2"
                >
                  <span className="flex h-4 w-4 items-center justify-center">
                    <WorkspaceIcon
                      className="ri-calendar-event-line text-[13px]"
                      aria-hidden="true"
                    />
                  </span>
                  Request holiday
                </button>
              </div>
            </div>

            {sectionErrors.length > 0 ? (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-ew-warn-2 bg-ew-warn-2 p-3 text-xs text-ew-warn"
              >
                Some sections could not refresh.{" "}
                <button
                  className="font-semibold underline"
                  onClick={() => void client.invalidateQueries({ queryKey: key })}
                >
                  Retry
                </button>
              </div>
            ) : null}
            <div className="mt-3">
              <Tabs
                value={tab}
                onChange={setTab}
                counts={{ tasks: tasks.filter((task) => task.status !== "Completed").length }}
              />
            </div>

            {tab === "overview" ? (
              <div
                role="tabpanel"
                id="panel-overview"
                aria-labelledby="tab-overview"
                className="k-enter mt-3"
              >
                <TimeSummaryCards
                  summaries={summaries}
                  onBreakdown={(key) => {
                    setBreakdownScope(key);
                    setDrawer("breakdown");
                  }}
                />

                <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-12">
                  <section className="k-card flex flex-col overflow-hidden lg:col-span-8">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ew-line px-3.5 py-2.5">
                      <div className="flex items-baseline gap-2">
                        <h2 className="font-ew-heading text-[13.5px] font-semibold text-ew-plum">
                          My tasks
                        </h2>
                        <span className="font-ew-mono text-[10px] uppercase tracking-[0.08em] text-ew-muted">
                          {tasks.filter((task) => task.status !== "Completed").length} open
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDrawer("add-task")}
                          className="flex cursor-pointer items-center gap-1 rounded-md border border-ew-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ew-ink-2 transition-colors hover:border-ew-plum-2 hover:text-ew-plum"
                        >
                          <WorkspaceIcon className="ri-add-line text-[13px]" aria-hidden="true" />
                          Add task
                        </button>
                        <button
                          type="button"
                          onClick={() => setTab("tasks")}
                          className="flex cursor-pointer items-center gap-1 rounded-md bg-ew-bg-2 px-2 py-1 text-[11.5px] font-semibold text-ew-plum transition-colors hover:bg-ew-line-2"
                        >
                          View all tasks
                          <WorkspaceIcon
                            className="ri-arrow-right-line text-[12px]"
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </div>
                    <div className="px-2 pb-1">
                      <TaskTable tasks={tasks.slice(0, 5)} onOpen={openTask} />
                    </div>
                    <div className="flex items-center justify-between border-t border-ew-line px-3.5 py-1.5">
                      <p className="font-ew-mono text-[10px] uppercase tracking-[0.08em] text-ew-muted">
                        Showing {Math.min(5, tasks.length)} of {tasks.length}
                      </p>
                      <button
                        type="button"
                        onClick={() => setTab("tasks")}
                        className="cursor-pointer text-[11.5px] font-semibold text-ew-pink hover:underline"
                      >
                        Open task board
                      </button>
                    </div>
                  </section>

                  <div className="lg:col-span-4">
                    <AttendancePanel attendance={attendance} activity={todayActivity} />
                    <div className="mt-3 rounded-xl border border-ew-line bg-ew-card px-3 py-2.5">
                      <p className="k-label">Next up</p>
                      <p className="mt-1 text-[11.5px] leading-snug text-ew-ink-2" dir="auto">
                        {nextTask
                          ? `${nextTask.name} · due ${fmtDate(nextTask.deadline)}`
                          : "No upcoming deadlines."}
                      </p>
                      {nextTask ? (
                        <button
                          type="button"
                          onClick={() => openTask(nextTask.id)}
                          className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-ew-pink"
                        >
                          Open task <WorkspaceIcon className="ri-arrow-right-line" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {tab === "tasks" ? (
              <div
                role="tabpanel"
                id="panel-tasks"
                aria-labelledby="tab-tasks"
                className="k-enter mt-3"
              >
                <section className="k-card flex flex-wrap items-end justify-between gap-2 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-0">
                      <label htmlFor="task-search" className="k-field-label">
                        Search
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-ew-muted">
                          <WorkspaceIcon
                            className="ri-search-line text-[13px]"
                            aria-hidden="true"
                          />
                        </span>
                        <input
                          id="task-search"
                          className="k-input w-[210px] pl-7"
                          value={query}
                          onChange={(event) => {
                            setQuery(event.target.value);
                            setTaskPage(1);
                          }}
                          placeholder="Task, project or team"
                        />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="task-status-filter" className="k-field-label">
                        Status
                      </label>
                      <SelectMenu
                        id="task-status-filter"
                        ariaLabel="Status"
                        className="w-[150px]"
                        value={statusFilter}
                        options={[
                          { value: "all", label: "All statuses" },
                          ...(
                            [
                              "Not started",
                              "In progress",
                              "In review",
                              "Blocked",
                              "Completed",
                            ] as TaskStatus[]
                          ).map((status) => ({ value: status, label: status })),
                        ]}
                        onChange={(value) => {
                          setStatusFilter(value as "all" | TaskStatus);
                          setTaskPage(1);
                        }}
                      />
                    </div>
                    <p className="pb-2 font-ew-mono text-[10px] uppercase tracking-[0.08em] text-ew-muted">
                      {filteredTasks.length} matching
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawer("add-task")}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md bg-ew-solid px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-ew-solid-2"
                  >
                    <WorkspaceIcon className="ri-add-line text-[14px]" aria-hidden="true" />
                    Add task
                  </button>
                </section>

                <section className="k-card mt-3 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ew-line px-3.5 py-2.5">
                    <h2 className="font-ew-heading text-[13.5px] font-semibold text-ew-plum">
                      All tasks
                    </h2>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(["In progress", "In review", "Blocked", "Completed"] as TaskStatus[]).map(
                        (status) => (
                          <span
                            key={status}
                            className="rounded-md bg-ew-bg-2 px-1.5 py-[3px] text-[10.5px] font-medium text-ew-ink-2"
                          >
                            {status} · {tasks.filter((task) => task.status === status).length}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                  <div className="px-2 py-1">
                    <TaskTable
                      tasks={pagedTasks}
                      onOpen={openTask}
                      emptyTitle={
                        query || statusFilter !== "all"
                          ? "No tasks match this filter"
                          : "No tasks yet"
                      }
                      emptyBody={
                        query || statusFilter !== "all"
                          ? "Try a different search or clear the status filter."
                          : "Use Add task to start your first task."
                      }
                      pagination={{
                        page: currentPage,
                        pageCount,
                        total: filteredTasks.length,
                        onPageChange: setTaskPage,
                      }}
                    />
                  </div>
                </section>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="k-card px-3 py-2.5">
                    <p className="k-label">Tracked active time today</p>
                    <p className="mt-1 font-ew-mono text-[15px] font-semibold text-ew-plum">
                      {fmtSeconds(summaryQuery.data.today.tracked_active_seconds)}
                    </p>
                  </div>
                  <div className="k-card px-3 py-2.5">
                    <p className="k-label">Awaiting manager approval</p>
                    <p className="mt-1 font-ew-mono text-[15px] font-semibold text-ew-warn">
                      {pendingApprovals} tasks
                    </p>
                  </div>
                  <div className="k-card px-3 py-2.5">
                    <p className="k-label">Next deadline</p>
                    <p className="mt-1 text-[13px] font-semibold text-ew-plum">
                      {nextTask ? fmtDate(nextTask.deadline) : "—"}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {tab === "attendance" ? (
              <div
                role="tabpanel"
                id="panel-attendance"
                aria-labelledby="tab-attendance"
                className="k-enter mt-3"
              >
                <TimeSummaryCards
                  summaries={summaries}
                  onBreakdown={(key) => {
                    setBreakdownScope(key);
                    setDrawer("breakdown");
                  }}
                />
                <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-12">
                  <div className="lg:col-span-5">
                    <AttendancePanel attendance={attendance} activity={todayActivity} />
                  </div>
                  <div className="space-y-3 lg:col-span-7">
                    <section className="k-card p-3.5">
                      <h2 className="mb-3 font-ew-heading text-sm font-semibold text-ew-plum">
                        Today’s workday timeline
                      </h2>
                      <WorkdayTimeline timeline={summaryQuery.data.todayTimeline} />
                    </section>
                    <section className="k-card px-3.5 py-3">
                      <h2 className="font-ew-heading text-[13.5px] font-semibold text-ew-plum">
                        How time is counted
                      </h2>
                      <ul className="mt-2 space-y-1.5 text-[11.5px] leading-snug text-ew-ink-2">
                        <li className="flex gap-2">
                          <span
                            className="mt-1 h-1 w-1 flex-none rounded-full bg-ew-pink"
                            aria-hidden="true"
                          />
                          Worked time and approved manual time are counted. Idle, pending and
                          rejected minutes never enter the total.
                        </li>
                        <li className="flex gap-2">
                          <span
                            className="mt-1 h-1 w-1 flex-none rounded-full bg-ew-pink"
                            aria-hidden="true"
                          />
                          The {attendance.graceMinutes} minute grace period starts at{" "}
                          {attendance.shiftStart}. Anything after that shows as late.
                        </li>
                        <li className="flex gap-2">
                          <span
                            className="mt-1 h-1 w-1 flex-none rounded-full bg-ew-pink"
                            aria-hidden="true"
                          />
                          Overtime only appears once a manager approves the extra time.
                        </li>
                        <li className="flex gap-2">
                          <span
                            className="mt-1 h-1 w-1 flex-none rounded-full bg-ew-pink"
                            aria-hidden="true"
                          />
                          Running status comes from your recorded activity. A missing sign-out alone
                          does not mean absence.
                        </li>
                      </ul>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDrawer("manual")}
                          className="flex cursor-pointer items-center gap-1 rounded-md border border-ew-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ew-plum transition-colors hover:bg-ew-bg-2"
                        >
                          <WorkspaceIcon className="ri-timer-line text-[12px]" aria-hidden="true" />
                          Request time
                        </button>
                        <button
                          type="button"
                          onClick={() => setDrawer("holiday")}
                          className="flex cursor-pointer items-center gap-1 rounded-md border border-ew-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ew-plum transition-colors hover:bg-ew-bg-2"
                        >
                          <WorkspaceIcon
                            className="ri-calendar-event-line text-[12px]"
                            aria-hidden="true"
                          />
                          Request holiday
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            ) : null}

            {tab === "requests" ? (
              <div
                role="tabpanel"
                id="panel-requests"
                aria-labelledby="tab-requests"
                className="k-enter mt-3"
              >
                <RequestsPanel
                  requests={requests}
                  allowance={allowance}
                  onRequestTime={() => setDrawer("manual")}
                  onRequestHoliday={() => setDrawer("holiday")}
                  onView={openRequest}
                />
                <p className="mt-2 px-1 text-[11px] leading-snug text-ew-muted">
                  Request history is kept exactly as submitted. Pending minutes stay out of your
                  counted total until a manager signs them off.
                </p>
              </div>
            ) : null}
            {tab === "screenshots" ? (
              <div
                role="tabpanel"
                id="panel-screenshots"
                aria-labelledby="tab-screenshots"
                className="k-enter mt-3"
              >
                <ScreenshotsPanel token={token} />
              </div>
            ) : null}
          </main>
        </>
      )}

      <BreakdownDrawer
        open={drawer === "breakdown"}
        summary={breakdownSummary}
        scopes={summaries}
        onSelectScope={setBreakdownScope}
        onClose={() => setDrawer("none")}
      />

      <TaskDrawer
        busy={write.isPending}
        workspaceLoading={workspace.isPending && Boolean(activeTaskId)}
        open={drawer === "task"}
        task={activeTask}
        onClose={() => setDrawer("none")}
        onStatusChange={handleStatusChange}
        onToggleChecklist={handleToggleChecklist}
        onAddChecklist={handleAddChecklist}
        onAddComment={handleAddComment}
        onUpload={handleUpload}
      />

      <AddTaskDrawer
        projects={projectsQuery.data ?? []}
        busy={write.isPending || projectsQuery.isPending}
        open={drawer === "add-task"}
        onClose={() => setDrawer("none")}
        onSubmit={handleAddTask}
      />

      <ManualTimeDrawer
        busy={write.isPending}
        open={drawer === "manual"}
        onClose={() => setDrawer("none")}
        onSubmit={handleManualTime}
        trackingPaused={attendance.status !== "active"}
      />

      <HolidayDrawer
        busy={write.isPending || leaveRequests.isPending}
        workingDays={workProfile.data?.working_days}
        open={drawer === "holiday"}
        onClose={() => setDrawer("none")}
        onSubmit={handleHoliday}
        allowance={allowance}
      />

      <RequestDetailDrawer
        open={drawer === "request-detail"}
        request={activeRequest}
        onClose={() => setDrawer("none")}
      />

      <ProfileDrawer
        busy={write.isPending}
        open={drawer === "profile"}
        employee={profile}
        onClose={() => setDrawer("none")}
        onSave={handleProfileSave}
      />

      <QuoteReminders
        key={me.data.id}
        employeeId={me.data.id}
        open={quotesOpen}
        onClose={() => setQuotesOpen(false)}
      />
      {notePromptDialog}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="k-toast fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-ew-line bg-ew-solid px-3.5 py-2 text-[12px] font-medium text-white"
        >
          <span className="flex h-4 w-4 items-center justify-center">
            <WorkspaceIcon className="ri-check-line text-[14px]" aria-hidden="true" />
          </span>
          {toast}
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="ml-1 flex h-4 w-4 cursor-pointer items-center justify-center text-white/70 hover:text-white"
          >
            <WorkspaceIcon className="ri-close-line text-[13px]" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </MotionPage>
  );
}
