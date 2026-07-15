import { apiFetch, apiFile, withQuery } from "./client";
import type { Project, Task } from "@/types";

type BackendProject = {
  id: string;
  team_id: string;
  name: string;
  description?: string | null;
  status: "active" | "archived" | "deleted";
  stage: string;
  created_at: string;
  updated_at: string;
};

type BackendTask = {
  id: string;
  project_id: string;
  project_name?: string;
  team_id?: string | null;
  team_name?: string;
  assignee_employee_id?: string | null;
  collaborator_employee_ids?: string[];
  position?: number;
  completed_at?: string | null;
  start_date?: string | null;
  deadline?: string | null;
  estimated_minutes?: number | null;
  labels?: string[];
  recurrence_rule?: string | null;
  priority?: "low" | "medium" | "high" | "urgent";
  created_by_employee_id?: string | null;
  blocked_reason?: string | null;
  blocked_at?: string | null;
  blocked_by_employee_id?: string | null;
  blocked_by_admin_user_id?: string | null;
  block_resolution_note?: string | null;
  review_note?: string | null;
  completion_note?: string | null;
  is_system_default?: boolean;
  reviewed_at?: string | null;
  checklist?: Array<{
    id: string;
    title: string;
    completed: boolean;
    position: number;
    assignee_employee_id?: string | null;
  }>;
  name: string;
  description?: string | null;
  status: "active" | "archived" | "deleted";
  stage: string;
  created_at: string;
  updated_at: string;
};

export type ProjectCreateInput = {
  teamId: string;
  name: string;
  description?: string;
  stage?: string;
};

export type TaskUpdateInput = {
  id: string;
  projectId?: string;
  name?: string;
  description?: string;
  status?: "active" | "archived";
  stage?: string;
  assigneeEmployeeId?: string | null;
  collaboratorEmployeeIds?: string[];
  position?: number;
  startDate?: string | null;
  deadline?: string | null;
  estimatedMinutes?: number | null;
  labels?: string[];
  recurrenceRule?: string | null;
  priority?: "low" | "medium" | "high" | "urgent";
  blockedReason?: string | null;
  blockResolutionNote?: string | null;
  reviewNote?: string | null;
  completionNote?: string | null;
};

export type TaskCreateInput = {
  projectId: string;
  name: string;
  description?: string;
  stage?: string;
  assigneeEmployeeId?: string;
  collaboratorEmployeeIds?: string[];
  startDate?: string;
  deadline?: string;
  estimatedMinutes?: number;
  labels?: string[];
  recurrenceRule?: string;
  priority?: "low" | "medium" | "high" | "urgent";
};

function mapProject(project: BackendProject): Project {
  return {
    id: project.id,
    teamId: project.team_id,
    name: project.name,
    description: project.description ?? "",
    status: project.status === "deleted" ? "archived" : project.status,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

function mapTask(task: BackendTask): Task {
  return {
    id: task.id,
    projectId: task.project_id,
    projectName: task.project_name ?? "",
    teamId: task.team_id ?? "",
    teamName: task.team_name ?? "",
    assigneeEmployeeId: task.assignee_employee_id ?? undefined,
    collaboratorEmployeeIds: task.collaborator_employee_ids ?? [],
    position: task.position ?? 0,
    completedAt: task.completed_at ?? undefined,
    startDate: task.start_date ?? undefined,
    deadline: task.deadline ?? undefined,
    estimatedMinutes: task.estimated_minutes ?? undefined,
    labels: task.labels ?? [],
    recurrenceRule: task.recurrence_rule ?? undefined,
    priority: task.priority ?? "medium",
    createdByEmployeeId: task.created_by_employee_id ?? undefined,
    blockedReason: task.blocked_reason ?? undefined,
    blockedAt: task.blocked_at ?? undefined,
    blockedByEmployeeId: task.blocked_by_employee_id ?? undefined,
    blockedByAdminUserId: task.blocked_by_admin_user_id ?? undefined,
    blockResolutionNote: task.block_resolution_note ?? undefined,
    reviewNote: task.review_note ?? undefined,
    completionNote: task.completion_note ?? undefined,
    reviewedAt: task.reviewed_at ?? undefined,
    isSystemDefault: task.is_system_default ?? false,
    checklist: (task.checklist ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      completed: item.completed,
      position: item.position,
      assigneeEmployeeId: item.assignee_employee_id ?? undefined,
    })),
    name: task.name,
    description: task.description ?? "",
    status: task.status === "deleted" ? "archived" : task.status,
    stage: task.stage || "new_requests",
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

export async function listProjects(scopedTeamIds?: string[]): Promise<Project[]> {
  const teamId = scopedTeamIds?.length === 1 ? scopedTeamIds[0] : undefined;
  const projects = await apiFetch<BackendProject[]>(
    withQuery("/projects", { page_size: 200, team_id: teamId }),
  );
  return projects
    .map(mapProject)
    .filter((project) => !scopedTeamIds?.length || scopedTeamIds.includes(project.teamId));
}

export async function createProject(input: ProjectCreateInput): Promise<Project> {
  const project = await apiFetch<BackendProject>("/projects", {
    method: "POST",
    body: JSON.stringify({
      team_id: input.teamId,
      name: input.name,
      description: input.description || null,
      status: "active",
    }),
  });
  return mapProject(project);
}

export async function getProject(id: string): Promise<Project> {
  return mapProject(await apiFetch<BackendProject>(`/projects/${id}`));
}

export async function updateProject(
  id: string,
  input: Partial<{
    teamId: string;
    name: string;
    description: string;
    status: "active" | "archived";
  }>,
): Promise<Project> {
  return mapProject(
    await apiFetch<BackendProject>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        team_id: input.teamId,
        name: input.name,
        description: input.description,
        status: input.status,
      }),
    }),
  );
}

