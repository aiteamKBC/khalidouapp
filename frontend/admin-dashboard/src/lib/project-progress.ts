import type { Task } from "@/types";

const STAGE_PROGRESS: Record<string, number> = {
  new_requests: 0,
  backlog: 0,
  assigned: 25,
  in_progress: 50,
  blocked: 50,
  ready_for_review: 80,
  completed: 100,
};

export function projectProgressTasks(tasks: Task[]) {
  return tasks.filter(
    (task) => task.status === "active" && !["rejected", "cancelled"].includes(task.stage),
  );
}

export function projectWorkflowProgress(tasks: Task[]) {
  const progressTasks = projectProgressTasks(tasks);
  if (progressTasks.length === 0) return 0;
  return Math.round(
    progressTasks.reduce((total, task) => total + (STAGE_PROGRESS[task.stage] ?? 0), 0) /
      progressTasks.length,
  );
}
