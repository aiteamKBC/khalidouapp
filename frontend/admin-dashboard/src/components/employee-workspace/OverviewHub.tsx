import { useQuery } from "@tanstack/react-query";
import { employeeScreenshots } from "@/api/employee-portal";
import { retryTransientRequest } from "@/api/client";
import { ProtectedImage } from "@/components/ProtectedImage";
import { jwtSubjectScopeKey } from "@/lib/private-query-scope";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { RequestStatusTag } from "./badges";
import type { Attendance, RequestItem, Task } from "./model";
import type { TabKey } from "./Tabs";
import "./overview.css";

export default function OverviewHub({
  token,
  day,
  tasks,
  requests,
  attendance,
  onOpenTab,
  onOpenRequest,
}: {
  token: string;
  day: string;
  tasks: Task[];
  requests: RequestItem[];
  attendance: Attendance;
  onOpenTab: (tab: TabKey) => void;
  onOpenRequest: (id: string) => void;
}) {
  const shots = useQuery({
    queryKey: ["employee-portal", jwtSubjectScopeKey(token), "screenshots", day],
    queryFn: ({ signal }) => employeeScreenshots(token, day, signal),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: retryTransientRequest,
  });
  const pending = requests.filter((item) => item.status === "Pending").length;
  const attention: { label: string; count: number; tab: TabKey }[] = [
    {
      label: "tasks waiting for sign-off",
      count: tasks.filter((task) => task.approval === "Pending").length,
      tab: "tasks",
    },
    { label: "requests still pending", count: pending, tab: "requests" },
    { label: "minutes late after grace", count: attendance.lateMinutes, tab: "attendance" },
  ].filter((item) => item.count > 0) as { label: string; count: number; tab: TabKey }[];
  return (
    <section aria-labelledby="hub-title" className="ew-overview-hub">
      <div className="ew-overview-heading">
        <div>
          <h2 id="hub-title">Everything else, at a glance</h2>
          <p>A live summary of your workspace. Open a card to see the full detail.</p>
        </div>
        <span className="ew-overview-date">{day}</span>
      </div>
      <div className="ew-overview-grid">
        <article className="k-card ew-hub-card ew-hub-brand">
          <header>
            <span className="ew-hub-icon">
              <WorkspaceIcon className="ri-inbox-line" />
            </span>
            <div>
              <h3>Requests</h3>
              <p>
                {pending} pending · {requests.length} total
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenTab("requests")}
              aria-label="View all requests"
            >
              ↗
            </button>
          </header>
          <div className="ew-hub-body">
            {requests.length ? (
              requests.slice(0, 2).map((request) => (
                <button
                  key={request.id}
                  type="button"
                  className="ew-hub-row"
                  onClick={() => onOpenRequest(request.id)}
                >
                  <span>
                    <strong>{request.title}</strong>
                    <small>{request.date}</small>
                  </span>
                  <RequestStatusTag status={request.status} />
                </button>
              ))
            ) : (
              <p className="ew-hub-empty">
                No requests yet. Your time and holiday requests will appear here.
              </p>
            )}
          </div>
          <button type="button" className="ew-hub-link" onClick={() => onOpenTab("requests")}>
            Manage requests <span>→</span>
          </button>
        </article>
        <article className="k-card ew-hub-card ew-hub-green">
          <header>
            <span className="ew-hub-icon">
              <WorkspaceIcon className="ri-notification-3-line" />
            </span>
            <div>
              <h3>Needs your attention</h3>
              <p>
                {attention.length ? `${attention.length} items to review` : "You're all caught up"}
              </p>
            </div>
          </header>
          <div className="ew-hub-body">
            {attention.length ? (
              attention.map((item) => (
                <button
                  type="button"
                  className="ew-attention-row"
                  key={item.tab}
                  onClick={() => onOpenTab(item.tab)}
                >
                  <strong>{item.count}</strong>
                  <span>{item.label}</span>
                  <span>→</span>
                </button>
              ))
            ) : (
              <p className="ew-hub-empty">
                Nothing needs your attention right now. Keep up the good work.
              </p>
            )}
          </div>
          <span className="ew-hub-footnote">Updated with your latest account activity</span>
        </article>
        <article className="k-card ew-hub-card ew-hub-rose">
          <header>
            <span className="ew-hub-icon">
              <WorkspaceIcon className="ri-image-line" />
            </span>
            <div>
              <h3>Screenshots</h3>
              <p>Today's workplace captures</p>
            </div>
            <button
              type="button"
              onClick={() => onOpenTab("screenshots")}
              aria-label="Open screenshot gallery"
            >
              ↗
            </button>
          </header>
          <div className="ew-hub-body">
            {shots.isPending ? (
              <p role="status" className="ew-hub-empty">
                Loading captures…
              </p>
            ) : null}
            {shots.isError ? (
              <p role="alert" className="ew-hub-empty">
                Could not load captures.{" "}
                <button type="button" className="underline" onClick={() => void shots.refetch()}>
                  Retry
                </button>
              </p>
            ) : null}
            {shots.data?.length === 0 ? (
              <p className="ew-hub-empty">No captures for today yet.</p>
            ) : null}
            <div className="ew-hub-shots">
              {(shots.data ?? []).slice(0, 3).map((shot) => (
                <button
                  type="button"
                  key={shot.id}
                  onClick={() => onOpenTab("screenshots")}
                  aria-label="View captured screenshot"
                >
                  <ProtectedImage
                    src={shot.thumbnailUrl || shot.fullUrl}
                    authToken={token}
                    alt="Work screenshot"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="ew-hub-link" onClick={() => onOpenTab("screenshots")}>
            Open gallery <span>{shots.data?.length ?? "—"} captures →</span>
          </button>
        </article>
      </div>
    </section>
  );
}
