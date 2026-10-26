import { WorkspaceIcon } from "./WorkspaceIcon";
import { useEffect, useState } from "react";
import Drawer from "@/components/employee-workspace/Drawer";
import { RequestStatusTag } from "@/components/employee-workspace/badges";
import type { RequestItem } from "@/components/employee-workspace/model";
import {
  fmtDate,
  fmtMinutes,
  todayISO,
  workingDaysBetween,
} from "@/components/employee-workspace/format";

export type ManualTimePayload = { date: string; minutes: number; reason: string };
export type HolidayPayload = { from: string; to: string; days: number; reason: string };

type Allowance = {
  annualTotal: number;
  annualRemaining: number;
};

export function ManualTimeDrawer({
  open,
  onClose,
  onSubmit,
  trackingPaused,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: ManualTimePayload) => void;
  trackingPaused: boolean;
  busy: boolean;
}) {
  const [date, setDate] = useState(todayISO());
  const [minutes, setMinutes] = useState("30");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setDate(todayISO());
      setMinutes("30");
      setReason("");
      setError("");
    }
  }, [open]);

  const submit = () => {
    const parsed = Number(minutes);
    if (!date) return setError("Pick the date the time belongs to.");
    if (!Number.isFinite(parsed) || parsed < 5 || parsed > 480) {
      return setError("Enter between 5 and 480 minutes.");
    }
    if (reason.trim().length < 10) {
      return setError("Add a short reason (at least 10 characters).");
    }
    setError("");
    onSubmit({ date, minutes: Math.round(parsed), reason: reason.trim() });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Requests · manual time"
      title="Request time"
      description="Explain minutes that were not tracked. Your manager reviews every claim."
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
            disabled={busy}
            onClick={submit}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-ew-plum px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-ew-plum-2"
          >
            <WorkspaceIcon className="ri-send-plane-line text-[13px]" aria-hidden="true" />
            Submit request
          </button>
        </div>
      }
    >
      {trackingPaused ? (
        <div className="mb-3 rounded-lg border border-ew-warn-2 bg-ew-warn-2 px-3 py-2">
          <p className="text-[12px] font-semibold text-ew-warn">Tracking is paused right now</p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-ew-ink-2">
            You can submit a request while tracking is paused. Your manager reviews the requested
            minutes before they count.
          </p>
        </div>
      ) : null}

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="manual-date" className="k-field-label">
              Date
            </label>
            <input
              id="manual-date"
              type="date"
              className="k-input"
              value={date}
              max={todayISO()}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="manual-minutes" className="k-field-label">
              Minutes
            </label>
            <input
              id="manual-minutes"
              type="number"
              min={5}
              max={480}
              step={5}
              className="k-input"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="manual-reason" className="k-field-label">
            Reason
          </label>
          <textarea
            id="manual-reason"
            className="k-textarea"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Client call ran past the shift end, tracking was paused at 18:02"
            maxLength={500}
          />
          <p className="mt-1 text-right font-ew-mono text-[9.5px] text-ew-faint">
            {reason.length}/500
          </p>
        </div>

        <div className="rounded-lg border border-ew-line bg-ew-bg-2 px-3 py-2">
          <p className="text-[11.5px] leading-snug text-ew-ink-2">
            Pending minutes are <strong>not counted</strong>. They only enter your total after a
            manager approves the request — a rejected claim never affects counted time.
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

