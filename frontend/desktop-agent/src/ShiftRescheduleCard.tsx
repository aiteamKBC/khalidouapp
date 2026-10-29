import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  rescheduleEndTime,
  shiftRescheduleStatusLabel,
  upcomingWorkingDates,
  validateShiftRescheduleInput,
} from "./shiftReschedule";
import type {
  ShiftRescheduleDay,
  ShiftReschedulesPayload,
} from "./types/electron";

function formatDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * Request a one-day shift move to a same-length range. Self-contained: it loads
 * its own data through IPC and keeps nothing in the shared runtime status.
 */
export function ShiftRescheduleCard({ enrolled }: { enrolled: boolean }) {
  const [payload, setPayload] = useState<ShiftReschedulesPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState("");
  const [day, setDay] = useState<ShiftRescheduleDay | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enrolled || !window.khaliduo?.listShiftReschedules) return;
    try {
      const result = await window.khaliduo.listShiftReschedules();
      if (result.success && result.data) {
        setPayload(result.data);
        setLoadError(null);
      } else {
        setLoadError(result.message ?? "Could not load shift reschedules.");
      }
    } catch {
      setLoadError("Could not load shift reschedules.");
    }
  }, [enrolled]);

  useEffect(() => {
    void load();
  }, [load]);

  const dateOptions = useMemo(
    () =>
      payload
        ? upcomingWorkingDates(
            payload.policy.earliest_date,
            payload.policy.working_days,
            30,
          )
        : [],
    [payload],
  );

  useEffect(() => {
    if (!workDate || !window.khaliduo?.getShiftRescheduleDay) {
      setDay(null);
      return;
    }
    let cancelled = false;
    setDayError(null);
    window.khaliduo
      .getShiftRescheduleDay(workDate)
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data) {
          setDay(result.data);
          if (!result.data.scheduled_day) {
            setDayError("That day is not a scheduled working day.");
          }
        } else {
          setDay(null);
          setDayError(result.message ?? "Could not load your shift for that day.");
        }
      })
      .catch(() => {
        if (!cancelled) setDayError("Could not load your shift for that day.");
      });
    return () => {
      cancelled = true;
    };
  }, [workDate]);

  if (!enrolled) return null;

  const shiftMinutes = day?.scheduled_day ? day.shift_minutes : 0;
  const computedEnd = start && shiftMinutes ? rescheduleEndTime(start, shiftMinutes) : null;
  const hours = Math.floor(shiftMinutes / 60);
  const minutes = shiftMinutes % 60;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!payload || !day) {
      setError("Choose the day you want to reschedule.");
      return;
    }
    const problem = validateShiftRescheduleInput({
      workDate,
      start,
      reason,
      earliestDate: payload.policy.earliest_date,
      workingDays: payload.policy.working_days,
      shiftMinutes,
      normalStart: day.shift_start,
    });
    if (problem || !computedEnd) {
      setError(problem ?? "The new shift must end on the same day.");
      return;
    }
    const api = window.khaliduo;
    if (!api) {
      setError("Device must be enrolled before sending a request.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.createShiftReschedule({
        workDate,
        requestedStart: start,
        requestedEnd: computedEnd,
        reason: reason.trim(),
      });
      if (!result.success) {
        setError(result.message ?? "Shift reschedule request failed.");
        return;
      }
      setStart("");
      setReason("");
      setWorkDate("");
      setSuccess("Shift reschedule sent to HR for review.");
      await load();
    } catch {
      setError("Shift reschedule request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(requestId: string) {
    setError(null);
    setSuccess(null);
    const api = window.khaliduo;
    if (!api) return;
    setCancellingId(requestId);
    try {
      const result = await api.cancelShiftReschedule(requestId);
      if (!result.success) {
        setError(result.message ?? "Could not cancel the request.");
      } else {
        setSuccess("Shift reschedule cancelled.");
      }
      await load();
    } catch {
      setError("Could not cancel the request.");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <section className="k-panel k-request-card k-shift-reschedule">
      <header className="k-request-card-header">
        <div>
          <h2>Shift reschedule</h2>
          <p className="k-muted">
            Work a different time on one day. The new time must be the same
            length as your normal shift, end before midnight, and be requested
            at least {payload?.policy.notice_days ?? 2} days ahead. HR reviews
            it; if it is still pending when the day starts, your normal shift
            applies.
          </p>
        </div>
      </header>
      {loadError && <p className="k-error">{loadError}</p>}
      <form className="k-form" onSubmit={handleSubmit}>
        <div className="k-form-grid">
          <label>
            Day
            <select
              value={workDate}
              onChange={(event) => {
                setWorkDate(event.target.value);
                setError(null);
                setSuccess(null);
              }}
              disabled={submitting || !dateOptions.length}
              required
            >
              <option value="">Choose a working day</option>
              {dateOptions.map((option) => (
                <option key={option} value={option}>
                  {formatDateLabel(option)} ({option})
                </option>
              ))}
            </select>
          </label>
          <label>
            New start time
            <input
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              disabled={submitting || !day?.scheduled_day}
              required
            />
          </label>
        </div>
        {day?.scheduled_day && (
          <p className="k-muted">
            Normal shift: {day.shift_start}–{day.shift_end} ({hours}h
            {minutes ? ` ${minutes}m` : ""}).{" "}
            {start
              ? computedEnd
                ? `New shift: ${start}–${computedEnd}.`
                : "That start time would run past midnight."
              : "Choose a start time to see the new end time."}
          </p>
        )}
        {dayError && <p className="k-error">{dayError}</p>}
        <label>
          Reason
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            minLength={3}
            placeholder="Why do you need to work different hours that day?"
            disabled={submitting}
            required
          />
        </label>
        <button
          type="submit"
          className="k-primary"
          disabled={submitting || !day?.scheduled_day || !computedEnd}
        >
          {submitting ? "Sending..." : "Request shift reschedule"}
        </button>
        {error && <p className="k-error">{error}</p>}
        {success && <p className="k-success">{success}</p>}
      </form>
      {payload?.requests.length ? (
        <div className="k-mini-list">
          {payload.requests.slice(0, 6).map((request) => (
            <div key={request.id} className="k-shift-reschedule-row">
              <span>
                {formatDateLabel(request.work_date)}: {request.requested_start}–
                {request.requested_end}
                <small className="k-muted">
                  {" "}
                  (normal {request.original_start}–{request.original_end})
                  {request.source === "admin" ? " · set by HR" : ""}
                </small>
                {request.status === "rejected" && request.review_reason && (
                  <small className="k-error"> Reason: {request.review_reason}</small>
                )}
              </span>
              <span>
                <strong>{shiftRescheduleStatusLabel(request.status)}</strong>
                {request.status === "pending" && (
                  <button
                    type="button"
                    className="k-secondary-action"
                    onClick={() => void handleCancel(request.id)}
                    disabled={cancellingId === request.id}
                  >
                    {cancellingId === request.id ? "Cancelling..." : "Cancel"}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
