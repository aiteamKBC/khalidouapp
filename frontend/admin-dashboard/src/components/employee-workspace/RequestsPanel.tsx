import { WorkspaceIcon } from "./WorkspaceIcon";
import type { RequestItem } from "@/components/employee-workspace/model";
import { RequestStatusTag } from "@/components/employee-workspace/badges";
import { fmtDate, fmtMinutes } from "@/components/employee-workspace/format";

type Allowance = {
  annualTotal: number;
  annualRemaining: number;
};

type Props = {
  requests: RequestItem[];
  allowance: Allowance;
  onRequestTime: () => void;
  onRequestHoliday: () => void;
  onView: (id: string) => void;
};

export default function RequestsPanel({
  requests,
  allowance,
  onRequestTime,
  onRequestHoliday,
  onView,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <article className="k-card flex flex-col p-3.5">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-ew-pink-2 text-ew-pink">
              <WorkspaceIcon className="ri-timer-line text-[17px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-ew-heading text-[13.5px] font-semibold text-ew-plum">
                Request time
              </h2>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ew-muted">
                Claim minutes for a period when tracking was paused. Pending time is not counted
                until a manager approves it.
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-ew-bg-2 px-1.5 py-[3px] font-ew-mono text-[10px] uppercase tracking-[0.06em] text-ew-ink-2">
              manager approval required
            </span>
          </div>
          <button
            type="button"
            onClick={onRequestTime}
            className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-ew-plum px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-ew-plum-2"
          >
            <WorkspaceIcon className="ri-add-line text-[14px]" aria-hidden="true" />
            Request time
          </button>
        </article>

        <article className="k-card flex flex-col p-3.5">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-ew-plum text-white">
              <WorkspaceIcon className="ri-calendar-event-line text-[16px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-ew-heading text-[13.5px] font-semibold text-ew-plum">
                Request holiday
              </h2>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ew-muted">
                Request leave from your annual allowance. Your work schedule and approved requests
                determine the balance.
              </p>
            </div>
          </div>
          <div className="mt-2.5 rounded-md border border-ew-line bg-ew-bg-2 px-2 py-1.5">
            <p className="flex items-baseline justify-between gap-2">
              <span className="font-ew-mono text-[9.5px] uppercase tracking-[0.08em] text-ew-muted">
                Remaining allowance
              </span>
              <span className="k-mono text-[12px] font-semibold text-ew-plum">
                {allowance.annualRemaining} of {allowance.annualTotal} days
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onRequestHoliday}
            className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-ew-plum bg-white px-3 py-2 text-[12.5px] font-semibold text-ew-plum transition-colors hover:bg-ew-bg-2"
          >
            <WorkspaceIcon className="ri-calendar-check-line text-[14px]" aria-hidden="true" />
            Request holiday
          </button>
        </article>
      </div>

      <section className="k-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ew-line px-3.5 py-2.5">
          <div>
            <h2 className="font-ew-heading text-[13.5px] font-semibold text-ew-plum">
              Request history
            </h2>
            <p className="mt-0.5 text-[11px] text-ew-muted">
              {requests.length} requests · newest first
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-md bg-ew-warn-2 px-1.5 py-[3px] text-[10.5px] font-semibold text-ew-warn">
              {requests.filter((item) => item.status === "Pending").length} pending
            </span>
            <span className="rounded-md bg-ew-ok-2 px-1.5 py-[3px] text-[10.5px] font-semibold text-ew-ok">
              {requests.filter((item) => item.status === "Approved").length} approved
            </span>
          </div>
        </div>

        {requests.length === 0 ? (
          <div className="px-4 py-7 text-center">
            <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-ew-bg-2 text-ew-muted">
              <WorkspaceIcon className="ri-inbox-line text-[18px]" aria-hidden="true" />
            </span>
            <p className="mt-2 text-[12.5px] font-semibold text-ew-ink">No requests yet</p>
            <p className="mt-0.5 text-[11.5px] text-ew-muted">
              Requests you submit will be listed here with their approval state.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="k-table">
                <thead>
                  <tr>
                    <th scope="col">Request</th>
                    <th scope="col">Date</th>
                    <th scope="col" className="text-right">
                      Duration
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Submitted</th>
                    <th scope="col" className="text-right">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span className="block text-[12.5px] font-semibold text-ew-ink">
                          {item.title}
                        </span>
                        <span className="mt-0.5 block font-ew-mono text-[10px] uppercase tracking-[0.06em] text-ew-faint">
                          {item.type}
                        </span>
                      </td>
                      <td>
                        <span className="k-mono text-[11.5px] text-ew-ink-2">
                          {fmtDate(item.date)}
                        </span>
                      </td>
                      <td className="text-right">
                        <span className="k-mono text-[11.5px] text-ew-ink-2">
                          {item.days ? `${item.days} days` : fmtMinutes(item.minutes ?? 0)}
                        </span>
                      </td>
                      <td>
                        <RequestStatusTag status={item.status} />
                      </td>
                      <td>
                        <span className="text-[11px] text-ew-muted">{item.submittedAt}</span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => onView(item.id)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ew-line bg-white px-1.5 py-1 text-[11px] font-semibold text-ew-ink-2 transition-colors hover:border-ew-plum-2 hover:text-ew-plum"
                        >
                          View details
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
              {requests.map((item) => (
                <li key={item.id} className="px-3.5 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-ew-ink">{item.title}</p>
                      <p className="mt-0.5 font-ew-mono text-[10px] uppercase tracking-[0.06em] text-ew-faint">
                        {item.type} · {fmtDate(item.date)}
                      </p>
                    </div>
                    <RequestStatusTag status={item.status} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="k-mono text-[11px] text-ew-ink-2">
                      {item.days ? `${item.days} days` : fmtMinutes(item.minutes ?? 0)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onView(item.id)}
                      className="cursor-pointer text-[11.5px] font-semibold text-ew-pink hover:underline"
                    >
                      View details
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
