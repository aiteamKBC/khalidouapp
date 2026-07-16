import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Inbox, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  approveTaskRequest,
  approveTaskReview,
  listTaskNotifications,
  listTasks,
  readAllTaskNotifications,
  readTaskNotification,
  rejectTaskRequest,
  returnTaskReview,
  type TaskReviewReturnStage,
  type TaskWorkflowRequest,
} from "@/api/projects";
import { useAuth } from "@/lib/auth";
import type { Task } from "@/types";
import { toast } from "sonner";
import { MetricTile } from "@/components/ui/metric-tile";

export const Route = createFileRoute("/_app/notifications")({ component: NotificationsPage });

type WorkflowDecisionInput =
  | { action: "approve-request"; taskId: string }
  | { action: "reject-request"; taskId: string; note: string }
  | { action: "approve-review"; taskId: string; note?: string }
  | {
      action: "return-review";
      taskId: string;
      note: string;
      targetStage: TaskReviewReturnStage;
    };
type WorkflowDecision = WorkflowDecisionInput & { notificationId: string };

function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { scopedTeamIds, user } = useAuth();
  const scope = scopedTeamIds();
  const notifications = useQuery({
    queryKey: ["task-notifications"],
    queryFn: listTaskNotifications,
    refetchInterval: 30_000,
  });
  const tasks = useQuery({
    queryKey: ["tasks", scope],
    queryFn: () => listTasks({ scopedTeamIds: scope }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["task-notifications"] });
  const readOne = useMutation({ mutationFn: readTaskNotification, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: readAllTaskNotifications, onSuccess: refresh });
  const workflow = useMutation({
    mutationFn: async (decision: WorkflowDecision) => {
      if (decision.action === "approve-request") {
        return approveTaskRequest(decision.taskId, "assigned");
      }
      if (decision.action === "reject-request") {
        return rejectTaskRequest(decision.taskId, decision.note);
      }
      if (decision.action === "approve-review") {
        return approveTaskReview(decision.taskId, decision.note);
      }
      return returnTaskReview(decision.taskId, decision.targetStage, decision.note);
    },
    onSuccess: async (_task, decision) => {
      await Promise.allSettled([
        readTaskNotification(decision.notificationId),
        queryClient.invalidateQueries({ queryKey: ["task-notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
      toast.success(
        decision.action.startsWith("approve")
          ? "Task approved"
          : decision.action === "reject-request"
            ? "Task request rejected"
            : "Task returned",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not update the task workflow"),
  });
  const unread = (notifications.data ?? []).filter((item) => !item.readAt).length;
  const taskById = new Map((tasks.data ?? []).map((task) => [task.id, task]));

  const openTask = (notificationId: string, taskId?: string) => {
    if (!(notifications.data ?? []).find((item) => item.id === notificationId)?.readAt) {
      readOne.mutate(notificationId);
    }
    if (taskId) void navigate({ to: "/projects", search: { taskId } });
  };

  return (
    <div className="studio-page-medium space-y-6">
      <PageHeader
        title="Notifications"
        description="Review task requests, assignments, comments and deadline alerts from one place."
        actions={
          <Button variant="outline" disabled={!unread} onClick={() => readAll.mutate()}>
            <CheckCheck className="mr-2 h-4 w-4" /> Mark all read
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          icon={Inbox}
          value={(notifications.data ?? []).length}
          label="All notifications"
          hint="Your activity inbox"
          tone="violet"
        />
        <MetricTile
          icon={Bell}
          value={unread}
          label="Unread"
          hint="Waiting for your attention"
          tone="pink"
        />
        <MetricTile
          icon={ListChecks}
          value={
            (notifications.data ?? []).filter((item) => item.workflowRequest?.status === "pending")
              .length
          }
          label="Pending actions"
          hint="Workflow decisions"
          tone="amber"
        />
      </div>
      <div className="space-y-2">
        {(notifications.data ?? []).map((item) => {
          const taskId = item.taskId ?? item.workflowRequest?.taskId;
          const task = taskId ? taskById.get(taskId) : undefined;
          const request = item.workflowRequest;
          const pendingRequest = request?.status === "pending" ? request : undefined;
          const isSelfReview =
            user?.role === "team_owner" &&
            Boolean(user.employeeId && task?.assigneeEmployeeId === user.employeeId);
          return (
            <Card
              key={item.id}
              role="button"
              tabIndex={0}
              className={`group cursor-pointer overflow-hidden p-4 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md ${item.readAt ? "opacity-70" : "border-[#e5185d]/30 bg-gradient-to-r from-[#fce3ec]/55 to-card dark:from-[#38142b]/55"}`}
              onClick={() => openTask(item.id, taskId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") openTask(item.id, taskId);
              }}
            >
              <div className="flex gap-3">
                <div className="mt-0.5 h-fit rounded-xl bg-[#fce3ec] p-2.5 text-[#e5185d] transition-transform group-hover:scale-105 dark:bg-[#38142b] dark:text-[#f0538b]">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{item.title}</p>
                    <time className="shrink-0 text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                  {request && request.requestNote && (
                    <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs">
                      Employee note: {request.requestNote}
                    </p>
                  )}
                  {pendingRequest && task && (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <WorkflowActions
                        request={pendingRequest}
                        task={task}
                        isSelfReview={isSelfReview}
                        pending={workflow.isPending}
                        onDecision={(decision) =>
                          workflow.mutate({ ...decision, notificationId: item.id })
                        }
                      />
                    </div>
                  )}
                  {request && request.status !== "pending" && (
                    <p className="mt-2 text-xs font-medium capitalize text-muted-foreground">
                      Request {request.status}
                      {request.returnStage
                        ? ` · returned to ${request.returnStage.replaceAll("_", " ")}`
                        : ""}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
        {!notifications.isLoading && !(notifications.data ?? []).length && (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            No task notifications yet.
          </Card>
        )}
      </div>
    </div>
  );
}

function WorkflowActions({
  request,
  task,
  isSelfReview,
  pending,
  onDecision,
}: {
  request: TaskWorkflowRequest;
  task: Task;
  isSelfReview: boolean;
  pending: boolean;
  onDecision: (decision: WorkflowDecisionInput) => void;
}) {
  const [note, setNote] = useState("");
  const [targetStage, setTargetStage] = useState<TaskReviewReturnStage>("in_progress");

  if (isSelfReview) {
    return (
      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
        You cannot review your own task. A General admin or another team manager must decide it.
      </p>
    );
  }

  if (request.requestType === "task_creation") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-background p-3">
        <Input
          className="min-w-52 flex-1"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Reason if rejecting"
        />
        <Button
          size="sm"
          disabled={pending}
          onClick={() => onDecision({ action: "approve-request", taskId: task.id })}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !note.trim()}
          onClick={() =>
            onDecision({ action: "reject-request", taskId: task.id, note: note.trim() })
          }
        >
          Reject
        </Button>
      </div>
    );
  }

  const checklistIncomplete = task.checklist.some((item) => !item.completed);
  return (
    <div className="mt-3 grid gap-2 rounded-md border bg-background p-3 lg:grid-cols-[minmax(180px,1fr)_auto_auto_auto]">
      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={checklistIncomplete ? "Approval reason or return note" : "Return note"}
      />
      <Button
        size="sm"
        disabled={pending || (checklistIncomplete && !note.trim())}
        onClick={() =>
          onDecision({
            action: "approve-review",
            taskId: task.id,
            note: note.trim() || undefined,
          })
        }
      >
        Approve & complete
      </Button>
      <Select
        value={targetStage}
        onValueChange={(value) => setTargetStage(value as TaskReviewReturnStage)}
      >
        <SelectTrigger className="h-9 w-44">
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
        disabled={pending || !note.trim()}
        onClick={() =>
          onDecision({
            action: "return-review",
            taskId: task.id,
            targetStage,
            note: note.trim(),
          })
        }
      >
        Return
      </Button>
    </div>
  );
}