export function HolidayDrawer({
  open,
  onClose,
  onSubmit,
  allowance,
  workingDays,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: HolidayPayload) => void;
  allowance: Allowance;
  workingDays?: number[] | null;
  busy: boolean;
}) {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setFrom(todayISO());
      setTo(todayISO());
      setReason("");
      setError("");
    }
  }, [open]);

  const days = workingDaysBetween(from, to, workingDays);

  const submit = () => {
    if (!from || !to) return setError("Pick both dates.");
    if (to < from) return setError("The end date cannot be before the start date.");
    if (days === 0) return setError("That range has no working days.");
    if (days > allowance.annualRemaining) {
      return setError(`Only ${allowance.annualRemaining} days remain in your allowance.`);
    }
    setError("");
    onSubmit({ from, to, days, reason: reason.trim() });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Requests · holiday"
      title="Request holiday"
      description="Request leave from your annual allowance. Working days follow your assigned schedule."
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
            disabled={busy}
            onClick={submit}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-ew-plum px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-ew-plum-2"
          >
            <WorkspaceIcon className="ri-calendar-check-line text-[13px]" aria-hidden="true" />
            Submit holiday
          </button>
        </div>
      }
    >
      <div className="rounded-xl border border-ew-line bg-ew-bg-2 px-3.5 py-3">
        <p className="k-label">Current remaining allowance</p>
        <p className="mt-1 font-ew-heading text-[26px] font-semibold leading-none text-ew-plum">
          {allowance.annualRemaining}{" "}
          <span className="text-[13px] font-medium text-ew-muted">
            of {allowance.annualTotal} days
          </span>
        </p>
        <div className="k-bar mt-2" aria-hidden="true">
          <span
            style={{
              width: `${allowance.annualTotal > 0 ? Math.min(100, Math.round((allowance.annualRemaining / allowance.annualTotal) * 100)) : 0}%`,
            }}
          />
        </div>
      </div>

      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="holiday-from" className="k-field-label">
              From
            </label>
            <input
              id="holiday-from"
              type="date"
              className="k-input"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="holiday-to" className="k-field-label">
              To
            </label>
            <input
              id="holiday-to"
              type="date"
              className="k-input"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-ew-line px-3 py-2">
          <span className="text-[11.5px] text-ew-muted">Working days requested</span>
          <span className="k-mono text-[13px] font-semibold text-ew-plum">{days}</span>
        </div>

        <div>
          <label htmlFor="holiday-reason" className="k-field-label">
            Reason <span className="normal-case tracking-normal text-ew-faint">(optional)</span>
          </label>
          <textarea
            id="holiday-reason"
            className="k-textarea"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Family trip, booked around the weekend"
            maxLength={500}
          />
          <p className="mt-1 text-right font-ew-mono text-[9.5px] text-ew-faint">
            {reason.length}/500
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

export function RequestDetailDrawer({
  open,
  request,
  onClose,
}: {
  open: boolean;
  request: RequestItem | null;
  onClose: () => void;
}) {
  if (!request) return null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={`Requests · ${request.type}`}
      title={request.title}
      description={`Submitted ${request.submittedAt}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <RequestStatusTag status={request.status} />
        <span
          className={`rounded px-1.5 py-[2px] text-[10px] font-semibold ${
            request.counted ? "bg-ew-ok-2 text-ew-ok" : "bg-ew-bg-2 text-ew-muted"
          }`}
        >
          {request.counted ? "COUNTED" : "NOT COUNTED"}
        </span>
      </div>

      {request.type === "Manual time" && request.status === "Approved" ? (
        <p className="mt-3 rounded-lg bg-ew-ok-2 p-3 text-sm text-ew-ok">
          Approved time: {fmtMinutes(request.approvedMinutes ?? request.minutes ?? 0)}
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-ew-line px-2.5 py-2">
          <p className="k-label">Date</p>
          <p className="mt-1 text-[12px] font-medium text-ew-ink-2">{fmtDate(request.date)}</p>
        </div>
        <div className="rounded-lg border border-ew-line px-2.5 py-2">
          <p className="k-label">Requested duration</p>
          <p className="mt-1 font-ew-mono text-[12px] font-semibold text-ew-plum">
            {request.days ? `${request.days} days` : fmtMinutes(request.minutes ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-ew-line px-2.5 py-2">
          <p className="k-label">Manager</p>
          <p className="mt-1 text-[12px] font-medium text-ew-ink-2">{request.manager}</p>
        </div>
        <div className="rounded-lg border border-ew-line px-2.5 py-2">
          <p className="k-label">Reference</p>
          <p className="mt-1 font-ew-mono text-[11px] text-ew-ink-2">{request.id.toUpperCase()}</p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-ew-line bg-ew-bg-2 px-3 py-2.5">
        <p className="k-label">Reason on file</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ew-ink-2">{request.reason}</p>
      </div>

      {request.status === "Pending" ? (
        <p className="mt-2 text-[11.5px] leading-snug text-ew-muted">
          This request is still waiting for {request.manager}. Until it is approved, the minutes
          stay out of your counted total.
        </p>
      ) : null}
    </Drawer>
  );
}
