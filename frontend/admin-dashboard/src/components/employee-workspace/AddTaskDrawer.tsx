import { WorkspaceIcon } from "./WorkspaceIcon";
import { useEffect, useState } from "react";
import Drawer from "@/components/employee-workspace/Drawer";
import { PRIORITIES, type Priority } from "@/components/employee-workspace/model";
import { todayISO } from "@/components/employee-workspace/format";

export type NewTaskPayload = {
  name: string;
  description: string;
  outcome: string;
  project: string;
  team: string;
  priority: Priority;
  startDate: string;
  deadline: string;
};

type Props = {
  projects: { id: string; name: string }[];
  busy: boolean;
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: NewTaskPayload) => void;
};

const emptyForm: NewTaskPayload = {
  name: "",
  description: "",
  outcome: "",
  project: "",
  team: "",
  priority: "Medium",
  startDate: todayISO(),
  deadline: "",
};

export default function AddTaskDrawer({ open, onClose, onSubmit, projects, busy }: Props) {
  const [form, setForm] = useState<NewTaskPayload>(emptyForm);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ ...emptyForm, startDate: todayISO() });
      setError("");
    }
  }, [open]);

  const update = <K extends keyof NewTaskPayload>(key: K, value: NewTaskPayload[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = () => {
    if (!form.name.trim()) return setError("Give the task a name so your team can find it.");
    if (!form.project) return setError("Select an assigned project.");
    if (form.deadline && form.deadline < form.startDate)
      return setError("The deadline cannot be before the start date.");
    setError("");
    onSubmit({
      ...form,
      name: form.name.trim(),
      description: form.description.trim(),
      outcome: form.outcome.trim(),
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="New task"
      title="Add task"
      description="Describe the work, set the dates, and submit it for manager approval."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-ew-line px-3 py-2 text-[12.5px] font-semibold text-ew-ink-2 transition-colors hover:bg-ew-bg-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || projects.length === 0}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-ew-plum px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-ew-plum-2"
          >
            <WorkspaceIcon className="ri-send-plane-line text-[14px]" aria-hidden="true" />
            Submit task
          </button>
        </div>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div>
          <label htmlFor="new-task-name" className="k-field-label">
            Task name
          </label>
          <input
            id="new-task-name"
            className="k-input"
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            placeholder="What are you working on?"
            dir="auto"
            maxLength={120}
          />
        </div>

        <div>
          <label htmlFor="new-task-desc" className="k-field-label">
            Description
          </label>
          <textarea
            id="new-task-desc"
            className="k-textarea"
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
            placeholder="Expected outcome or useful context"
            maxLength={500}
          />
          <p className="mt-1 text-right font-ew-mono text-[9.5px] text-ew-faint">
            {form.description.length}/500
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="new-task-project" className="k-field-label">
              Project
            </label>
            <select
              id="new-task-project"
              className="k-select"
              value={form.project}
              onChange={(event) => update("project", event.target.value)}
            >
              <option value="">Select a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="new-task-priority" className="k-field-label">
              Priority
            </label>
            <select
              id="new-task-priority"
              className="k-select"
              value={form.priority}
              onChange={(event) => update("priority", event.target.value as Priority)}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="new-task-start" className="k-field-label">
              Start date
            </label>
            <input
              id="new-task-start"
              type="date"
              className="k-input"
              value={form.startDate}
              onChange={(event) => update("startDate", event.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="new-task-deadline" className="k-field-label">
            Deadline
          </label>
          <input
            id="new-task-deadline"
            type="date"
            className="k-input"
            value={form.deadline}
            onChange={(event) => update("deadline", event.target.value)}
          />
        </div>

        <div className="rounded-lg border border-ew-line bg-ew-bg-2 px-3 py-2">
          <p className="text-[11.5px] leading-snug text-ew-ink-2">
            New tasks follow your team's approval workflow. Tracked work and approved manual time
            are counted by the server.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-ew-bad-2 px-2.5 py-1.5 text-[11.5px] font-medium text-ew-bad"
          >
            {error}
          </p>
        ) : null}
      </form>
    </Drawer>
  );
}