export async function duplicateProject(id: string): Promise<Project> {
  return mapProject(
    await apiFetch<BackendProject>(`/projects/${id}/duplicate`, { method: "POST" }),
  );
}

export async function archiveProject(id: string): Promise<void> {
  await apiFetch(`/projects/${id}`, { method: "DELETE" });
}

export async function listTasks(options?: {
  scopedTeamIds?: string[];
  projectId?: string;
  teamId?: string;
}): Promise<Task[]> {
  const teamId =
    options?.teamId ??
    (options?.scopedTeamIds?.length === 1 ? options.scopedTeamIds[0] : undefined);
  const tasks = await apiFetch<BackendTask[]>(
    withQuery("/tasks", {
      page_size: 200,
      project_id: options?.projectId,
      team_id: teamId,
    }),
  );
  return tasks
    .map(mapTask)
    .filter(
      (task) =>
        !task.isSystemDefault &&
        (!options?.scopedTeamIds?.length || options.scopedTeamIds.includes(task.teamId)),
    );
}

export async function listTaskMetrics(
  teamId?: string,
): Promise<Array<{ taskId: string; activeMinutes: number; idleMinutes: number }>> {
  const rows = await apiFetch<
    Array<{ task_id: string; active_seconds: number; idle_seconds: number }>
  >(withQuery("/task-metrics", { team_id: teamId }));
  return rows.map((row) => ({
    taskId: row.task_id,
    activeMinutes: Math.round(row.active_seconds / 60),
    idleMinutes: Math.round(row.idle_seconds / 60),
  }));
}

export async function createTask(input: TaskCreateInput): Promise<Task> {
  const task = await apiFetch<BackendTask>("/tasks", {
    method: "POST",
    body: JSON.stringify({
      project_id: input.projectId,
      name: input.name,
      description: input.description || null,
      status: "active",
      stage: input.stage ?? "backlog",
      assignee_employee_id: input.assigneeEmployeeId,
      collaborator_employee_ids: input.collaboratorEmployeeIds ?? [],
      start_date: input.startDate,
      deadline: input.deadline,
      estimated_minutes: input.estimatedMinutes,
      labels: input.labels,
      recurrence_rule: input.recurrenceRule,
      priority: input.priority,
    }),
  });
  return mapTask(task);
}

export type TaskWorkspace = {
  comments: Array<{ id: string; body: string; authorName: string; createdAt: string }>;
  attachments: Array<{
    id: string;
    fileName: string;
    contentType?: string;
    sizeBytes: number;
    createdAt: string;
  }>;
  dependencies: Array<{ id: string; taskId: string; name: string; stage: string }>;
  workLogs: Array<{
    employeeId: string;
    employeeName: string;
    activeSeconds: number;
    idleSeconds: number;
    startedAt?: string;
    endedAt?: string;
  }>;
  history: Array<{
    id: string;
    action: string;
    actorName: string;
    details: Record<string, unknown>;
    createdAt: string;
  }>;
};

