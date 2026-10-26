import type { ReactNode } from "react";
import type { ActivityEntry, Attendance } from "@/components/employee-workspace/model";
import { fmtClock, fmtSeconds } from "@/components/employee-workspace/format";

type Props = {
  attendance: Attendance;
  activity: ActivityEntry[];
  showActivity?: boolean;
};

export type WeekRow = {
  day: string;
  date: string;
  scheduled: string;
  payableMinutes: number;
  late: number;
  signOut: string | null;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-[7px]">
      <span className="text-[11.5px] text-ew-muted">{label}</span>
      <span className="text-right text-[12px] font-medium text-ew-ink-2">{children}</span>
    </div>
  );
}

export default function AttendancePanel({ attendance, activity, showActivity = true }: Props) {
  const activeSession = attendance.sessions.find((session) => session.end === null);

  return (
    <section className="k-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-ew-heading text-[13.5px] font-semibold text-ew-plum">
          Today's attendance
        </h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-semibold ${
            attendance.status === "active" ? "bg-ew-ok-2 text-ew-ok" : "bg-ew-bg-2 text-ew-muted"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${attendance.status === "active" ? "bg-ew-ok" : "bg-ew-dot"}`}
            aria-hidden="true"
          />
          {attendance.status === "active" ? "Shift active" : "No active shift"}
        </span>
      </div>

      <div className="mt-2 divide-y divide-ew-line-2">
        <Row label="Scheduled shift">
          <span className="k-mono text-[11.5px]">
            {attendance.shiftStart} – {attendance.shiftEnd}
          </span>
        </Row>
        <Row label="First activity">
          <span className="k-mono text-[11.5px]">{fmtClock(attendance.firstActivity)}</span>
        </Row>
        <Row label="Last activity">
          <span className="k-mono text-[11.5px]">{fmtClock(attendance.lastActivity)}</span>
        </Row>
        <Row label="Session">
          {activeSession ? (
            <span className="text-[11.5px]">
              Running since <span className="k-mono">{fmtClock(activeSession.start)}</span>
            </span>
          ) : (
            <span className="text-[11.5px]">No session yet</span>
          )}
        </Row>
        <Row label="Sign-out">
          <span className="text-[11.5px] text-ew-muted">
            {attendance.signOut ? fmtClock(attendance.signOut) : "No sign-out recorded"}
          </span>
        </Row>
        <Row label="Payable time">
          <span className="k-mono text-[13px] font-semibold text-ew-plum">
            {fmtSeconds(attendance.payableSeconds)}
          </span>
        </Row>
        <Row label="Late after grace">
          <span
            className={`text-[11.5px] ${attendance.lateMinutes > 0 ? "text-ew-warn" : "text-ew-ink-2"}`}
          >
            {attendance.lateMinutes} min
            <span className="text-ew-muted"> after {attendance.graceMinutes} min grace</span>
          </span>
        </Row>
        <Row label="Overtime">
          <span className="k-mono text-[11.5px]">
            {attendance.overtimeSeconds === 0 ? "0m" : fmtSeconds(attendance.overtimeSeconds)}
          </span>
        </Row>
      </div>

      <p className="mt-1.5 rounded-md bg-ew-bg-2 px-2 py-1.5 text-[10.5px] leading-snug text-ew-muted">
        Running status comes from recorded desktop activity. A missing sign-out alone does not mean
        absence.
      </p>

      {showActivity ? (
        <div className="mt-3 border-t border-ew-line pt-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-ew-heading text-[12.5px] font-semibold text-ew-plum">
              Today's activity
            </h3>
            <span className="font-ew-mono text-[10px] uppercase tracking-[0.08em] text-ew-muted">
              {activity.length} {activity.length === 1 ? "entry" : "entries"}
            </span>
          </div>

          {activity.length === 0 ? (
            <p className="mt-2 rounded-md border border-dashed border-ew-line px-2.5 py-2 text-[11.5px] text-ew-muted">
              No tracked activity for today.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2">
                  <span
                    className={`mt-1 h-1.5 w-1.5 flex-none rounded-full ${
                      entry.kind === "Worked"
                        ? "bg-ew-ok"
                        : entry.kind === "Idle"
                          ? "bg-ew-warn"
                          : "bg-ew-dot"
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-medium text-ew-ink-2" dir="auto">
                      {entry.task}
                    </p>
                    <p className="mt-0.5 font-ew-mono text-[10px] uppercase tracking-[0.06em] text-ew-faint">
                      {entry.from} – {entry.to} · {entry.kind}
                    </p>
                  </div>
                  <span className="k-mono flex-none text-[11px] text-ew-ink-2">
                    {fmtSeconds(entry.seconds)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
