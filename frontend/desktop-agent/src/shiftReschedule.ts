// Pure helpers for the desktop "Shift reschedule" request. The backend is the
// source of truth for every rule; these only drive the form so the employee
// sees the computed end time and obvious mistakes before submitting.

export type ShiftRescheduleStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

const MINUTES_PER_DAY = 24 * 60;

export function clockToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function minutesToClock(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * End time for a same-length shift starting at `start`. Returns null when the
 * shift would reach or cross midnight (it must end on the same day).
 */
export function rescheduleEndTime(
  start: string,
  shiftMinutes: number,
): string | null {
  const startMinutes = clockToMinutes(start);
  if (startMinutes === null || shiftMinutes <= 0) return null;
  const end = startMinutes + shiftMinutes;
  if (end >= MINUTES_PER_DAY) return null;
  return minutesToClock(end);
}

/** Monday = 0 … Sunday = 6, matching the backend's `date.weekday()`. */
export function weekdayOfDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (jsDay + 6) % 7;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

/** The next `count` working dates on or after `earliestDate`. */
export function upcomingWorkingDates(
  earliestDate: string,
  workingDays: readonly number[],
  count: number,
): string[] {
  const dates: string[] = [];
  if (!workingDays.length) return dates;
  let cursor = earliestDate;
  // Bound the scan so a malformed policy can never loop forever.
  for (let guard = 0; dates.length < count && guard < count * 7 + 7; guard += 1) {
    if (workingDays.includes(weekdayOfDateKey(cursor))) dates.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
  }
  return dates;
}

export function validateShiftRescheduleInput(input: {
  workDate: string;
  start: string;
  reason: string;
  earliestDate: string;
  workingDays: readonly number[];
  shiftMinutes: number;
  normalStart?: string | null;
}): string | null {
  if (!input.workDate) return "Choose the day you want to reschedule.";
  if (input.workDate < input.earliestDate) {
    return `Shift reschedules must be requested at least 2 days ahead (earliest ${input.earliestDate}).`;
  }
  if (!input.workingDays.includes(weekdayOfDateKey(input.workDate))) {
    return "You can only reschedule a scheduled working day.";
  }
  if (clockToMinutes(input.start) === null) return "Choose the new start time.";
  if (rescheduleEndTime(input.start, input.shiftMinutes) === null) {
    return "The new shift must end on the same day (before midnight).";
  }
  if (input.normalStart && input.start === input.normalStart.slice(0, 5)) {
    return "The new start time is the same as your normal shift.";
  }
  if (!input.reason.trim()) return "A reason is required.";
  return null;
}

export function shiftRescheduleStatusLabel(status: ShiftRescheduleStatus): string {
  switch (status) {
    case "pending":
      return "Pending review";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired (normal shift applied)";
    default:
      return status;
  }
}