export async function getTaskWorkspace(taskId: string): Promise<TaskWorkspace> {
  const data = await apiFetch<{
    comments: Array<{ id: string; body: string; author_name: string; created_at: string }>;
    attachments: Array<{
      id: string;
      file_name: string;
      content_type?: string;
      size_bytes: number;
      created_at: string;
    }>;
    dependencies: Array<{ id: string; task_id: string; name: string; stage: string }>;
    work_logs: Array<{
      employee_id: string;
      employee_name: string;
      active_seconds: number;
      idle_seconds: number;
      started_at?: string;
      ended_at?: string;
    }>;
    history: Array<{
      id: string;
      action: string;
      actor_name: string;
      details: Record<string, unknown>;
      created_at: string;
    }>;
  }>(`/tasks/${taskId}/workspace`);
  return {
    comments: data.comments.map((item) => ({
      id: item.id,
      body: item.body,
      authorName: item.author_name,
      createdAt: item.created_at,
    })),
    attachments: data.attachments.map((item) => ({
      id: item.id,
      fileName: item.file_name,
      contentType: item.content_type,
      sizeBytes: item.size_bytes,
      createdAt: item.created_at,
    })),
    dependencies: data.dependencies.map((item) => ({
      id: item.id,
      taskId: item.task_id,
      name: item.name,
      stage: item.stage,
    })),
    workLogs: data.work_logs.map((item) => ({
      employeeId: item.employee_id,
      employeeName: item.employee_name,
      activeSeconds: item.active_seconds,
      idleSeconds: item.idle_seconds,
      startedAt: item.started_at,
      endedAt: item.ended_at,
    })),
    history: data.history.map((item) => ({
      id: item.id,
      action: item.action,
      actorName: item.actor_name,
      details: item.details,
      createdAt: item.created_at,
    })),
  };
}

export async function createTaskComment(taskId: string, body: string) {
  await apiFetch(`/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
}

export async function addTaskDependency(taskId: string, dependsOnTaskId: string) {
  await apiFetch(`/tasks/${taskId}/dependencies`, {
    method: "POST",
    body: JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
  });
}

export async function removeTaskDependency(taskId: string, dependencyId: string) {
  await apiFetch(`/tasks/${taskId}/dependencies/${dependencyId}`, { method: "DELETE" });
}

export async function uploadTaskAttachment(taskId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  await apiFetch(`/tasks/${taskId}/attachments`, { method: "POST", body });
}

export async function downloadTaskAttachment(taskId: string, attachmentId: string) {
  return apiFile(`/tasks/${taskId}/attachments/${attachmentId}/file`);
}

export async function updateTask(input: TaskUpdateInput): Promise<Task> {
  const task = await apiFetch<BackendTask>(`/tasks/${input.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      project_id: input.projectId,
      name: input.name,
      description: input.description,
      status: input.status,
      stage: input.stage,
      assignee_employee_id: input.assigneeEmployeeId,
      collaborator_employee_ids: input.collaboratorEmployeeIds,
      position: input.position,
      start_date: input.startDate,
      deadline: input.deadline,
      estimated_minutes: input.estimatedMinutes,
      labels: input.labels,
      recurrence_rule: input.recurrenceRule,
      priority: input.priority,
      blocked_reason: input.blockedReason,
      block_resolution_note: input.blockResolutionNote,
      review_note: input.reviewNote,
      completion_note: input.completionNote,
    }),
  });
  return mapTask(task);
}

export async function createChecklistItem(
  taskId: string,
  title: string,
  assigneeEmployeeId?: string,
): Promise<Task> {
  return mapTask(
    await apiFetch<BackendTask>(`/tasks/${taskId}/checklist`, {
      method: "POST",
      body: JSON.stringify({ title, assignee_employee_id: assigneeEmployeeId }),
    }),
  );
}

