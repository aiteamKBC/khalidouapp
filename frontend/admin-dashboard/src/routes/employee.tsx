import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  Clock3,
  Download,
  LogOut,
  Plus,
  Star,
  Bell,
  MessageSquare,
  Paperclip,
  CameraIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { DatePicker } from "@/components/ui/date-picker";
import {
  clearEmployeeToken,
  createEmployeeTimeRequest,
  createEmployeeTask,
  employeeLogin,
  employeeMe,
  employeeProjects,
  employeeScreenshots,
  employeeSummary,
  employeeTasks,
  employeeTimeRequests,
  employeeNotifications,
  readEmployeeNotification,
  createEmployeeChecklistItem,
  updateEmployeeChecklistItem,
  employeeTaskWorkspace,
  createEmployeeTaskComment,
  uploadEmployeeTaskAttachment,
  exchangeEmployeeHandoff,
  readEmployeeToken,
  saveEmployeeToken,
  updateEmployeeTask,
  updateEmployeeProfile,
  forgotEmployeeAccessKey,
  employeeLeaveRequests,
  createEmployeeLeaveRequest,
  type PortalPeriod,
} from "@/api/employee-portal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WorkdayTimeline } from "@/components/workday-timeline";

export const Route = createFileRoute("/employee")({ component: EmployeePortalPage });

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function EmployeePortalPage() {
  const [token, setToken] = useState(() => readEmployeeToken());
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handoffToken = new URLSearchParams(window.location.search).get("handoff");
    if (!handoffToken) return;

    setHandoffLoading(true);
    void exchangeEmployeeHandoff(handoffToken)
      .then((result) => {
        saveEmployeeToken(result.access_token);
        setToken(result.access_token);
        const target = new URL(window.location.href);
        target.searchParams.delete("handoff");
        window.history.replaceState({}, "", `${target.pathname}${target.search}`);
      })
      .catch((error: unknown) => {
        setHandoffError(error instanceof Error ? error.message : "The dashboard link expired.");
        const target = new URL(window.location.href);
        target.searchParams.delete("handoff");
        window.history.replaceState({}, "", `${target.pathname}${target.search}`);
      })
      .finally(() => setHandoffLoading(false));
  }, [token]);

  if (!token && handoffLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-5">
        <Card className="w-full max-w-md p-8 text-center shadow-xl">
          <BrandLogo className="mx-auto mb-4 h-20 w-20 rounded-2xl" />
          <h1 className="text-xl font-semibold">Opening your Khaliduo dashboard...</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Securely signing in from the desktop app.
          </p>
        </Card>
      </main>
    );
  }
  if (!token) return <EmployeeLogin onLoggedIn={setToken} initialError={handoffError} />;
  return (
    <EmployeeDashboard
      token={token}
      onLogout={() => {
        clearEmployeeToken();
        setToken(null);
      }}
    />
  );
}

