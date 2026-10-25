import { WorkspaceIcon } from "./WorkspaceIcon";
import { useEffect, useRef, useState } from "react";
import Drawer from "@/components/employee-workspace/Drawer";
import { ApprovalBadge, PriorityTag, StatusTag } from "@/components/employee-workspace/badges";
import { TASK_STATUSES, type Task, type TaskStatus } from "@/components/employee-workspace/model";
import { fmtDate, fmtSeconds } from "@/components/employee-workspace/format";

type Props = {
  task: Task | null;
  busy: boolean;
  workspaceLoading: boolean;
  open: boolean;
  onClose: () => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onToggleChecklist: (taskId: string, itemId: string) => void;
  onAddChecklist: (taskId: string, text: string) => Promise<boolean>;
  onAddComment: (taskId: string, body: string) => Promise<boolean>;
  onUpload: (taskId: string, file: File) => void;
};

export default function TaskDrawer({
  task,
  busy,
  workspaceLoading,
  open,
  onClose,
  onStatusChange,
  onToggleChecklist,
  onAddChecklist,
  onAddComment,
  onUpload,
}: Props) {
  const [itemText, setItemText] = useState("");
  const [commentText, setCommentText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setItemText("");
    setCommentText("");
  }, [task?.id]);

  if (!task) return null;

  const done = task.checklist.filter((item) => item.done).length;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow={`${task.project} · ${task.team}`}
      title={task.name}
      description={`Task ${task.id.toUpperCase()} · started ${fmtDate(task.startDate)} · due ${fmtDate(task.deadline)}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityTag priority={task.priority} />
        <StatusTag status={task.status} />
        <span className="hidden text-[11px] text-ew-muted sm:inline">Approval</span>
        <ApprovalBadge state={task.approval} />
      </div>

      {workspaceLoading ? (
        <p role="status" className="mt-3 text-ew-muted">
          Loading comments and attachments…
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-ew-line px-2.5 py-2">
          <p className="k-label">Worked</p>
          <p className="mt-1 font-ew-mono text-[13px] font-semibold text-ew-plum">
            {fmtSeconds(task.workedSeconds)}
          </p>
        </div>
        <div className="rounded-lg border border-ew-line px-2.5 py-2">
          <p className="k-label">Start</p>
          <p className="mt-1 text-[12px] font-medium text-ew-ink-2">{fmtDate(task.startDate)}</p>
        </div>
        <div className="rounded-lg border border-ew-line px-2.5 py-2">
          <p className="k-label">Deadline</p>
          <p className="mt-1 text-[12px] font-medium text-ew-ink-2">{fmtDate(task.deadline)}</p>
        </div>
        <div className="rounded-lg border border-ew-line px-2.5 py-2">
          <p className="k-label">Checklist</p>
          <p className="mt-1 font-ew-mono text-[13px] font-semibold text-ew-plum">
            {done}/{task.checklist.length}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-ew-line bg-ew-bg-2 px-3 py-2.5">
        <label htmlFor="task-status" className="k-label">
          Workflow status
        </label>
        <select
          id="task-status"
          disabled={
            busy ||
            !task.canUpdateStatus ||
            ["new_requests", "ready_for_review", "completed", "rejected", "cancelled"].includes(
              task.stage,
            )
          }
          value={task.status}
          onChange={(event) => onStatusChange(task.id, event.target.value as TaskStatus)}
          className="k-select mt-1 bg-white"
        >
          {TASK_STATUSES.filter(
            (status) =>
              status === task.status ||
              (status !== "Completed" && (task.stage !== "blocked" || status === "In progress")),
          ).map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-ew-muted">
          Work submitted for review requires manager approval
          {task.approvalNote ? ` · ${task.approvalNote}` : ""}.
        </p>
      </div>

      <section className="mt-4">
        <h3 className="k-label">Description</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ew-ink-2">{task.description}</p>
      </section>

      <section className="mt-4">
        <div className="flex items-center justify-between">
          <h3 className="k-label">Checklist</h3>
          <span className="font-ew-mono text-[10px] text-ew-muted">
            {done} of {task.checklist.length} done
          </span>
        </div>
        {task.checklist.length === 0 ? (
          <p className="mt-1 text-[11.5px] text-ew-muted">
            No checklist items yet. Add the first step below.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {task.checklist.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <input
                  id={`check-${item.id}`}
                  type="checkbox"
                  className="k-check mt-0.5"
                  checked={item.done}
                  disabled={busy || ["completed", "rejected", "cancelled"].includes(task.stage)}
                  onChange={() => onToggleChecklist(task.id, item.id)}
                />
                <label
                  htmlFor={`check-${item.id}`}
                  className={`cursor-pointer text-[12.5px] leading-snug ${
                    item.done ? "text-ew-muted line-through" : "text-ew-ink-2"
                  }`}
                  dir="auto"
                >
                  {item.text}
                </label>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={async (event) => {
            event.preventDefault();
            const value = itemText.trim();
            if (!value) return;
            if (await onAddChecklist(task.id, value)) setItemText("");
          }}
        >
          <input
            className="k-input"
            value={itemText}
            onChange={(event) => setItemText(event.target.value)}
            placeholder="Add a checklist item"
            aria-label="New checklist item"
            maxLength={120}
          />
          <button
            disabled={busy}
            type="submit"
            className="flex h-9 flex-none cursor-pointer items-center gap-1 rounded-md bg-ew-plum px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-ew-plum-2"
          >
            <WorkspaceIcon className="ri-add-line text-[14px]" aria-hidden="true" />
            Add
          </button>
        </form>
      </section>

      <section className="mt-4">
        <h3 className="k-label">Comments · {task.comments.length}</h3>
        {task.comments.length === 0 ? (
          <p className="mt-1 text-[11.5px] text-ew-muted">No comments yet.</p>
        ) : (
          <ul className="mt-1.5 space-y-2.5">
            {task.comments.map((comment) => (
              <li key={comment.id} className="flex gap-2">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-ew-plum text-[9.5px] font-semibold text-white">
                  {comment.initials}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[11.5px] font-semibold text-ew-ink">
                      {comment.author}
                    </span>
                    <span className="font-ew-mono text-[9.5px] uppercase tracking-[0.06em] text-ew-faint">
                      {comment.at}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ew-ink-2" dir="auto">
                    {comment.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const value = commentText.trim();
            if (!value) return;
            if (await onAddComment(task.id, value)) setCommentText("");
          }}
        >
          <textarea
            className="k-textarea min-h-[62px]"
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            placeholder="Add a comment for your manager"
            aria-label="New comment"
            maxLength={500}
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="font-ew-mono text-[9.5px] text-ew-faint">
              {commentText.length}/500
            </span>
            <button
              disabled={busy}
              type="submit"
              className="flex cursor-pointer items-center gap-1 rounded-md border border-ew-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ew-plum transition-colors hover:bg-ew-bg-2"
            >
              <WorkspaceIcon className="ri-chat-3-line text-[13px]" aria-hidden="true" />
              Add comment
            </button>
          </div>
        </form>
      </section>

      <section className="mt-4 pb-2">
        <div className="flex items-center justify-between">
          <h3 className="k-label">Attachments · {task.attachments.length}</h3>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="flex cursor-pointer items-center gap-1 rounded-md border border-ew-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ew-plum transition-colors hover:bg-ew-bg-2"
          >
            <WorkspaceIcon className="ri-upload-2-line text-[13px]" aria-hidden="true" />
            Upload file
          </button>
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(task.id, file);
              event.target.value = "";
            }}
          />
        </div>
        {task.attachments.length === 0 ? (
          <p className="mt-1 text-[11.5px] text-ew-muted">No files attached to this task.</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {task.attachments.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-lg border border-ew-line px-2.5 py-1.5"
              >
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded bg-ew-pink-2 text-ew-pink">
                  <WorkspaceIcon className="ri-file-text-line text-[13px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ew-ink-2">
                  {file.name}
                </span>
                <span className="k-mono text-[10px] text-ew-muted">{file.size}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}