export async function updateChecklistItem(input: {
  taskId: string;
  itemId: string;
  title?: string;
  completed?: boolean;
  position?: number;
  assigneeEmployeeId?: string | null;
}): Promise<Task> {
  return mapTask(
    await apiFetch<BackendTask>(`/tasks/${input.taskId}/checklist/${input.itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: input.title,
        completed: input.completed,
        position: input.position,
        assignee_employee_id: input.assigneeEmployeeId,
      }),
    }),
  );
}

export async function deleteChecklistItem(taskId: string, itemId: string): Promise<void> {
  await apiFetch(`/tasks/${taskId}/checklist/${itemId}`, { method: "DELETE" });
}

export async function archiveTask(id: string): Promise<void> {
  await apiFetch(`/tasks/${id}`, { method: "DELETE" });
}

export async function approveTaskRequest(
  taskId: string,
  targetStage: "backlog" | "assigned" = "assigned",
): Promise<Task> {
  return mapTask(
    await apiFetch<BackendTask>(`/tasks/${taskId}/approve-request`, {
      method: "POST",
      body: JSON.stringify({ target_stage: targetStage }),
    }),
  );
}

export async function rejectTaskRequest(taskId: string, note: string): Promise<Task> {
  return mapTask(
    await apiFetch<BackendTask>(`/tasks/${taskId}/reject-request`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  );
}

export async function approveTaskReview(taskId: string, note?: string): Promise<Task> {
  return mapTask(
    await apiFetch<BackendTask>(`/tasks/${taskId}/approve-review`, {
      method: "POST",
      body: JSON.stringify({ note: note || null }),
    }),
  );
}

export type TaskReviewReturnStage = "backlog" | "assigned" | "in_progress" | "blocked";

export async function returnTaskReview(
  taskId: string,
  targetStage: TaskReviewReturnStage,
  note: string,
): Promise<Task> {
  return mapTask(
    await apiFetch<BackendTask>(`/tasks/${taskId}/return-review`, {
      method: "POST",
      body: JSON.stringify({ target_stage: targetStage, note }),
    }),
  );
}

export type TaskWorkflowRequest = {
  id: string;
  taskId: string;
  requestType: "task_creation" | "completion";
  fromStage: string;
  requestedStage: string;
  status: "pending" | "approved" | "rejected";
  requestNote?: string;
  decisionNote?: string;
  returnStage?: string;
  requestedByEmployeeId: string;
  reviewedByAdminUserId?: string;
  reviewedAt?: string;
  createdAt: string;
};

export type TaskNotification = {
  id: string;
  taskId?: string;
  workflowRequestId?: string;
  workflowRequest?: TaskWorkflowRequest;
  type: string;
  title: string;
  message: string;
  readAt?: string;
  createdAt: string;
};

export async function listTaskNotifications(): Promise<TaskNotification[]> {
  const rows = await apiFetch<
    Array<{
      id: string;
      task_id?: string | null;
      workflow_request_id?: string | null;
      workflow_request?: {
        id: string;
        task_id: string;
        request_type: "task_creation" | "completion";
        from_stage: string;
        requested_stage: string;
        status: "pending" | "approved" | "rejected";
        request_note?: string | null;
        decision_note?: string | null;
        return_stage?: string | null;
        requested_by_employee_id: string;
        reviewed_by_admin_user_id?: string | null;
        reviewed_at?: string | null;
        created_at: string;
      } | null;
      type: string;
      title: string;
      message: string;
      read_at?: string | null;
      created_at: string;
    }>
  >("/notifications");
  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id ?? undefined,
    workflowRequestId: row.workflow_request_id ?? undefined,
    workflowRequest: row.workflow_request
      ? {
          id: row.workflow_request.id,
          taskId: row.workflow_request.task_id,
          requestType: row.workflow_request.request_type,
          fromStage: row.workflow_request.from_stage,
          requestedStage: row.workflow_request.requested_stage,
          status: row.workflow_request.status,
          requestNote: row.workflow_request.request_note ?? undefined,
          decisionNote: row.workflow_request.decision_note ?? undefined,
          returnStage: row.workflow_request.return_stage ?? undefined,
          requestedByEmployeeId: row.workflow_request.requested_by_employee_id,
          reviewedByAdminUserId: row.workflow_request.reviewed_by_admin_user_id ?? undefined,
          reviewedAt: row.workflow_request.reviewed_at ?? undefined,
          createdAt: row.workflow_request.created_at,
        }
      : undefined,
    type: row.type,
    title: row.title,
    message: row.message,
    readAt: row.read_at ?? undefined,
    createdAt: row.created_at,
  }));
}

export async function readTaskNotification(id: string): Promise<void> {
  await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
}

export async function readAllTaskNotifications(): Promise<void> {
  await apiFetch("/notifications/read-all", { method: "POST" });
}
