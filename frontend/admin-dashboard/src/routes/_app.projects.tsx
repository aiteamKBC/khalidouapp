import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  CalendarDays,
  Check,
  CheckSquare,
  Columns3,
  ChevronsUpDown,
  Copy,
  FolderKanban,
  GripVertical,
  List,
  ListTodo,
  Download,
  FileText,
  History,
  Link2,
  MessageSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNotePrompt } from "@/components/note-prompt-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { DatePicker } from "@/components/ui/date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  createProject,
  createTask,
  createChecklistItem,
  deleteChecklistItem,
  archiveProject,
  archiveTask,
  listProjects,
  listTasks,
  listTaskMetrics,
  updateTask,
  updateChecklistItem,
  addTaskDependency,
  createTaskComment,
  downloadTaskAttachment,
  getTaskWorkspace,
  removeTaskDependency,
  uploadTaskAttachment,
  duplicateProject,
  updateProject,
  approveTaskRequest,
  rejectTaskRequest,
  approveTaskReview,
  returnTaskReview,
  type TaskReviewReturnStage,
} from "@/api/projects";
import { listTeams } from "@/api/teams";
import { listEmployees } from "@/api/employees";
import { useAuth } from "@/lib/auth";
import type { Task } from "@/types";
import { toast } from "sonner";
import { formatMinutes } from "@/lib/format";

export const Route = createFileRoute("/_app/projects")({
  validateSearch: (search: Record<string, unknown>): { taskId?: string } =>
    typeof search.taskId === "string" && search.taskId ? { taskId: search.taskId } : {},
  component: ProjectsPage,
});

