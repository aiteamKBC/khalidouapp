import { WorkspaceIcon } from "./WorkspaceIcon";
import type { Task } from "@/components/employee-workspace/model";
import { ApprovalBadge, PriorityTag, StatusTag } from "@/components/employee-workspace/badges";
import { fmtSeconds } from "@/components/employee-workspace/format";

type Pagination = {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
};

type Props = {
  tasks: Task[];
  onOpen: (id: string) => void;
  emptyTitle?: string;
  emptyBody?: string;
  pagination?: Pagination;
};

export default function TaskTable({
  tasks,
  onOpen,
  emptyTitle = "No tasks yet",
  emptyBody = "Tasks you create will appear here with their status and approval state.",
  pagination,
}: Props) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-8 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ew-bg-2 text-ew-muted">
          <WorkspaceIcon className="ri-task-line text-[18px]" aria-hidden="true" />
        </span>
        <p className="mt-2 text-[12.5px] font-semibold text-ew-ink">{emptyTitle}</p>
        <p className="mt-0.5 max-w-[280px] text-[11.5px] leading-snug text-ew-muted">{emptyBody}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="hidden overflow-x-auto md:block">
        <table className="k-table">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col" className="w-[86px]">
                Priority
              </th>
              <th scope="col" className="w-[124px]">
                Status
              </th>
              <th scope="col" className="w-[132px]">
                Approval
              </th>
              <th scope="col" className="w-[74px] text-right">
                Worked
              </th>
              <th scope="col" className="w-[78px] text-right">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <button
                    type="button"
                    onClick={() => onOpen(task.id)}
                    className="block max-w-[440px] cursor-pointer text-left"
                  >
                    <span
                      className="block truncate text-[13px] font-semibold text-ew-ink hover:text-ew-pink"
                      dir="auto"
                    >
                      {task.name}
                    </span>
                    <span className="mt-0.5 block truncate font-ew-mono text-[10px] uppercase tracking-[0.06em] text-ew-faint">
                      {task.project} · {task.team}
                    </span>
                  </button>
                </td>
                <td>
                  <PriorityTag priority={task.priority} />
                </td>
                <td>
                  <StatusTag status={task.status} />
                </td>
                <td>
                  <ApprovalBadge state={task.approval} />
                </td>
                <td className="text-right">
                  <span className="k-mono text-[12px] text-ew-ink-2">
                    {fmtSeconds(task.workedSeconds)}
                  </span>
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => onOpen(task.id)}
                    aria-label={`Open details for ${task.name}`}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ew-line bg-white px-1.5 py-1 text-[11px] font-semibold text-ew-ink-2 transition-colors hover:border-ew-plum-2 hover:text-ew-plum"
                  >
                    Details
                    <WorkspaceIcon
                      className="ri-arrow-right-up-line text-[12px]"
                      aria-hidden="true"
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-ew-line-2 md:hidden">
        {tasks.map((task) => (
          <li key={task.id} className="py-2.5">
            <button
              type="button"
              onClick={() => onOpen(task.id)}
              className="block w-full cursor-pointer text-left"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-[13px] font-semibold text-ew-ink" dir="auto">
                  {task.name}
                </span>
                <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center text-ew-muted">
                  <WorkspaceIcon
                    className="ri-arrow-right-up-line text-[13px]"
                    aria-hidden="true"
                  />
                </span>
              </span>
              <span className="mt-0.5 block font-ew-mono text-[10px] uppercase tracking-[0.06em] text-ew-faint">
                {task.project} · {task.team} · {fmtSeconds(task.workedSeconds)} worked
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <PriorityTag priority={task.priority} />
                <StatusTag status={task.status} />
                <ApprovalBadge state={task.approval} />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {pagination ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ew-line px-1 pt-2.5">
          <p className="font-ew-mono text-[10.5px] uppercase tracking-[0.08em] text-ew-muted">
            {pagination.total} tasks · page {pagination.page} of {pagination.pageCount}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-ew-line px-2 text-[11.5px] font-semibold text-ew-ink-2 transition-colors hover:bg-ew-bg-2 disabled:cursor-default disabled:opacity-40"
            >
              <WorkspaceIcon className="ri-arrow-left-s-line text-[13px]" aria-hidden="true" />
              Prev
            </button>
            <button
              type="button"
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.pageCount}
              className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-ew-line px-2 text-[11.5px] font-semibold text-ew-ink-2 transition-colors hover:bg-ew-bg-2 disabled:cursor-default disabled:opacity-40"
            >
              Next
              <WorkspaceIcon className="ri-arrow-right-s-line text-[13px]" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