function EmployeeLogin({
  onLoggedIn,
  initialError,
}: {
  onLoggedIn: (token: string) => void;
  initialError?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [credential, setCredential] = useState("");
  const [useLegacyKey, setUseLegacyKey] = useState(false);
  const login = useMutation({
    mutationFn: () =>
      employeeLogin(email, useLegacyKey ? { accessKey: credential } : { password: credential }),
    onSuccess: (result) => {
      saveEmployeeToken(result.access_token);
      onLoggedIn(result.access_token);
    },
  });
  const forgot = useMutation({
    mutationFn: () => forgotEmployeeAccessKey(email),
  });
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-5">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="items-center text-center">
          <BrandLogo className="mb-3 h-20 w-20 rounded-2xl" />
          <CardTitle className="text-2xl">Khaliduo Employee Portal</CardTitle>
          <p className="text-sm text-muted-foreground">Kent Consultancy</p>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              login.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="employee-email">Work email</Label>
              <Input
                id="employee-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="employee-credential">
                {useLegacyKey ? "Legacy employee portal key" : "Password"}
              </Label>
              <Input
                id="employee-credential"
                type="password"
                autoCapitalize={useLegacyKey ? "characters" : "none"}
                autoComplete={useLegacyKey ? "off" : "current-password"}
                spellCheck={false}
                placeholder={useLegacyKey ? "KHW-XXXXXXXXXXXXXXXX" : undefined}
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                {useLegacyKey
                  ? "Use the old key starting with KHW-. The KH- enrollment code is only for linking the Windows app."
                  : "Use the password you chose when accepting your email invitation."}
              </p>
              {useLegacyKey && (
                <>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => email.includes("@") && forgot.mutate()}
                  >
                    {forgot.isPending ? "Sending..." : "Forgot access key? Email me a new one"}
                  </button>
                  {forgot.isSuccess && (
                    <p className="text-xs text-emerald-600">
                      If the account exists, a new key was emailed.
                    </p>
                  )}
                  {forgot.error && (
                    <p className="text-xs text-destructive">{forgot.error.message}</p>
                  )}
                </>
              )}
              <button
                type="button"
                className="block text-xs text-primary hover:underline"
                onClick={() => {
                  setUseLegacyKey((current) => !current);
                  setCredential("");
                }}
              >
                {useLegacyKey ? "Sign in with my password" : "Use a legacy portal key instead"}
              </button>
            </div>
            {login.error && <p className="text-sm text-destructive">{login.error.message}</p>}
            {initialError && <p className="text-sm text-destructive">{initialError}</p>}
            <Button className="w-full" type="submit" disabled={login.isPending}>
              {login.isPending ? "Signing in..." : "Open my dashboard"}
            </Button>
            <a className="block text-center text-sm text-primary hover:underline" href="/download">
              Download Khaliduo for Windows
            </a>
            <a className="block text-center text-sm text-primary hover:underline" href="/login">
              Admin sign in
            </a>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function EmployeeDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const [screenshotDay, setScreenshotDay] = useState(() => new Date().toISOString().slice(0, 10));
  const me = useQuery({
    queryKey: ["employee-portal", "me"],
    queryFn: () => employeeMe(token),
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["employee-portal", "summary"],
    queryFn: () => employeeSummary(token),
    refetchInterval: 60_000,
  });
  const tasks = useQuery({
    queryKey: ["employee-portal", "tasks"],
    queryFn: () => employeeTasks(token),
  });
  const projects = useQuery({
    queryKey: ["employee-portal", "projects"],
    queryFn: () => employeeProjects(token),
  });
  const screenshots = useQuery({
    queryKey: ["employee-portal", "screenshots", screenshotDay],
    queryFn: () => employeeScreenshots(token, screenshotDay),
  });
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") !== "screenshots") return;
    window.setTimeout(() => {
      document.getElementById("my-screenshots")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }, [screenshots.isSuccess]);
  const requests = useQuery({
    queryKey: ["employee-portal", "requests"],
    queryFn: () => employeeTimeRequests(token),
  });
  const leaveRequests = useQuery({
    queryKey: ["employee-portal", "leave-requests"],
    queryFn: () => employeeLeaveRequests(token),
  });
  const notifications = useQuery({
    queryKey: ["employee-portal", "notifications"],
    queryFn: () => employeeNotifications(token),
    refetchInterval: 30_000,
  });
  const [minutes, setMinutes] = useState(30);
  const [requestedDate, setRequestedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [taskName, setTaskName] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskProject, setTaskProject] = useState("");
  const [taskPriority, setTaskPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [taskStartDate, setTaskStartDate] = useState("");
  const [taskDeadline, setTaskDeadline] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (!me.data) return;
    setProfileName(me.data.name);
    setProfileAvatar(me.data.avatar_url ?? null);
  }, [me.data]);
  const profileMutation = useMutation({
    mutationFn: () => updateEmployeeProfile(token, { name: profileName, avatarUrl: profileAvatar }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-portal", "me"] }),
  });
  const [workspaceTaskId, setWorkspaceTaskId] = useState<string | null>(null);
  const taskWorkspace = useQuery({
    queryKey: ["employee-portal", "task-workspace", workspaceTaskId],
    queryFn: () => employeeTaskWorkspace(token, workspaceTaskId!),
    enabled: Boolean(workspaceTaskId),
  });
  const createTaskMutation = useMutation({
    mutationFn: () =>
      createEmployeeTask(token, {
        projectId: taskProject,
        name: taskName,
        description: taskDescription || undefined,
        stage: "assigned",
        startDate: taskStartDate || undefined,
        deadline: taskDeadline || undefined,
        priority: taskPriority,
      }),
    onSuccess: async () => {
      setTaskName("");
      setTaskDescription("");
      setTaskStartDate("");
      setTaskDeadline("");
      await queryClient.invalidateQueries({ queryKey: ["employee-portal", "tasks"] });
    },
  });
  const updateTaskMutation = useMutation({
    mutationFn: ({ id, stage, note }: { id: string; stage: string; note?: string }) =>
      updateEmployeeTask(token, id, { stage, note }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employee-portal", "tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["employee-portal", "notifications"] }),
      ]),
  });
  const checklistMutation = useMutation({
    mutationFn: async (input: {
      taskId: string;
      itemId?: string;
      title?: string;
      completed?: boolean;
    }) =>
      input.itemId
        ? updateEmployeeChecklistItem(token, input.taskId, input.itemId, {
            completed: input.completed,
          })
        : createEmployeeChecklistItem(token, input.taskId, input.title ?? ""),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-portal", "tasks"] }),
  });
  const taskCollaborationMutation = useMutation({
    mutationFn: async (input: { taskId: string; comment?: string; file?: File }) =>
      input.file
        ? uploadEmployeeTaskAttachment(token, input.taskId, input.file)
        : createEmployeeTaskComment(token, input.taskId, input.comment ?? ""),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["employee-portal", "task-workspace", workspaceTaskId],
      }),
  });
  const createRequest = useMutation({
    mutationFn: () =>
      createEmployeeTimeRequest(token, { requestedDate, requestedMinutes: minutes, reason }),
    onSuccess: async () => {
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employee-portal", "requests"] }),
        queryClient.invalidateQueries({ queryKey: ["employee-portal", "summary"] }),
      ]);
    },
  });
  const createLeave = useMutation({
    mutationFn: () => createEmployeeLeaveRequest(token, {
      startDate: leaveStart, endDate: leaveEnd, leaveType: "annual", reason: leaveReason || undefined,
    }),
    onSuccess: async () => {
      setLeaveStart(""); setLeaveEnd(""); setLeaveReason("");
      await queryClient.invalidateQueries({ queryKey: ["employee-portal", "leave-requests"] });
    },
  });

  if (me.isError) {
    clearEmployeeToken();
    return (
      <main className="p-8 text-center">
        <p>Your session expired.</p>
        <Button className="mt-4" onClick={onLogout}>
          Sign in again
        </Button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-12 w-12 rounded-xl" />
            <div>
              <strong>Khaliduo</strong>
              <p className="text-xs text-muted-foreground">Employee dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src={me.data?.avatar_url ?? undefined} />
              <AvatarFallback>{me.data?.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="hidden text-sm sm:block">{me.data?.name}</span>
            <Button variant="outline" size="sm" asChild>
              <a href="/download">
                <Download className="mr-2 h-4 w-4" /> Download app
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" /> Logout
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 p-5">
        <section>
          <h1 className="text-2xl font-semibold">Welcome, {me.data?.name ?? "employee"}</h1>
          <p className="text-sm text-muted-foreground">
            Your time, screenshots, tasks, manual requests and points.
          </p>
        </section>
        <Card>
          <CardHeader>
            <CardTitle>My profile</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <Avatar className="h-20 w-20">
              <AvatarImage src={profileAvatar ?? undefined} />
              <AvatarFallback>{profileName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="employee-profile-name">Name</Label>
              <Input
                id="employee-profile-name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </div>
            <Button type="button" variant="outline" asChild>
              <label className="cursor-pointer">
                <CameraIcon className="mr-2 h-4 w-4" />
                Photo
                <input
                  className="hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file || file.size > 1_500_000) return;
                    const reader = new FileReader();
                    reader.onload = () => setProfileAvatar(String(reader.result));
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            </Button>
            <Button
              onClick={() => profileMutation.mutate()}
              disabled={!profileName.trim() || profileMutation.isPending}
            >
              {profileMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-3">
          <PeriodCard title="Today" period={summary.data?.today} icon={Clock3} />
          <PeriodCard title="This week" period={summary.data?.week} icon={CalendarClock} />
          <PeriodCard title="This month" period={summary.data?.month} icon={Star} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Today's activity</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkdayTimeline timeline={summary.data?.todayTimeline} />
          </CardContent>
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Assigned tasks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                className="grid gap-2 rounded-md border bg-muted/30 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (taskName.trim() && taskProject) createTaskMutation.mutate();
                }}
              >
                <Input
                  value={taskName}
                  onChange={(event) => setTaskName(event.target.value)}
                  placeholder="What are you working on?"
                />
                <Textarea
                  value={taskDescription}
                  onChange={(event) => setTaskDescription(event.target.value)}
                  placeholder="Description and expected outcome"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={taskProject}
                    onChange={(event) => setTaskProject(event.target.value)}
                  >
                    <option value="">Choose project</option>
                    {(projects.data ?? []).map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={taskPriority}
                    onChange={(event) => setTaskPriority(event.target.value as typeof taskPriority)}
                  >
                    {(["low", "medium", "high", "urgent"] as const).map((priority) => (
                      <option key={priority} value={priority}>
                        {priority} priority
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <DatePicker
                    value={taskStartDate}
                    placeholder="Start date"
                    onChange={(value) => {
                      const startDate = value ?? "";
                      setTaskStartDate(startDate);
                      if (startDate && taskDeadline && taskDeadline < startDate) {
                        setTaskDeadline("");
                      }
                    }}
                  />
                  <DatePicker
                    value={taskDeadline}
                    minDate={taskStartDate}
                    placeholder="Deadline"
                    onChange={(value) => setTaskDeadline(value ?? "")}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!taskName.trim() || !taskProject || createTaskMutation.isPending}
                >
                  <Plus className="mr-2 h-4 w-4" /> Add my task
                </Button>
              </form>
              {(tasks.data ?? []).map((task) => (
                <div key={task.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <strong>{task.name}</strong>
                    <select
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                      value={task.stage}
                      disabled={
                        task.can_update_stage === false ||
                        [
                          "new_requests",
                          "ready_for_review",
                          "completed",
                          "rejected",
                          "cancelled",
                        ].includes(task.stage)
                      }
                      onChange={(event) => {
                        const stage = event.target.value;
                        const note =
                          stage === "blocked"
                            ? window.prompt("What is blocking this task?")?.trim()
                            : task.stage === "blocked" && stage === "in_progress"
                              ? window.prompt("How was the blocker resolved?")?.trim()
                              : stage === "ready_for_review"
                                ? window.prompt("Optional note for the reviewer")?.trim()
                                : undefined;
                        if ((stage === "blocked" || task.stage === "blocked") && !note) return;
                        updateTaskMutation.mutate({ id: task.id, stage, note });
                      }}
                    >
                      {Array.from(
                        new Set([
                          task.stage,
                          ...(task.stage === "backlog"
                            ? ["assigned", "in_progress", "blocked"]
                            : []),
                          ...(task.stage === "assigned" ? ["in_progress", "blocked"] : []),
                          ...(task.stage === "in_progress" ? ["ready_for_review", "blocked"] : []),
                          ...(task.stage === "blocked" ? ["in_progress"] : []),
                        ]),
                      ).map((stage) => (
                        <option key={stage} value={stage}>
                          {stage === "ready_for_review"
                            ? "Submit as finished"
                            : stage === "blocked"
                              ? "Report blocked"
                              : stage === "in_progress" && task.stage === "blocked"
                                ? "Resume to in progress"
                                : stage.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {task.team_name} / {task.project_name}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-800">
                      Worked {formatDuration(task.active_seconds ?? 0)}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-1">
                      {task.priority} priority
                    </span>
                    {task.stage === "new_requests" && (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">
                        Awaiting admin approval
                      </span>
                    )}
                    {task.stage === "ready_for_review" && (
                      <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-800">
                        Finished work submitted · waiting for approval
                      </span>
                    )}
                    {task.blocked_reason && (
                      <span className="rounded-full bg-red-100 px-2 py-1 text-red-700">
                        Blocked: {task.blocked_reason}
                      </span>
                    )}
                  </div>
                  {task.stage === "blocked" && (
                    <p className="mt-2 text-xs text-red-700">
                      Tracking is paused because an obstacle is blocking this task. Resume it to In
                      progress when the obstacle is cleared.
                    </p>
                  )}
                  {task.can_update_stage === false && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      You can collaborate on this task, but only its primary assignee can change the
                      status.
                    </p>
                  )}
                  <div className="mt-3 space-y-2 border-t pt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span>
                        Checklist: {(task.checklist ?? []).filter((item) => item.completed).length}/
                        {(task.checklist ?? []).length}
                      </span>
                      {!["completed", "rejected", "cancelled"].includes(task.stage) && (
                        <button
                          className="font-medium text-primary"
                          onClick={() => {
                            const title = window.prompt("Checklist item")?.trim();
                            if (title) checklistMutation.mutate({ taskId: task.id, title });
                          }}
                        >
                          + Add item
                        </button>
                      )}
                    </div>
                    {(task.checklist ?? []).map((item) => (
                      <label key={item.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          disabled={["completed", "rejected", "cancelled"].includes(task.stage)}
                          onChange={(event) =>
                            checklistMutation.mutate({
                              taskId: task.id,
                              itemId: item.id,
                              completed: event.target.checked,
                            })
                          }
                        />
                        <span
                          className={item.completed ? "text-muted-foreground line-through" : ""}
                        >
                          {item.title}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setWorkspaceTaskId(workspaceTaskId === task.id ? null : task.id)
                      }
                    >
                      <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Comments & files
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const comment = window.prompt("Write a comment")?.trim();
                        if (comment) taskCollaborationMutation.mutate({ taskId: task.id, comment });
                      }}
                    >
                      Add comment
                    </Button>
                    <label className="inline-flex h-9 cursor-pointer items-center rounded-md px-3 text-xs font-medium hover:bg-muted">
                      <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Attach file
                      <input
                        type="file"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) taskCollaborationMutation.mutate({ taskId: task.id, file });
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {workspaceTaskId === task.id && (
                    <div className="mt-3 grid gap-3 rounded-md bg-muted/30 p-3 sm:grid-cols-2">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                          Comments
                        </p>
                        <div className="space-y-2">
                          {(taskWorkspace.data?.comments ?? []).map((comment) => (
                            <div
                              key={comment.id}
                              className="rounded border bg-background p-2 text-sm"
                            >
                              <p>{comment.body}</p>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                {comment.author_name} ·{" "}
                                {new Date(comment.created_at).toLocaleString()}
                              </p>
                            </div>
                          ))}
                          {!taskWorkspace.data?.comments.length && (
                            <p className="text-xs text-muted-foreground">No comments yet.</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                          Files
                        </p>
                        <div className="space-y-2">
                          {(taskWorkspace.data?.attachments ?? []).map((attachment) => (
                            <div
                              key={attachment.id}
                              className="rounded border bg-background p-2 text-sm"
                            >
                              <Paperclip className="mr-1 inline h-3.5 w-3.5" />{" "}
                              {attachment.file_name}
                            </div>
                          ))}
                          {!taskWorkspace.data?.attachments.length && (
                            <p className="text-xs text-muted-foreground">No files yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {tasks.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">No active tasks assigned.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" /> Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(notifications.data ?? []).slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  className={`w-full rounded-md border p-3 text-left ${item.read_at ? "opacity-65" : "bg-primary/[0.03]"}`}
                  onClick={async () => {
                    if (!item.read_at) await readEmployeeNotification(token, item.id);
                    await queryClient.invalidateQueries({
                      queryKey: ["employee-portal", "notifications"],
                    });
                  }}
                >
                  <strong className="text-sm">{item.title}</strong>
                  <p className="text-xs text-muted-foreground">{item.message}</p>
                </button>
              ))}
              {!notifications.data?.length && (
                <p className="text-sm text-muted-foreground">No notifications yet.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Request manual time</CardTitle>
              <p className="text-sm text-muted-foreground">
                Send this while tracking or paused. Pending time is not counted until an admin
                approves it.
              </p>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  createRequest.mutate();
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={requestedDate}
                      onChange={(e) => setRequestedDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Minutes</Label>
                    <Input
                      type="number"
                      min={1}
                      max={720}
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div>
                  <Label>Reason</Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Offline meeting, client visit, workshop..."
                    required
                    minLength={3}
                  />
                </div>
                <Button disabled={createRequest.isPending}>
                  {createRequest.isPending ? "Sending..." : "Send for admin approval"}
                </Button>
                {createRequest.isSuccess && <p className="text-sm text-success">Request sent.</p>}
                {createRequest.error && (
                  <p className="text-sm text-destructive">{createRequest.error.message}</p>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Request holiday</CardTitle>
            <p className="text-sm text-muted-foreground">
              Annual credit: {leaveRequests.data?.balance.remaining_days ?? "-"} of {leaveRequests.data?.balance.credit_days ?? "-"} days remaining.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); createLeave.mutate(); }}>
              <div className="grid grid-cols-2 gap-3"><div><Label>From</Label><Input type="date" value={leaveStart} onChange={(event) => setLeaveStart(event.target.value)} required /></div><div><Label>To</Label><Input type="date" value={leaveEnd} onChange={(event) => setLeaveEnd(event.target.value)} required /></div></div>
              <div><Label>Reason (optional)</Label><Textarea value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} /></div>
              <Button disabled={createLeave.isPending}>{createLeave.isPending ? "Sending..." : "Request holiday"}</Button>
              {createLeave.error && <p className="text-sm text-destructive">{createLeave.error.message}</p>}
            </form>
            <div className="space-y-2">{(leaveRequests.data?.requests ?? []).map((request) => <div key={request.id} className="flex items-center justify-between rounded-lg border p-3"><div><strong>{request.requested_days} days</strong><p className="text-xs text-muted-foreground">{request.start_date} – {request.end_date}</p></div><StatusBadge status={request.status} /></div>)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Manual time requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(requests.data ?? []).map((request) => (
              <div
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0"
              >
                <div>
                  <strong>{request.requested_minutes} minutes</strong>
                  <p className="text-sm text-muted-foreground">
                    {request.requested_date} — {request.reason}
                  </p>
                </div>
                <StatusBadge status={request.status} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card id="my-screenshots">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle>My screenshots</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Only screenshots from the selected day are loaded.
                </p>
              </div>
              <div className="w-full sm:w-48">
                <Label htmlFor="employee-screenshot-day">Day</Label>
                <Input
                  id="employee-screenshot-day"
                  type="date"
                  value={screenshotDay}
                  onChange={(event) => setScreenshotDay(event.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(screenshots.data ?? []).map((shot) => (
                <figure key={shot.id} className="overflow-hidden rounded-lg border">
                  <img
                    src={shot.imageUrl}
                    alt="Work screenshot"
                    className="aspect-video w-full object-cover"
                  />
                  <figcaption className="p-2 text-xs text-muted-foreground">
                    {new Date(shot.captured_at).toLocaleString()}
                  </figcaption>
                </figure>
              ))}
            </div>
            {screenshots.isLoading && (
              <p className="text-sm text-muted-foreground">Loading screenshots for this day...</p>
            )}
            {screenshots.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">No screenshots for this day.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function PeriodCard({
  title,
  period,
  icon: Icon,
}: {
  title: string;
  period?: PortalPeriod;
  icon: typeof Clock3;
}) {
  const segments = [
    {
      label: "Worked",
      seconds: period?.tracked_active_seconds ?? 0,
      className: "bg-emerald-500",
      counted: true,
    },
    {
      label: "Idle",
      seconds: period?.idle_seconds ?? 0,
      className: "bg-slate-400",
      counted: false,
    },
    {
      label: "Manual approved",
      seconds: period?.manual_approved_seconds ?? 0,
      className: "bg-blue-500",
      counted: true,
    },
    {
      label: "Manual pending",
      seconds: period?.manual_pending_seconds ?? 0,
      className: "bg-amber-400",
      counted: false,
    },
    {
      label: "Manual rejected",
      seconds: period?.manual_rejected_seconds ?? 0,
      className: "bg-rose-500",
      counted: false,
    },
  ];
  const visibleTotal = Math.max(
    1,
    segments.reduce((total, item) => total + item.seconds, 0),
  );

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <strong className="text-2xl">{formatDuration(period?.active_seconds ?? 0)}</strong>
          </div>
          <Icon className="h-7 w-7 text-primary" />
        </div>
        <div className="mt-4 flex justify-between text-sm">
          <span>
            <Star className="mr-1 inline h-4 w-4" />
            {period?.points ?? 0} points
          </span>
          <span>
            <Camera className="mr-1 inline h-4 w-4" />
            {period?.screenshot_count ?? 0}
          </span>
          <span>
            <CheckCircle2 className="mr-1 inline h-4 w-4" />
            {formatDuration(period?.adjustment_seconds ?? 0)} manual
          </span>
        </div>
        <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted">
          {segments.map((segment) =>
            segment.seconds > 0 ? (
              <div
                key={segment.label}
                className={segment.className}
                style={{ width: `${(segment.seconds / visibleTotal) * 100}%` }}
                title={`${segment.label}: ${formatDuration(segment.seconds)}`}
              />
            ) : null,
          )}
        </div>
        <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
          {segments.map((segment) => (
            <div key={segment.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${segment.className}`} />
                {segment.label} {segment.counted ? "(counted)" : "(not counted)"}
              </span>
              <span className="font-mono">{formatDuration(segment.seconds)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