const TASK_STAGES = [
  { value: "new_requests", label: "New requests" },
  { value: "backlog", label: "Backlog" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In progress" },
  { value: "ready_for_review", label: "Ready for review" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const DEFAULT_STAGE = "backlog";

function stageLabel(stage: string) {
  return TASK_STAGES.find((item) => item.value === stage)?.label ?? stage;
}

function ProjectsPage() {
  const { prompt, dialog: notePromptDialog } = useNotePrompt();
  const { scopedTeamIds, user } = useAuth();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const scope = scopedTeamIds();
  const queryClient = useQueryClient();
  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });
  const projects = useQuery({
    queryKey: ["projects", scope],
    queryFn: () => listProjects(scope),
  });
  const tasks = useQuery({
    queryKey: ["tasks", scope],
    queryFn: () => listTasks({ scopedTeamIds: scope }),
  });
  const taskMetrics = useQuery({ queryKey: ["task-metrics"], queryFn: () => listTaskMetrics() });
  const employees = useQuery({
    queryKey: ["employees", scope],
    queryFn: () => listEmployees(scope),
  });

  const [q, setQ] = useState("");
  const [teamId, setTeamId] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const [assigneeId, setAssigneeId] = useState("all");
  const [view, setView] = useState<"projects" | "kanban" | "list" | "timeline" | "employee">(
    "projects",
  );
  const [projectStatus, setProjectStatus] = useState<"active" | "archived">("active");
  const [projectOpen, setProjectOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [newProjectTeamId, setNewProjectTeamId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskStage, setNewTaskStage] = useState<string>(DEFAULT_STAGE);
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState("");
  const [newTaskStartDate, setNewTaskStartDate] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<(typeof PRIORITIES)[number]>("medium");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [reviewReturnStage, setReviewReturnStage] = useState<TaskReviewReturnStage>("in_progress");
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    if (search.taskId) setSelectedTaskId(search.taskId);
  }, [search.taskId]);

  useEffect(() => {
    setReviewReturnStage("in_progress");
  }, [selectedTaskId]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    ]);
  };

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      toast.success("Project created");
      setProjectOpen(false);
      setNewProjectTeamId("");
      setNewProjectName("");
      setNewProjectDescription("");
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to create project"),
  });

  const createTaskMutation = useMutation({
    mutationFn: createTask,
    onSuccess: async () => {
      toast.success("Task created");
      setTaskOpen(false);
      setNewTaskProjectId("");
      setNewTaskName("");
      setNewTaskDescription("");
      setNewTaskStage(DEFAULT_STAGE);
      setNewTaskAssigneeId("");
      setNewTaskStartDate("");
      setNewTaskDeadline("");
      setNewTaskPriority("medium");
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to create task"),
  });

  const moveTaskMutation = useMutation({
    mutationFn: updateTask,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["tasks", scope] });
      const previous = queryClient.getQueryData<Task[]>(["tasks", scope]) ?? [];
      queryClient.setQueryData<Task[]>(["tasks", scope], (current = []) =>
        current.map((task) =>
          task.id === input.id
            ? {
                ...task,
                stage: input.stage ?? task.stage,
                position: input.position ?? task.position,
                name: input.name ?? task.name,
                description: input.description ?? task.description,
                startDate:
                  input.startDate === undefined ? task.startDate : (input.startDate ?? undefined),
                deadline:
                  input.deadline === undefined ? task.deadline : (input.deadline ?? undefined),
                assigneeEmployeeId:
                  input.assigneeEmployeeId === undefined
                    ? task.assigneeEmployeeId
                    : (input.assigneeEmployeeId ?? undefined),
                collaboratorEmployeeIds:
                  input.collaboratorEmployeeIds ?? task.collaboratorEmployeeIds,
                labels: input.labels ?? task.labels,
                recurrenceRule:
                  input.recurrenceRule === undefined
                    ? task.recurrenceRule
                    : (input.recurrenceRule ?? undefined),
                priority: input.priority ?? task.priority,
              }
            : task,
        ),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(["tasks", scope], context.previous);
      toast.error(error instanceof Error ? error.message : "Failed to move task");
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<Task[]>(["tasks", scope], (current = []) =>
        current.map((task) => (task.id === saved.id ? saved : task)),
      );
      void queryClient.invalidateQueries({ queryKey: ["task-workspace", saved.id] });
    },
  });
  const checklistMutation = useMutation({
    mutationFn: ({ taskId, title }: { taskId: string; title: string }) =>
      createChecklistItem(taskId, title),
    onSuccess: async () => {
      setNewChecklistTitle("");
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Checklist update failed"),
  });
  const checklistUpdateMutation = useMutation({
    mutationFn: updateChecklistItem,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["tasks", scope] });
      const previous = queryClient.getQueryData<Task[]>(["tasks", scope]) ?? [];
      queryClient.setQueryData<Task[]>(["tasks", scope], (current = []) =>
        current.map((task) =>
          task.id !== input.taskId
            ? task
            : {
                ...task,
                checklist: task.checklist
                  .map((item) =>
                    item.id === input.itemId
                      ? {
                          ...item,
                          ...(input.title !== undefined ? { title: input.title } : {}),
                          ...(input.completed !== undefined ? { completed: input.completed } : {}),
                          ...(input.position !== undefined ? { position: input.position } : {}),
                        }
                      : item,
                  )
                  .sort((a, b) => a.position - b.position),
              },
        ),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(["tasks", scope], context.previous);
      toast.error(error instanceof Error ? error.message : "Checklist update failed");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tasks", scope] }),
  });
  const checklistDeleteMutation = useMutation({
    mutationFn: ({ taskId, itemId }: { taskId: string; itemId: string }) =>
      deleteChecklistItem(taskId, itemId),
    onSuccess: invalidate,
  });

  const archiveProjectMutation = useMutation({
    mutationFn: archiveProject,
    onSuccess: invalidate,
  });
  const restoreProjectMutation = useMutation({
    mutationFn: (id: string) => updateProject(id, { status: "active" }),
    onSuccess: invalidate,
  });
  const duplicateProjectMutation = useMutation({
    mutationFn: duplicateProject,
    onSuccess: async () => {
      toast.success("Project duplicated with its tasks");
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Duplicate failed"),
  });

  const archiveTaskMutation = useMutation({
    mutationFn: archiveTask,
    onSuccess: invalidate,
  });
  const workflowMutation = useMutation({
    mutationFn: async (input: {
      action: "approve-request" | "reject-request" | "approve-review" | "return-review";
      taskId: string;
      note?: string;
      targetStage?: TaskReviewReturnStage;
    }) => {
      if (input.action === "approve-request") return approveTaskRequest(input.taskId, "assigned");
      if (input.action === "reject-request")
        return rejectTaskRequest(input.taskId, input.note ?? "");
      if (input.action === "approve-review") return approveTaskReview(input.taskId, input.note);
      return returnTaskReview(input.taskId, input.targetStage ?? "in_progress", input.note ?? "");
    },
    onSuccess: async (task) => {
      queryClient.setQueryData<Task[]>(["tasks", scope], (current = []) =>
        current.map((item) => (item.id === task.id ? task : item)),
      );
      toast.success("Task workflow updated");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["task-workspace", task.id] }),
        queryClient.invalidateQueries({ queryKey: ["task-notifications"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Workflow update failed"),
  });

  const activeProjects = useMemo(
    () => (projects.data ?? []).filter((project) => project.status === "active"),
    [projects.data],
  );

  const filteredProjects = useMemo(
    () =>
      activeProjects.filter((project) => {
        const team = (teams.data ?? []).find((item) => item.id === project.teamId);
        if (teamId !== "all" && project.teamId !== teamId) return false;
        if (q && !`${team?.name ?? ""} ${project.name}`.toLowerCase().includes(q.toLowerCase()))
          return false;
        return true;
      }),
    [activeProjects, q, teamId, teams.data],
  );

  const filteredTasks = useMemo(
    () =>
      (tasks.data ?? []).filter((task) => {
        if (teamId !== "all" && task.teamId !== teamId) return false;
        if (projectId !== "all" && task.projectId !== projectId) return false;
        if (assigneeId === "unassigned" && task.assigneeEmployeeId) return false;
        if (
          assigneeId !== "all" &&
          assigneeId !== "unassigned" &&
          task.assigneeEmployeeId !== assigneeId &&
          !task.collaboratorEmployeeIds.includes(assigneeId)
        )
          return false;
        if (
          q &&
          !`${task.teamName} ${task.projectName} ${task.name}`
            .toLowerCase()
            .includes(q.toLowerCase())
        )
          return false;
        return true;
      }),
    [tasks.data, q, teamId, projectId, assigneeId],
  );

  function openTaskDialog(stage: string = DEFAULT_STAGE) {
    setNewTaskStage(stage);
    setNewTaskProjectId(projectId !== "all" ? projectId : "");
    setTaskOpen(true);
  }

  function submitProject(event: FormEvent) {
    event.preventDefault();
    createProjectMutation.mutate({
      teamId: newProjectTeamId,
      name: newProjectName,
      description: newProjectDescription,
    });
  }

  function submitTask(event: FormEvent) {
    event.preventDefault();
    if (
      user?.role === "team_owner" &&
      Boolean(user.employeeId && newTaskAssigneeId === user.employeeId) &&
      ["completed", "rejected", "cancelled"].includes(newTaskStage)
    ) {
      toast.error("A General admin or another team manager must close your task.");
      return;
    }
    createTaskMutation.mutate({
      projectId: newTaskProjectId,
      name: newTaskName,
      description: newTaskDescription,
      stage: newTaskStage,
      assigneeEmployeeId: newTaskAssigneeId || undefined,
      startDate: newTaskStartDate || undefined,
      deadline: newTaskDeadline || undefined,
      priority: newTaskPriority,
    });
  }

  function isTeamManagerOwnTask(task: Task) {
    return (
      user?.role === "team_owner" &&
      Boolean(user.employeeId && task.assigneeEmployeeId === user.employeeId)
    );
  }

  function availableStages(task: Task) {
    if (["new_requests", "ready_for_review"].includes(task.stage)) {
      return TASK_STAGES.filter((stage) => stage.value === task.stage);
    }
    const workflowStages = TASK_STAGES.filter((stage) => stage.value !== "new_requests");
    if (isTeamManagerOwnTask(task)) {
      return workflowStages.filter(
        (stage) =>
          stage.value === task.stage ||
          !["completed", "rejected", "cancelled"].includes(stage.value),
      );
    }
    return workflowStages;
  }

  async function moveTask(task: Task, stage: string) {
    if (task.stage === stage) return;
    if (["new_requests", "ready_for_review"].includes(task.stage)) {
      toast.info("Use the review actions to approve or return this task.");
      return;
    }
    if (stage === "new_requests") {
      toast.info("New requests is reserved for tasks submitted by employees.");
      return;
    }
    if (isTeamManagerOwnTask(task) && ["completed", "rejected", "cancelled"].includes(stage)) {
      toast.error("A General admin or another team manager must review your task.");
      return;
    }
    const notes = await stageChangeNotes(task, stage);
    if (notes === null) return;
    moveTaskMutation.mutate({ id: task.id, stage, ...notes });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragTaskId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    setDragOverStage((event.over?.data.current?.stage as string | undefined) ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const source = kanbanTasks.find((task) => task.id === String(event.active.id));
    const targetId = event.over ? String(event.over.id) : null;
    const targetTask = targetId ? kanbanTasks.find((task) => task.id === targetId) : null;
    const targetStage =
      (event.over?.data.current?.stage as string | undefined) ?? targetTask?.stage;
    setActiveDragTaskId(null);
    setDragOverStage(null);
    if (!source || !targetStage) return;
    if (["new_requests", "ready_for_review"].includes(source.stage)) {
      toast.info("Use the review actions to approve or return this task.");
      return;
    }
    if (targetStage === "new_requests") {
      toast.info("New requests is reserved for tasks submitted by employees.");
      return;
    }
    if (
      isTeamManagerOwnTask(source) &&
      ["completed", "rejected", "cancelled"].includes(targetStage)
    ) {
      toast.error("A General admin or another team manager must review your task.");
      return;
    }
    const targetPosition = targetTask
      ? targetTask.position
      : kanbanTasks.filter((task) => task.stage === targetStage).length;
    if (source.stage === targetStage && source.position === targetPosition) return;
    const notes = await stageChangeNotes(source, targetStage);
    if (notes === null) return;
    moveTaskMutation.mutate({
      id: source.id,
      stage: targetStage,
      position: targetPosition,
      ...notes,
    });
    if (targetTask && targetTask.id !== source.id) {
      moveTaskMutation.mutate({ id: targetTask.id, position: source.position });
    }
  }

  async function stageChangeNotes(task: Task, stage: string) {
    if (stage === "blocked") {
      const blockedReason = await prompt({
        title: "Block task",
        description: "What is blocking this task?",
      });
      return blockedReason ? { blockedReason } : null;
    }
    if (task.stage === "blocked" && stage !== "blocked") {
      const blockResolutionNote = await prompt({
        title: "Resolve blocker",
        description: "How was the blocker resolved?",
      });
      return blockResolutionNote ? { blockResolutionNote } : null;
    }
    if (stage === "completed" && task.checklist.some((item) => !item.completed)) {
      const completionNote = await prompt({
        title: "Complete task",
        description: "The checklist is incomplete. Add a completion reason, or cancel the move.",
      });
      return completionNote ? { completionNote } : null;
    }
    return {};
  }

  const projectRows = (projects.data ?? []).filter((project) => {
    if (project.status !== projectStatus) return false;
    if (teamId !== "all" && project.teamId !== teamId) return false;
    const teamName = (teams.data ?? []).find((team) => team.id === project.teamId)?.name ?? "";
    if (
      q &&
      !`${project.name} ${project.description ?? ""} ${teamName}`
        .toLowerCase()
        .includes(q.toLowerCase())
    )
      return false;
    return true;
  });
  const kanbanTasks = filteredTasks.filter((task) => task.status === "active");
  const selectedTaskProject = activeProjects.find((project) => project.id === newTaskProjectId);
  const assigneeCandidates = (employees.data ?? []).filter(
    (employee) => selectedTaskProject && employee.teamIds.includes(selectedTaskProject.teamId),
  );
  const showSetup = !projects.isLoading && (projects.data ?? []).length === 0;
  const selectedTask = (tasks.data ?? []).find((task) => task.id === selectedTaskId) ?? null;

  return (
    <div className="studio-page">
      <PageHeader
        title={view === "projects" ? "Projects" : "Tasks"}
        description={
          view === "projects"
            ? "Review project health, members, progress and tracked time."
            : "Manage project work and connect employee tracking to team, project, and task context."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setProjectOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New project
            </Button>
            <Button onClick={() => openTaskDialog()}>
              <ListTodo className="h-4 w-4 mr-2" />
              Assign work
            </Button>
          </div>
        }
      />

      {view !== "projects" && (
        <Card className="mb-4 grid gap-px overflow-hidden bg-border sm:grid-cols-3">
          <div className="bg-card p-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              1 · Admin assigns
            </p>
            <p className="mt-1 text-sm font-medium">Use Assign work</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose the project, employee, stage, and task details.
            </p>
          </div>
          <div className="bg-card p-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              2 · Employee works
            </p>
            <p className="mt-1 text-sm font-medium">Task appears in the desktop app</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The employee selects it and tracked time is linked to its Team and Project.
            </p>
          </div>
          <div className="bg-card p-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              3 · Employee can suggest
            </p>
            <p className="mt-1 text-sm font-medium">Creates their own task</p>
            <p className="mt-1 text-xs text-muted-foreground">
              It is assigned to them and enters New Requests for admin review.
            </p>
          </div>
        </Card>
      )}

      {showSetup ? (
        <EmptyState
          icon={FolderKanban}
          title="Set up work tracking"
          description="Create your first project. Then assign a team member and task so tracked time always has context."
          action={
            <Button onClick={() => setProjectOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create first project
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-4 grid gap-3 xl:grid-cols-[1fr_auto]">
            <Card className="p-4">
              <div
                className={`grid gap-3 ${view === "projects" ? "lg:grid-cols-[1fr_220px]" : "lg:grid-cols-[1fr_190px_220px_220px]"}`}
              >
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={
                      view === "projects"
                        ? "Search projects..."
                        : "Search project, task, or team..."
                    }
                    value={q}
                    onChange={(event) => setQ(event.target.value)}
                    className="pl-8"
                  />
                </div>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All teams</SelectItem>
                    {(teams.data ?? []).map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {view !== "projects" && (
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All projects</SelectItem>
                      {filteredProjects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {view !== "projects" && (
                  <Select value={assigneeId} onValueChange={setAssigneeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Assignee" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All assignees</SelectItem>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {(employees.data ?? []).map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </Card>

            <Card className="flex items-center gap-1 p-1">
              <Button
                variant={view === "projects" ? "default" : "ghost"}
                size="sm"
                onClick={() => setView("projects")}
              >
                <FolderKanban className="mr-2 h-4 w-4" /> Projects
              </Button>
              <Button
                variant={view === "kanban" ? "default" : "ghost"}
                size="sm"
                onClick={() => setView("kanban")}
              >
                <Columns3 className="h-4 w-4 mr-2" />
                Kanban
              </Button>
              <Button
                variant={view === "timeline" ? "default" : "ghost"}
                size="sm"
                onClick={() => setView("timeline")}
              >
                <CalendarDays className="mr-2 h-4 w-4" /> Timeline
              </Button>
              <Button
                variant={view === "employee" ? "default" : "ghost"}
                size="sm"
                onClick={() => setView("employee")}
              >
                <Users className="h-4 w-4 mr-2" /> By employee
              </Button>
              <Button
                variant={view === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setView("list")}
              >
                <List className="h-4 w-4 mr-2" />
                List
              </Button>
            </Card>
          </div>

          {view === "projects" ? null : view === "kanban" ? (
            <DndContext
              sensors={dragSensors}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={() => {
                setActiveDragTaskId(null);
                setDragOverStage(null);
              }}
            >
              <div className="overflow-x-auto pb-3">
                <div
                  className="grid gap-3"
                  style={{
                    minWidth: `${TASK_STAGES.length * 280}px`,
                    gridTemplateColumns: `repeat(${TASK_STAGES.length}, minmax(268px, 1fr))`,
                  }}
                >
                  {TASK_STAGES.map((stage) => {
                    const stageTasks = kanbanTasks.filter((task) => task.stage === stage.value);
                    return (
                      <KanbanColumn
                        key={stage.value}
                        stage={stage.value}
                        className={`rounded-md border bg-muted/35 transition ${dragOverStage === stage.value ? "border-primary bg-primary/5 ring-2 ring-primary/20" : ""}`}
                        aria-label={stage.label}
                      >
                        <div className="flex h-11 items-center justify-between border-b bg-primary px-3 text-primary-foreground">
                          <div>
                            <h2 className="text-xs font-semibold uppercase">{stage.label}</h2>
                            <p className="text-[11px] opacity-80">{stageTasks.length} tasks</p>
                          </div>
                          {stage.value !== "new_requests" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                              onClick={() => openTaskDialog(stage.value)}
                              aria-label={`Add task to ${stage.label}`}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        <SortableContext
                          items={stageTasks.map((task) => task.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-2 p-2">
                            {stage.value === "completed" ? (
                              <CompletedArchive tasks={stageTasks} onOpen={setSelectedTaskId} />
                            ) : (
                              stageTasks.map((task) => (
                                <SortableTaskShell
                                  key={task.id}
                                  task={task}
                                  dragDisabled={["new_requests", "ready_for_review"].includes(
                                    task.stage,
                                  )}
                                  onClick={() => setSelectedTaskId(task.id)}
                                  className="cursor-pointer rounded-md border bg-background p-3 shadow-sm transition hover:border-primary/30 hover:shadow-md"
                                >
                                  <div className="mb-2 flex items-start justify-between gap-2">
                                    <div>
                                      <h3 className="text-sm font-medium leading-5">{task.name}</h3>
                                      <span
                                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                          task.priority === "urgent"
                                            ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                            : task.priority === "high"
                                              ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                                              : task.priority === "low"
                                                ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                                : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                                        }`}
                                      >
                                        {task.priority}
                                      </span>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {task.teamName} / {task.projectName}
                                      </p>
                                      <p className="mt-1 text-xs font-medium text-primary">
                                        {task.assigneeEmployeeId
                                          ? ((employees.data ?? []).find(
                                              (employee) => employee.id === task.assigneeEmployeeId,
                                            )?.name ?? "Assigned")
                                          : "Available to team"}
                                      </p>
                                    </div>
                                    {!isTeamManagerOwnTask(task) && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 shrink-0"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          archiveTaskMutation.mutate(task.id);
                                        }}
                                        aria-label={`Archive ${task.name}`}
                                      >
                                        <Archive className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                  {task.description && (
                                    <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
                                      {task.description}
                                    </p>
                                  )}
                                  {taskTimingLabel(task) && (
                                    <p
                                      className={`mb-2 text-xs font-medium ${taskTimingLabel(task)?.tone}`}
                                    >
                                      {taskTimingLabel(task)?.label}
                                    </p>
                                  )}
                                  <div className="mb-3 flex items-center justify-between gap-2">
                                    <div className="flex -space-x-1.5">
                                      {[task.assigneeEmployeeId, ...task.collaboratorEmployeeIds]
                                        .filter(Boolean)
                                        .slice(0, 4)
                                        .map((employeeId) => {
                                          const employee = (employees.data ?? []).find(
                                            (item) => item.id === employeeId,
                                          );
                                          return (
                                            <Avatar
                                              key={employeeId}
                                              className="h-6 w-6 border-2 border-background"
                                            >
                                              <AvatarFallback className="text-[9px]">
                                                {employee?.name
                                                  .split(" ")
                                                  .map((part) => part[0])
                                                  .slice(0, 2)
                                                  .join("") ?? "?"}
                                              </AvatarFallback>
                                            </Avatar>
                                          );
                                        })}
                                    </div>
                                    {task.labels.length > 0 && (
                                      <div className="mb-2 flex flex-wrap gap-1">
                                        {task.labels.slice(0, 3).map((label) => (
                                          <span
                                            key={label}
                                            className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                                          >
                                            {label}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {task.checklist.length > 0 && (
                                      <Progress
                                        className="mb-3 h-1.5"
                                        value={
                                          (task.checklist.filter((item) => item.completed).length /
                                            task.checklist.length) *
                                          100
                                        }
                                      />
                                    )}
                                    {task.checklist.length > 0 && (
                                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <CheckSquare className="h-3.5 w-3.5" />
                                        {task.checklist.filter((item) => item.completed).length}/
                                        {task.checklist.length}
                                      </span>
                                    )}
                                  </div>
                                  <Select
                                    value={task.stage}
                                    onValueChange={(value) => moveTask(task, value)}
                                    disabled={["new_requests", "ready_for_review"].includes(
                                      task.stage,
                                    )}
                                  >
                                    <SelectTrigger
                                      className="h-8 text-xs"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {availableStages(task).map((item) => (
                                        <SelectItem key={item.value} value={item.value}>
                                          {item.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </SortableTaskShell>
                              ))
                            )}
                            {!["new_requests", "completed"].includes(stage.value) && (
                              <button
                                type="button"
                                onClick={() => openTaskDialog(stage.value)}
                                className="h-12 w-full rounded-md border border-dashed bg-muted text-left text-sm text-muted-foreground px-3 hover:bg-muted/70"
                              >
                                Add a task...
                              </button>
                            )}
                          </div>
                        </SortableContext>
                      </KanbanColumn>
                    );
                  })}
                </div>
              </div>
              <DragOverlay>
                {activeDragTaskId ? (
                  <div className="w-72 rotate-2 rounded-md border bg-background p-3 shadow-2xl">
                    <p className="text-sm font-medium">
                      {kanbanTasks.find((task) => task.id === activeDragTaskId)?.name}
                    </p>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : view === "timeline" ? (
            <TaskTimeline
              tasks={filteredTasks}
              employees={employees.data ?? []}
              onOpenTask={setSelectedTaskId}
            />
          ) : view === "employee" ? (
            <EmployeePerformance
              employees={employees.data ?? []}
              tasks={filteredTasks}
              metrics={taskMetrics.data ?? []}
              onOpenTask={setSelectedTaskId}
            />
          ) : (
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTasks.map((task) => (
                    <TableRow
                      key={task.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <TableCell>
                        <div className="font-medium">{task.name}</div>
                        <div className="text-xs text-muted-foreground">{task.teamName}</div>
                      </TableCell>
                      <TableCell>
                        {task.assigneeEmployeeId
                          ? ((employees.data ?? []).find(
                              (employee) => employee.id === task.assigneeEmployeeId,
                            )?.name ?? "Employee")
                          : "Unassigned"}
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">
                        {task.description || "—"}
                      </TableCell>
                      <TableCell>{stageLabel(task.stage)}</TableCell>
                      <TableCell>{task.projectName}</TableCell>
                      <TableCell>{new Date(task.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>{new Date(task.updatedAt).toLocaleDateString()}</TableCell>
                      <TableCell>{task.deadline ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {task.status === "active" && !isTeamManagerOwnTask(task) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              archiveTaskMutation.mutate(task.id);
                            }}
                          >
                            <Archive className="h-4 w-4 mr-2" />
                            Archive
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredTasks.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        No tasks match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          )}

          {view === "projects" && (
            <Card className="mt-5 overflow-x-auto">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                <div>
                  <h2 className="font-semibold">Projects</h2>
                  <p className="text-xs text-muted-foreground">
                    Open a project to manage its members, tasks and activity.
                  </p>
                </div>
                <div className="flex rounded-lg bg-muted p-1">
                  <button
                    type="button"
                    onClick={() => setProjectStatus("active")}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${projectStatus === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                  >
                    Active (
                    {(projects.data ?? []).filter((project) => project.status === "active").length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectStatus("archived")}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${projectStatus === "archived" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                  >
                    Archived (
                    {
                      (projects.data ?? []).filter((project) => project.status === "archived")
                        .length
                    }
                    )
                  </button>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Tasks</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Tracked</TableHead>
                    <TableHead>Last active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectRows.map((project) => {
                    const team = (teams.data ?? []).find((item) => item.id === project.teamId);
                    const projectTasks = (tasks.data ?? []).filter(
                      (task) => task.projectId === project.id,
                    );
                    const memberIds = new Set(
                      projectTasks.flatMap((task) =>
                        [task.assigneeEmployeeId, ...task.collaboratorEmployeeIds].filter(Boolean),
                      ),
                    );
                    const completedCount = projectTasks.filter(
                      (task) => task.stage === "completed",
                    ).length;
                    const progress = projectTasks.length
                      ? Math.round((completedCount / projectTasks.length) * 100)
                      : 0;
                    const tracked = (taskMetrics.data ?? [])
                      .filter((metric) => projectTasks.some((task) => task.id === metric.taskId))
                      .reduce((sum, metric) => sum + metric.activeMinutes + metric.idleMinutes, 0);
                    const lastActive = [...projectTasks].sort((a, b) =>
                      b.updatedAt.localeCompare(a.updatedAt),
                    )[0]?.updatedAt;
                    return (
                      <TableRow key={project.id} className="cursor-pointer">
                        <TableCell>
                          <Link
                            to="/projects/$projectId"
                            params={{ projectId: project.id }}
                            className="font-medium hover:text-primary"
                          >
                            {project.name}
                          </Link>
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {project.description || "-"}
                          </div>
                        </TableCell>
                        <TableCell>{team?.name ?? "-"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-2">
                              {[...memberIds].slice(0, 4).map((id) => {
                                const employee = (employees.data ?? []).find(
                                  (item) => item.id === id,
                                );
                                return (
                                  <Avatar key={id} className="h-7 w-7 border-2 border-background">
                                    <AvatarFallback className="text-[9px]">
                                      {employee?.name
                                        .split(" ")
                                        .map((part) => part[0])
                                        .slice(0, 2)
                                        .join("") ?? "?"}
                                    </AvatarFallback>
                                  </Avatar>
                                );
                              })}
                            </div>
                            {memberIds.size > 4 && (
                              <span className="text-xs text-muted-foreground">
                                +{memberIds.size - 4}
                              </span>
                            )}
                            {memberIds.size === 0 && (
                              <span className="text-xs text-muted-foreground">No members</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{projectTasks.length}</TableCell>
                        <TableCell className="min-w-36">
                          <div className="flex items-center gap-2">
                            <Progress value={progress} className="h-1.5" />
                            <span className="text-xs">{progress}%</span>
                          </div>
                        </TableCell>
                        <TableCell>{formatMinutes(tracked)}</TableCell>
                        <TableCell>
                          {lastActive ? new Date(lastActive).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => duplicateProjectMutation.mutate(project.id)}
                            >
                              <Copy className="mr-1 h-4 w-4" /> Duplicate
                            </Button>
                            {project.status === "active" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => archiveProjectMutation.mutate(project.id)}
                              >
                                <Archive className="h-4 w-4 mr-2" />
                                Archive
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => restoreProjectMutation.mutate(project.id)}
                              >
                                <RotateCcw className="mr-1 h-4 w-4" /> Restore
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {projectRows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        No projects yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}

      <Sheet
        open={selectedTask !== null}
        onOpenChange={(open) => {
          if (open) return;
          setSelectedTaskId(null);
          if (search.taskId) {
            void navigate({ to: "/projects", search: { taskId: undefined }, replace: true });
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-6xl">
          {selectedTask &&
            (() => {
              const project = activeProjects.find((item) => item.id === selectedTask.projectId);
              const members = (employees.data ?? []).filter(
                (employee) => project && employee.teamIds.includes(project.teamId),
              );
              const completed = selectedTask.checklist.filter((item) => item.completed).length;
              const isSelfReview = isTeamManagerOwnTask(selectedTask);
              return (
                <>
                  <SheetHeader>
                    <SheetTitle>
                      <Input
                        key={`title-${selectedTask.id}`}
                        defaultValue={selectedTask.name}
                        className="h-auto border-transparent px-1 text-lg font-semibold shadow-none focus-visible:border-input"
                        aria-label="Task name"
                        onBlur={(event) => {
                          const name = event.target.value.trim();
                          if (name && name !== selectedTask.name)
                            moveTaskMutation.mutate({ id: selectedTask.id, name });
                        }}
                      />
                    </SheetTitle>
                    <SheetDescription>
                      {selectedTask.teamName} / {selectedTask.projectName}
                    </SheetDescription>
                  </SheetHeader>

                  {selectedTask.stage === "new_requests" && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
                      <div className="mr-auto">
                        <p className="font-medium text-amber-950 dark:text-amber-200">
                          Employee request awaiting approval
                        </p>
                        <p className="text-xs text-amber-800 dark:text-amber-300">
                          Approve it into Assigned, or reject it with a reason.
                        </p>
                      </div>
                      {isSelfReview ? (
                        <p className="max-w-sm text-xs font-medium text-amber-900 dark:text-amber-200">
                          You cannot review your own task. A General admin or another team manager
                          must decide this request.
                        </p>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              workflowMutation.mutate({
                                action: "approve-request",
                                taskId: selectedTask.id,
                              })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const note = await prompt({
                                title: "Reject request",
                                description: "Why is this request rejected?",
                              });
                              if (!note) return;
                              workflowMutation.mutate({
                                action: "reject-request",
                                taskId: selectedTask.id,
                                note,
                              });
                            }}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  {selectedTask.stage === "ready_for_review" && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950">
                      <div className="mr-auto">
                        <p className="font-medium text-sky-950 dark:text-sky-200">
                          Ready for manager review
                        </p>
                        <p className="text-xs text-sky-800 dark:text-sky-300">
                          Review the checklist and tracked work before deciding.
                        </p>
                      </div>
                      {isSelfReview ? (
                        <p className="max-w-sm text-xs font-medium text-sky-900 dark:text-sky-200">
                          You cannot review your own work. A General admin or another team manager
                          must approve or return it.
                        </p>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={async () => {
                              const hasIncomplete = selectedTask.checklist.some(
                                (item) => !item.completed,
                              );
                              const note = hasIncomplete
                                ? await prompt({
                                    title: "Approve & complete",
                                    description:
                                      "The checklist is incomplete. Add an approval reason.",
                                  })
                                : undefined;
                              if (hasIncomplete && !note) return;
                              workflowMutation.mutate({
                                action: "approve-review",
                                taskId: selectedTask.id,
                                note: note ?? undefined,
                              });
                            }}
                          >
                            Approve & complete
                          </Button>
                          <Select
                            value={reviewReturnStage}
                            onValueChange={(value) =>
                              setReviewReturnStage(value as TaskReviewReturnStage)
                            }
                          >
                            <SelectTrigger className="h-9 w-40 bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="backlog">Return to Backlog</SelectItem>
                              <SelectItem value="assigned">Return to Assigned</SelectItem>
                              <SelectItem value="in_progress">Return to In progress</SelectItem>
                              <SelectItem value="blocked">Return as Blocked</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const note = await prompt({
                                title: "Return for changes",
                                description: "What should be changed?",
                              });
                              if (!note) return;
                              workflowMutation.mutate({
                                action: "return-review",
                                taskId: selectedTask.id,
                                targetStage: reviewReturnStage,
                                note,
                              });
                            }}
                          >
                            Return
                          </Button>
                        </>
                      )}
                    </div>
                  )}

                  <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
                    <div className="space-y-6">
                      <div className="space-y-1.5">
                        <Label>Description</Label>
                        <Textarea
                          key={selectedTask.id}
                          defaultValue={selectedTask.description}
                          placeholder="Describe the expected outcome..."
                          onBlur={(event) =>
                            moveTaskMutation.mutate({
                              id: selectedTask.id,
                              description: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Stage</Label>
                          <Select
                            value={selectedTask.stage}
                            onValueChange={(stage) => moveTask(selectedTask, stage)}
                            disabled={["new_requests", "ready_for_review"].includes(
                              selectedTask.stage,
                            )}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {availableStages(selectedTask).map((stage) => (
                                <SelectItem key={stage.value} value={stage.value}>
                                  {stage.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label>Start date</Label>
                            <DatePicker
                              value={selectedTask.startDate}
                              placeholder="Select start date"
                              onChange={(startDate) =>
                                moveTaskMutation.mutate({
                                  id: selectedTask.id,
                                  startDate,
                                  ...(startDate &&
                                  selectedTask.deadline &&
                                  selectedTask.deadline < startDate
                                    ? { deadline: null }
                                    : {}),
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Deadline</Label>
                            <DatePicker
                              value={selectedTask.deadline}
                              minDate={selectedTask.startDate}
                              placeholder="Select deadline"
                              onChange={(deadline) =>
                                moveTaskMutation.mutate({ id: selectedTask.id, deadline })
                              }
                            />
                          </div>
                        </div>
                        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
                          <div>
                            <p className="text-xs text-muted-foreground">Tracked</p>
                            <p className="font-medium">
                              {formatMinutes(
                                (taskMetrics.data ?? []).find(
                                  (metric) => metric.taskId === selectedTask.id,
                                )?.activeMinutes ?? 0,
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Created</p>
                            <p className="text-sm font-medium">
                              {new Date(selectedTask.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Completed</p>
                            <p className="text-sm font-medium">
                              {selectedTask.completedAt
                                ? new Date(selectedTask.completedAt).toLocaleDateString()
                                : "—"}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Primary assignee</Label>
                          <Select
                            value={selectedTask.assigneeEmployeeId ?? "team"}
                            onValueChange={(value) =>
                              moveTaskMutation.mutate({
                                id: selectedTask.id,
                                assigneeEmployeeId: value === "team" ? null : value,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="team">Available to team</SelectItem>
                              {members.map((employee) => (
                                <SelectItem key={employee.id} value={employee.id}>
                                  {employee.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Priority</Label>
                          <Select
                            value={selectedTask.priority}
                            onValueChange={(priority: (typeof PRIORITIES)[number]) =>
                              moveTaskMutation.mutate({ id: selectedTask.id, priority })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PRIORITIES.map((priority) => (
                                <SelectItem key={priority} value={priority}>
                                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <Users className="h-4 w-4" /> Collaborators
                        </Label>
                        <PeopleMultiSelect
                          people={members}
                          selectedIds={selectedTask.collaboratorEmployeeIds}
                          placeholder="Choose collaborators"
                          onChange={(collaboratorEmployeeIds) =>
                            moveTaskMutation.mutate({
                              id: selectedTask.id,
                              collaboratorEmployeeIds,
                            })
                          }
                        />
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="flex items-center gap-2">
                            <CheckSquare className="h-4 w-4" /> Checklist
                          </Label>
                          <span className="text-xs text-muted-foreground">
                            {completed}/{selectedTask.checklist.length} complete
                          </span>
                        </div>
                        <Progress
                          value={
                            selectedTask.checklist.length
                              ? (completed / selectedTask.checklist.length) * 100
                              : 0
                          }
                        />
                        <div className="space-y-1">
                          {selectedTask.checklist.map((item) => (
                            <div
                              key={item.id}
                              draggable
                              onDragStart={(event) =>
                                event.dataTransfer.setData(
                                  "application/x-khaliduo-check-item",
                                  item.id,
                                )
                              }
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                const sourceId = event.dataTransfer.getData(
                                  "application/x-khaliduo-check-item",
                                );
                                const source = selectedTask.checklist.find(
                                  (entry) => entry.id === sourceId,
                                );
                                if (source && source.id !== item.id) {
                                  checklistUpdateMutation.mutate({
                                    taskId: selectedTask.id,
                                    itemId: source.id,
                                    position: item.position,
                                  });
                                  checklistUpdateMutation.mutate({
                                    taskId: selectedTask.id,
                                    itemId: item.id,
                                    position: source.position,
                                  });
                                }
                              }}
                              className="flex items-center gap-2 rounded-md border bg-card p-2"
                            >
                              <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" />
                              <Checkbox
                                checked={item.completed}
                                onCheckedChange={(checked) =>
                                  checklistUpdateMutation.mutate({
                                    taskId: selectedTask.id,
                                    itemId: item.id,
                                    completed: checked === true,
                                  })
                                }
                              />
                              <Input
                                key={`${item.id}-${item.title}`}
                                defaultValue={item.title}
                                aria-label="Checklist item"
                                className={`h-8 min-w-0 flex-1 border-transparent bg-transparent px-1 text-sm ${item.completed ? "text-muted-foreground line-through" : ""}`}
                                onBlur={(event) => {
                                  const title = event.target.value.trim();
                                  if (title && title !== item.title)
                                    checklistUpdateMutation.mutate({
                                      taskId: selectedTask.id,
                                      itemId: item.id,
                                      title,
                                    });
                                }}
                              />
                              <Select
                                value={item.assigneeEmployeeId ?? "none"}
                                onValueChange={(value) =>
                                  checklistUpdateMutation.mutate({
                                    taskId: selectedTask.id,
                                    itemId: item.id,
                                    assigneeEmployeeId: value === "none" ? null : value,
                                  })
                                }
                              >
                                <SelectTrigger className="h-7 w-28 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No owner</SelectItem>
                                  {members.map((employee) => (
                                    <SelectItem key={employee.id} value={employee.id}>
                                      {employee.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() =>
                                  checklistDeleteMutation.mutate({
                                    taskId: selectedTask.id,
                                    itemId: item.id,
                                  })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                        <form
                          className="flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (newChecklistTitle.trim())
                              checklistMutation.mutate({
                                taskId: selectedTask.id,
                                title: newChecklistTitle.trim(),
                              });
                          }}
                        >
                          <Input
                            value={newChecklistTitle}
                            onChange={(event) => setNewChecklistTitle(event.target.value)}
                            placeholder="Add a checklist item..."
                          />
                          <Button
                            type="submit"
                            disabled={!newChecklistTitle.trim() || checklistMutation.isPending}
                          >
                            <Plus className="mr-1 h-4 w-4" /> Add
                          </Button>
                        </form>
                      </div>
                    </div>
                    <TaskWorkspacePanel
                      key={selectedTask.id}
                      task={selectedTask}
                      allTasks={tasks.data ?? []}
                      onOpenTask={setSelectedTaskId}
                      onUpdate={(input) =>
                        moveTaskMutation.mutate({ id: selectedTask.id, ...input })
                      }
                    />
                  </div>
                </>
              );
            })()}
        </SheetContent>
      </Sheet>

      <Dialog open={projectOpen} onOpenChange={setProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitProject} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Team</Label>
              <Select value={newProjectTeamId} onValueChange={setNewProjectTeamId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose team" />
                </SelectTrigger>
                <SelectContent>
                  {(teams.data ?? []).map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                value={newProjectDescription}
                onChange={(event) => setNewProjectDescription(event.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setProjectOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newProjectTeamId || createProjectMutation.isPending}>
                Create project
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create task</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitTask} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select
                value={newTaskProjectId}
                onValueChange={(value) => {
                  setNewTaskProjectId(value);
                  setNewTaskAssigneeId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose project" />
                </SelectTrigger>
                <SelectContent>
                  {activeProjects.map((project) => {
                    const team = (teams.data ?? []).find((item) => item.id === project.teamId);
                    return (
                      <SelectItem key={project.id} value={project.id}>
                        {team?.name ?? "-"} / {project.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Assign to</Label>
              <Select
                value={newTaskAssigneeId || "team"}
                onValueChange={(value) => setNewTaskAssigneeId(value === "team" ? "" : value)}
                disabled={!newTaskProjectId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Available to whole team</SelectItem>
                  {assigneeCandidates.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only members of the project's team can be assigned.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <Select value={newTaskStage} onValueChange={setNewTaskStage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STAGES.filter((stage) =>
                    ["backlog", "assigned", "in_progress"].includes(stage.value),
                  ).map((stage) => (
                    <SelectItem key={stage.value} value={stage.value}>
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={newTaskPriority}
                onValueChange={(value: (typeof PRIORITIES)[number]) => setNewTaskPriority(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {priority.charAt(0).toUpperCase() + priority.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-name">Name</Label>
              <Input
                id="task-name"
                value={newTaskName}
                onChange={(event) => setNewTaskName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-description">Description</Label>
              <Textarea
                id="task-description"
                value={newTaskDescription}
                onChange={(event) => setNewTaskDescription(event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <DatePicker
                  value={newTaskStartDate}
                  placeholder="Select start date"
                  onChange={(value) => {
                    const startDate = value ?? "";
                    setNewTaskStartDate(startDate);
                    if (startDate && newTaskDeadline && newTaskDeadline < startDate) {
                      setNewTaskDeadline("");
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Deadline</Label>
                <DatePicker
                  value={newTaskDeadline}
                  minDate={newTaskStartDate}
                  placeholder="Select deadline"
                  onChange={(value) => setNewTaskDeadline(value ?? "")}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setTaskOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newTaskProjectId || createTaskMutation.isPending}>
                Create task
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {notePromptDialog}
    </div>
  );
}

function isoWeekInfo(value: string) {
  const date = new Date(value);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const monday = new Date(utc);
  monday.setUTCDate(utc.getUTCDate() - 3);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const range = `${monday.toLocaleDateString([], { month: "short", day: "numeric" })} – ${sunday.toLocaleDateString([], { month: "short", day: "numeric" })}`;
  return { year, week, range };
}

function taskTimingLabel(task: Task): { label: string; tone: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = task.startDate ? new Date(`${task.startDate}T00:00:00`) : null;
  const deadline = task.deadline ? new Date(`${task.deadline}T23:59:59`) : null;
  if (task.stage === "completed") {
    const late = deadline && task.completedAt && new Date(task.completedAt) > deadline;
    return {
      label: late ? "Completed late" : "Completed on time",
      tone: late ? "text-warning-foreground" : "text-success",
    };
  }
  if (deadline && deadline < today) return { label: "Overdue", tone: "text-destructive" };
  if (start && start > today)
    return { label: `Starts ${start.toLocaleDateString()}`, tone: "text-muted-foreground" };
  if (start && start.toDateString() === today.toDateString())
    return { label: "Starts today", tone: "text-info" };
  if (deadline && deadline.getTime() - Date.now() <= 3 * 86400000)
    return { label: `Due ${deadline.toLocaleDateString()}`, tone: "text-warning-foreground" };
  if (["new_requests", "backlog", "assigned"].includes(task.stage))
    return { label: "Not started", tone: "text-muted-foreground" };
  return null;
}

function KanbanColumn({
  stage,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { stage: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${stage}`,
    data: { stage },
  });
  return (
    <section ref={setNodeRef} {...props} data-drop-active={isOver || undefined}>
      {children}
    </section>
  );
}

function PeopleMultiSelect({
  people,
  selectedIds,
  placeholder,
  onChange,
}: {
  people: import("@/types").Employee[];
  selectedIds: string[];
  placeholder: string;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = people.filter((person) => selectedIds.includes(person.id));
  function toggle(personId: string) {
    onChange(
      selectedIds.includes(personId)
        ? selectedIds.filter((id) => id !== personId)
        : [...selectedIds, personId],
    );
  }
  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={selected.length ? "" : "text-muted-foreground"}>
              {selected.length
                ? `${selected.length} collaborator${selected.length === 1 ? "" : "s"} selected`
                : placeholder}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search people..." />
            <CommandList className="max-h-72">
              <CommandEmpty>No team member found.</CommandEmpty>
              <CommandGroup>
                {people.map((person) => {
                  const checked = selectedIds.includes(person.id);
                  return (
                    <CommandItem
                      key={person.id}
                      value={person.name}
                      onSelect={() => toggle(person.id)}
                      className="gap-2"
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"}`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px]">
                          {person.name
                            .split(" ")
                            .map((part) => part[0])
                            .slice(0, 2)
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate">{person.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => toggle(person.id)}
              className="flex items-center gap-1.5 rounded-full border bg-background py-1 pl-1 pr-2 text-xs transition hover:border-destructive/40 hover:text-destructive"
              aria-label={`Remove ${person.name}`}
            >
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-[8px]">
                  {person.name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <span className="max-w-32 truncate">{person.name}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskTimeline({
  tasks,
  employees,
  onOpenTask,
}: {
  tasks: Task[];
  employees: import("@/types").Employee[];
  onOpenTask: (id: string) => void;
}) {
  const [weeks, setWeeks] = useState(4);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 7);
  const days = Array.from({ length: weeks * 7 }, (_, index) => {
    const value = new Date(start);
    value.setDate(start.getDate() + index);
    return value;
  });
  const rows = [
    ...employees
      .filter((employee) =>
        tasks.some(
          (task) =>
            task.assigneeEmployeeId === employee.id ||
            task.collaboratorEmployeeIds.includes(employee.id),
        ),
      )
      .map((employee) => ({ id: employee.id, name: employee.name })),
    ...(tasks.some((task) => !task.assigneeEmployeeId)
      ? [{ id: "unassigned", name: "Unassigned" }]
      : []),
  ];
  const dayIndex = (value: string) => {
    const date = new Date(`${value.slice(0, 10)}T00:00:00`);
    return Math.floor((date.getTime() - start.getTime()) / 86400000);
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b p-3">
        <div>
          <p className="font-medium">Schedule by assignee</p>
          <p className="text-xs text-muted-foreground">Start dates and deadlines at a glance</p>
        </div>
        <Select value={String(weeks)} onValueChange={(value) => setWeeks(Number(value))}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2 weeks</SelectItem>
            <SelectItem value="4">4 weeks</SelectItem>
            <SelectItem value="8">8 weeks</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${220 + days.length * 58}px` }}>
          <div
            className="grid border-b bg-muted/30"
            style={{ gridTemplateColumns: `220px repeat(${days.length}, 58px)` }}
          >
            <div className="sticky left-0 z-20 border-r bg-muted/60 p-3 text-xs font-medium">
              Assignee
            </div>
            {days.map((day) => {
              const isToday = day.toDateString() === today.toDateString();
              return (
                <div
                  key={day.toISOString()}
                  className={`border-r px-1 py-2 text-center text-[10px] ${isToday ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`}
                >
                  <span className="block">{day.toLocaleDateString([], { weekday: "short" })}</span>
                  <span>{day.getDate()}</span>
                </div>
              );
            })}
          </div>
          {rows.map((row) => {
            const rowTasks = tasks.filter((task) =>
              row.id === "unassigned"
                ? !task.assigneeEmployeeId
                : task.assigneeEmployeeId === row.id ||
                  task.collaboratorEmployeeIds.includes(row.id),
            );
            return (
              <div
                key={row.id}
                className="grid min-h-20 border-b"
                style={{ gridTemplateColumns: `220px ${days.length * 58}px` }}
              >
                <div className="sticky left-0 z-10 flex items-center gap-2 border-r bg-background p-3 text-sm font-medium">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-[10px]">
                      {row.name
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{row.name}</span>
                </div>
                <div
                  className="relative grid"
                  style={{ gridTemplateColumns: `repeat(${days.length}, 58px)` }}
                >
                  {days.map((day) => (
                    <div
                      key={day.toISOString()}
                      className={`border-r ${day.getDay() === 0 || day.getDay() === 6 ? "bg-muted/25" : ""} ${day.toDateString() === today.toDateString() ? "bg-primary/5" : ""}`}
                    />
                  ))}
                  {rowTasks.map((task, taskIndex) => {
                    const from = Math.max(0, dayIndex(task.startDate ?? task.createdAt));
                    const to = Math.min(
                      days.length - 1,
                      dayIndex(task.deadline ?? task.startDate ?? task.createdAt),
                    );
                    if (to < 0 || from >= days.length) return null;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onOpenTask(task.id)}
                        className={`absolute h-7 truncate rounded border px-2 text-left text-xs font-medium shadow-sm transition hover:brightness-95 ${task.stage === "completed" ? "border-emerald-300 bg-emerald-100 text-emerald-900" : taskTimingLabel(task)?.label === "Overdue" ? "border-red-300 bg-red-50 text-red-700" : "border-primary/30 bg-primary/10 text-primary"}`}
                        style={{
                          left: `${from * 58 + 4}px`,
                          width: `${Math.max(1, to - from + 1) * 58 - 8}px`,
                          top: `${8 + (taskIndex % 2) * 32}px`,
                        }}
                        title={`${task.priority.toUpperCase()} priority · ${task.name}`}
                      >
                        <span className="mr-1 text-[9px] font-bold uppercase opacity-70">
                          {task.priority}
                        </span>
                        {task.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              Add start dates and assignees to see tasks on the timeline.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function TaskWorkspacePanel({
  task,
  allTasks,
  onOpenTask,
  onUpdate,
}: {
  task: Task;
  allTasks: Task[];
  onOpenTask: (taskId: string) => void;
  onUpdate: (input: { labels?: string[]; recurrenceRule?: string | null }) => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"comments" | "work" | "history">("comments");
  const [comment, setComment] = useState("");
  const [dependencyId, setDependencyId] = useState("");
  const [label, setLabel] = useState("");
  const workspace = useQuery({
    queryKey: ["task-workspace", task.id],
    queryFn: () => getTaskWorkspace(task.id),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["task-workspace", task.id] });
  const commentMutation = useMutation({
    mutationFn: () => createTaskComment(task.id, comment.trim()),
    onSuccess: async () => {
      setComment("");
      await refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Comment failed"),
  });
  const dependencyMutation = useMutation({
    mutationFn: () => addTaskDependency(task.id, dependencyId),
    onSuccess: async () => {
      setDependencyId("");
      await refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Link failed"),
  });
  const removeDependencyMutation = useMutation({
    mutationFn: (id: string) => removeTaskDependency(task.id, id),
    onSuccess: refresh,
  });
  const attachmentMutation = useMutation({
    mutationFn: (file: File) => uploadTaskAttachment(task.id, file),
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Upload failed"),
  });

  async function downloadAttachment(id: string, fileName: string) {
    try {
      const blob = await downloadTaskAttachment(task.id, id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download failed");
    }
  }

  const existingDependencyIds = new Set(workspace.data?.dependencies.map((item) => item.taskId));
  return (
    <aside className="space-y-5 rounded-xl border bg-muted/20 p-4 lg:sticky lg:top-0 lg:self-start">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-amber-500" /> Dependencies
          </Label>
          <span className="text-xs text-muted-foreground">
            {workspace.data?.dependencies.length ?? 0}
          </span>
        </div>
        {(workspace.data?.dependencies ?? []).map((dependency) => (
          <div
            key={dependency.id}
            className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <button
              type="button"
              className="min-w-0 truncate text-left hover:text-primary"
              onClick={() => onOpenTask(dependency.taskId)}
            >
              {dependency.name}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => removeDependencyMutation.mutate(dependency.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Select value={dependencyId} onValueChange={setDependencyId}>
            <SelectTrigger className="min-w-0">
              <SelectValue placeholder="Link a task" />
            </SelectTrigger>
            <SelectContent>
              {allTasks
                .filter((item) => item.id !== task.id && !existingDependencyIds.has(item.id))
                .map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="outline"
            loading={dependencyMutation.isPending}
            disabled={!dependencyId || dependencyMutation.isPending}
            onClick={() => dependencyMutation.mutate()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <Label className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-violet-500" /> Attachments
        </Label>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-background px-4 py-5 text-center transition hover:border-primary/50 hover:bg-primary/5">
          <Paperclip className="mb-2 h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">Drop or browse files</span>
          <span className="text-xs text-muted-foreground">Up to 20 MB</span>
          <input
            type="file"
            className="sr-only"
            disabled={attachmentMutation.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) attachmentMutation.mutate(file);
              event.target.value = "";
            }}
          />
        </label>
        {(workspace.data?.attachments ?? []).map((attachment) => (
          <button
            key={attachment.id}
            type="button"
            onClick={() => void downloadAttachment(attachment.id, attachment.fileName)}
            className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:border-primary/40"
          >
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
            <span className="text-[10px] text-muted-foreground">
              {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB
            </span>
            <Download className="h-3.5 w-3.5" />
          </button>
        ))}
      </section>

      <section className="space-y-2">
        <Label>Labels</Label>
        <div className="flex flex-wrap gap-1.5">
          {task.labels.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onUpdate({ labels: task.labels.filter((value) => value !== item) })}
              className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-destructive/10 hover:text-destructive"
            >
              {item} ×
            </button>
          ))}
        </div>
        <Input
          value={label}
          placeholder="Type label and press Enter"
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && label.trim()) {
              event.preventDefault();
              if (!task.labels.includes(label.trim()))
                onUpdate({ labels: [...task.labels, label.trim()] });
              setLabel("");
            }
          }}
        />
      </section>

      <section className="space-y-2">
        <Label>Recurring</Label>
        <Select
          value={task.recurrenceRule ?? "none"}
          onValueChange={(value) => onUpdate({ recurrenceRule: value === "none" ? null : value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Does not repeat</SelectItem>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <section>
        <div className="mb-3 grid grid-cols-3 border-b">
          {(
            [
              ["comments", "Comments", MessageSquare],
              ["work", "Work logs", ListTodo],
              ["history", "History", History],
            ] as const
          ).map(([value, text, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`flex items-center justify-center gap-1 border-b-2 px-1 py-2 text-xs font-medium ${tab === value ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {text}
            </button>
          ))}
        </div>
        {tab === "comments" && (
          <div className="space-y-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (comment.trim()) commentMutation.mutate();
              }}
              className="space-y-2"
            >
              <Textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Write a comment..."
              />
              <Button
                type="submit"
                size="sm"
                loading={commentMutation.isPending}
                disabled={!comment.trim() || commentMutation.isPending}
              >
                Send comment
              </Button>
            </form>
            {(workspace.data?.comments ?? []).map((item) => (
              <div key={item.id} className="rounded-lg border bg-background p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{item.authorName}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{item.body}</p>
              </div>
            ))}
          </div>
        )}
        {tab === "work" && (
          <div className="space-y-2">
            {(workspace.data?.workLogs ?? []).map((item) => (
              <div key={item.employeeId} className="rounded-lg border bg-background p-3">
                <p className="text-sm font-medium">{item.employeeName}</p>
                <p className="text-xs text-muted-foreground">
                  Active {formatMinutes(Math.round(item.activeSeconds / 60))} · Idle{" "}
                  {formatMinutes(Math.round(item.idleSeconds / 60))}
                </p>
              </div>
            ))}
            {workspace.data?.workLogs.length === 0 && (
              <p className="text-sm text-muted-foreground">No tracked work yet.</p>
            )}
          </div>
        )}
        {tab === "history" && (
          <div className="space-y-2">
            {(workspace.data?.history ?? []).map((item) => (
              <div key={item.id} className="border-l-2 border-primary/30 pl-3 py-1">
                <p className="text-sm">
                  <span className="font-medium">{item.actorName}</span> {item.action}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
            {workspace.data?.history.length === 0 && (
              <p className="text-sm text-muted-foreground">No history yet.</p>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}

function SortableTaskShell({
  task,
  dragDisabled = false,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  task: Task;
  dragDisabled?: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { stage: task.stage },
    disabled: dragDisabled,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...props}
      className={`${className ?? ""} relative ${isDragging ? "opacity-25" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        {...listeners}
        disabled={dragDisabled}
        className="absolute right-10 top-3 z-10 cursor-grab rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Drag ${task.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

function EmployeePerformance({
  employees,
  tasks,
  metrics,
  onOpenTask,
}: {
  employees: import("@/types").Employee[];
  tasks: Task[];
  metrics: Array<{ taskId: string; activeMinutes: number; idleMinutes: number }>;
  onOpenTask: (id: string) => void;
}) {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {employees.map((employee) => {
        const own = tasks.filter(
          (task) =>
            task.assigneeEmployeeId === employee.id ||
            task.collaboratorEmployeeIds.includes(employee.id),
        );
        const completedWeek = own.filter(
          (task) => task.completedAt && new Date(task.completedAt) >= weekStart,
        ).length;
        const overdue = own.filter(
          (task) =>
            task.stage !== "completed" &&
            task.deadline &&
            new Date(`${task.deadline}T23:59:59`) < new Date(),
        ).length;
        const upcoming = own.filter((task) => {
          if (task.stage === "completed" || !task.deadline) return false;
          const remaining = new Date(`${task.deadline}T23:59:59`).getTime() - Date.now();
          return remaining >= 0 && remaining <= 7 * 86400000;
        }).length;
        const completedWithDeadline = own.filter((task) => task.completedAt && task.deadline);
        const completedOnTime = completedWithDeadline.filter(
          (task) =>
            new Date(task.completedAt!).getTime() <=
            new Date(`${task.deadline}T23:59:59`).getTime(),
        ).length;
        const completedLate = completedWithDeadline.length - completedOnTime;
        const checklist = own.flatMap((task) => task.checklist);
        const progress = checklist.length
          ? Math.round((checklist.filter((item) => item.completed).length / checklist.length) * 100)
          : 0;
        const ownMetrics = metrics.filter((metric) =>
          own.some((task) => task.id === metric.taskId),
        );
        const active = ownMetrics.reduce((sum, metric) => sum + metric.activeMinutes, 0);
        const idle = ownMetrics.reduce((sum, metric) => sum + metric.idleMinutes, 0);
        const current = own.find((task) => task.id === employee.currentTaskId);
        const plannedMinutes = own
          .filter(
            (task) =>
              task.assigneeEmployeeId === employee.id &&
              !["completed", "rejected", "cancelled"].includes(task.stage),
          )
          .reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);
        const workload = employee.weeklyCapacityMinutes
          ? Math.round((plannedMinutes / employee.weeklyCapacityMinutes) * 100)
          : 0;
        return (
          <Card key={employee.id} className="p-4">
            <div className="flex items-start gap-3">
              <Avatar>
                <AvatarFallback>
                  {employee.name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{employee.name}</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {current ? `Working on ${current.name}` : "No current task"}
                </p>
              </div>
              <StatusBadge status={employee.status} />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              <Metric label="Tasks" value={own.length} />
              <Metric
                label="In progress"
                value={own.filter((task) => task.stage === "in_progress").length}
              />
              <Metric label="Done/week" value={completedWeek} />
              <Metric label="Overdue" value={overdue} danger={overdue > 0} />
              <Metric label="Due next 7d" value={upcoming} />
              <Metric label="On time" value={completedOnTime} />
              <Metric label="Late" value={completedLate} danger={completedLate > 0} />
              <Metric
                label="Assigned"
                value={own.filter((task) => task.stage === "assigned").length}
              />
            </div>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs">
                <span>Checklist progress</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
            <div
              className={`mt-3 rounded-md border p-3 ${workload > 100 ? "border-red-300 bg-red-50" : "bg-muted/30"}`}
            >
              <div className="mb-1 flex justify-between text-xs">
                <span>Planned workload</span>
                <span className={workload > 100 ? "font-semibold text-red-700" : ""}>
                  {formatMinutes(plannedMinutes)} / {formatMinutes(employee.weeklyCapacityMinutes)}{" "}
                  ({workload}%)
                </span>
              </div>
              <Progress value={Math.min(workload, 100)} />
              {workload > 100 && (
                <p className="mt-1 text-xs text-red-700">
                  Over weekly capacity—rebalance before assigning more work.
                </p>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Tracked {formatMinutes(active + idle)} · Active {formatMinutes(active)} · Idle{" "}
              {formatMinutes(idle)}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {own.slice(0, 5).map((task) => (
                <Button
                  key={task.id}
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenTask(task.id)}
                >
                  {task.name}
                </Button>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <p className={`text-lg font-semibold ${danger ? "text-destructive" : ""}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function CompletedArchive({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const years = new Map<number, Map<number, { range: string; tasks: Task[] }>>();
  for (const task of tasks) {
    const info = isoWeekInfo(task.completedAt ?? task.createdAt);
    const weeks = years.get(info.year) ?? new Map();
    const group = weeks.get(info.week) ?? { range: info.range, tasks: [] };
    group.tasks.push(task);
    weeks.set(info.week, group);
    years.set(info.year, weeks);
  }
  if (tasks.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
        Completed tasks will be grouped here by week.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {[...years.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([year, weeks]) => (
          <details key={year} open className="group/year rounded-md border bg-background">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold">
              {year}{" "}
              <span className="font-normal text-muted-foreground">
                · {[...weeks.values()].reduce((sum, group) => sum + group.tasks.length, 0)}{" "}
                completed
              </span>
            </summary>
            <div className="space-y-1 border-t p-2">
              {[...weeks.entries()]
                .sort((a, b) => b[0] - a[0])
                .map(([week, group], index) => (
                  <details key={week} open={index === 0} className="rounded-md bg-muted/40">
                    <summary className="cursor-pointer list-none px-2.5 py-2 text-xs font-medium">
                      Week {week}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {group.range} · {group.tasks.length} tasks
                      </span>
                    </summary>
                    <div className="space-y-1 border-t px-2 py-2">
                      {group.tasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => onOpen(task.id)}
                          className="w-full rounded-md border bg-background p-2 text-left transition hover:border-primary/30"
                        >
                          <span className="block truncate text-xs font-medium">{task.name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {task.projectName}
                          </span>
                        </button>
                      ))}
                    </div>
                  </details>
                ))}
            </div>
          </details>
        ))}
    </div>
  );
}
