import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Archive,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Copy,
  Edit3,
  ListTodo,
  RotateCcw,
  Users,
} from "lucide-react";
import {
  duplicateProject,
  getProject,
  listTaskMetrics,
  listTasks,
  updateProject,
} from "@/api/projects";
import { listEmployees } from "@/api/employees";
import { listTeams } from "@/api/teams";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatMinutes } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/projects/$projectId")({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"overview" | "members" | "tasks" | "activity">("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState("");
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
  });
  const tasks = useQuery({
    queryKey: ["tasks", "project", projectId],
    queryFn: () => listTasks({ projectId }),
  });
  const teams = useQuery({ queryKey: ["teams", "project-detail"], queryFn: () => listTeams() });
  const employees = useQuery({
    queryKey: ["employees", project.data?.teamId],
    queryFn: () => listEmployees(project.data?.teamId ? [project.data.teamId] : undefined),
    enabled: Boolean(project.data?.teamId),
  });
  const metrics = useQuery({
    queryKey: ["task-metrics", project.data?.teamId],
    queryFn: () => listTaskMetrics(project.data?.teamId),
    enabled: Boolean(project.data?.teamId),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    ]);
  };
  const editMutation = useMutation({
    mutationFn: () => updateProject(projectId, { name, description, teamId }),
    onSuccess: async () => {
      setEditOpen(false);
      await refresh();
      toast.success("Project updated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed"),
  });
  const statusMutation = useMutation({
    mutationFn: (status: "active" | "archived") => updateProject(projectId, { status }),
    onSuccess: refresh,
  });
  const duplicateMutation = useMutation({
    mutationFn: () => duplicateProject(projectId),
    onSuccess: (copy) => {
      toast.success("Project duplicated with its tasks");
      void navigate({ to: "/projects/$projectId", params: { projectId: copy.id } });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Duplicate failed"),
  });
  const projectTasks = useMemo(() => tasks.data ?? [], [tasks.data]);
  const completed = projectTasks.filter((task) => task.stage === "completed").length;
  const progress = projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0;
  const projectMetrics = (metrics.data ?? []).filter((metric) =>
    projectTasks.some((task) => task.id === metric.taskId),
  );
  const tracked = projectMetrics.reduce(
    (sum, metric) => sum + metric.activeMinutes + metric.idleMinutes,
    0,
  );
  const lastActivity = useMemo(
    () => [...projectTasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.updatedAt,
    [projectTasks],
  );
  const team = (teams.data ?? []).find((item) => item.id === project.data?.teamId);

  if (project.isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading project...</p>;
  if (!project.data) return <p className="p-6 text-sm text-destructive">Project not found.</p>;

  function openEdit() {
    setName(project.data?.name ?? "");
    setDescription(project.data?.description ?? "");
    setTeamId(project.data?.teamId ?? "");
    setEditOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-3">
            <Link to="/projects">
              <ArrowLeft className="mr-2 h-4 w-4" /> Projects & tasks
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-lg font-semibold text-primary">
              {project.data.name[0]?.toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{project.data.name}</h1>
              <p className="text-sm text-muted-foreground">
                {team?.name ?? "Team"} · Created{" "}
                {new Date(project.data.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openEdit}>
            <Edit3 className="mr-2 h-4 w-4" /> Edit
          </Button>
          <Button
            variant="outline"
            disabled={duplicateMutation.isPending}
            onClick={() => duplicateMutation.mutate()}
          >
            <Copy className="mr-2 h-4 w-4" /> Duplicate
          </Button>
          {project.data.status === "active" ? (
            <Button variant="outline" onClick={() => statusMutation.mutate("archived")}>
              <Archive className="mr-2 h-4 w-4" /> Archive
            </Button>
          ) : (
            <Button variant="outline" onClick={() => statusMutation.mutate("active")}>
              <RotateCcw className="mr-2 h-4 w-4" /> Restore
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard icon={BriefcaseBusiness} label="Status">
          <StatusBadge status={project.data.status} />
        </MetricCard>
        <MetricCard icon={Users} label="Members" value={(employees.data ?? []).length} />
        <MetricCard icon={ListTodo} label="Tasks" value={projectTasks.length} />
        <MetricCard icon={CheckCircle2} label="Completed" value={`${progress}%`} />
        <MetricCard icon={Clock3} label="Tracked" value={formatMinutes(tracked)} />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {(
          [
            ["overview", "Overview"],
            ["members", "Members"],
            ["tasks", "Tasks"],
            ["activity", "Activity"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`border-b-2 px-4 py-3 text-sm font-medium ${tab === value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>Project progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>
                    {completed} of {projectTasks.length} tasks completed
                  </span>
                  <strong>{progress}%</strong>
                </div>
                <Progress value={progress} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Summary label="Tracked" value={formatMinutes(tracked)} />
                <Summary
                  label="Last active"
                  value={lastActivity ? new Date(lastActivity).toLocaleDateString() : "No activity"}
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Project information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Summary label="Team" value={team?.name ?? "—"} />
              <Summary label="Description" value={project.data.description || "No description"} />
              <Summary label="Updated" value={new Date(project.data.updatedAt).toLocaleString()} />
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "members" && (
        <MembersTable
          employees={employees.data ?? []}
          tasks={projectTasks}
          metrics={metrics.data ?? []}
        />
      )}
      {tab === "tasks" && <TasksTable tasks={projectTasks} employees={employees.data ?? []} />}
      {tab === "activity" && (
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {[...projectTasks]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{task.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Moved/updated in {task.stage.replaceAll("_", " ")}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(task.updatedAt).toLocaleString()}
                  </span>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              editMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(teams.data ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={!name.trim() || !teamId || editMutation.isPending}>
                Save project
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: typeof Activity;
  label: string;
  value?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="text-xl font-semibold">{value ?? children}</div>
    </Card>
  );
}

function Summary({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function MembersTable({
  employees,
  tasks,
  metrics,
}: {
  employees: import("@/types").Employee[];
  tasks: import("@/types").Task[];
  metrics: Array<{ taskId: string; activeMinutes: number; idleMinutes: number }>;
}) {
  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Project role</TableHead>
            <TableHead>Tasks</TableHead>
            <TableHead>Current task</TableHead>
            <TableHead>Tracked</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map((employee) => {
            const own = tasks.filter(
              (task) =>
                task.assigneeEmployeeId === employee.id ||
                task.collaboratorEmployeeIds.includes(employee.id),
            );
            const tracked = metrics
              .filter((metric) => own.some((task) => task.id === metric.taskId))
              .reduce((sum, metric) => sum + metric.activeMinutes + metric.idleMinutes, 0);
            const current = own.find((task) => task.id === employee.currentTaskId);
            return (
              <TableRow key={employee.id}>
                <TableCell className="font-medium">{employee.name}</TableCell>
                <TableCell>Team member</TableCell>
                <TableCell>{own.length}</TableCell>
                <TableCell>{current?.name ?? "—"}</TableCell>
                <TableCell>{formatMinutes(tracked)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function TasksTable({
  tasks,
  employees,
}: {
  tasks: import("@/types").Task[];
  employees: import("@/types").Employee[];
}) {
  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Assignee</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead>Progress</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const done = task.checklist.filter((item) => item.completed).length;
            const progress = task.checklist.length
              ? Math.round((done / task.checklist.length) * 100)
              : task.stage === "completed"
                ? 100
                : 0;
            return (
              <TableRow key={task.id}>
                <TableCell>
                  <Link to="/projects" className="font-medium hover:text-primary">
                    {task.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {employees.find((employee) => employee.id === task.assigneeEmployeeId)?.name ??
                    "Unassigned"}
                </TableCell>
                <TableCell>{task.stage.replaceAll("_", " ")}</TableCell>
                <TableCell>{task.deadline ?? "—"}</TableCell>
                <TableCell className="min-w-32">
                  <div className="flex items-center gap-2">
                    <Progress value={progress} className="h-1.5" />
                    <span className="text-xs">{progress}%</span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
