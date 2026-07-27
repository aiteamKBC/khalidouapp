export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatRelative(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function formatClock(value?: string | null, timezone?: string | null): string {
  if (!value) return "—";
  if (isTimeOfDay(value)) return formatTimeOfDay(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone || undefined,
  }).format(date);
}

export function formatAttendanceStart(
  actualFirstActivityAt?: string | null,
  timezone?: string | null,
  continuedFromPreviousDay = false,
  continuedSessionStartedAt?: string | null,
): string {
  if (!continuedFromPreviousDay) {
    return formatClock(actualFirstActivityAt, timezone);
  }
  const originalStart = continuedSessionStartedAt || actualFirstActivityAt;
  if (!originalStart) {
    return "Continued from previous day";
  }
  const date = new Date(originalStart);
  if (Number.isNaN(date.getTime())) {
    return "Continued from previous day";
  }
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: timezone || undefined,
  }).format(date);
  return `Continued from ${day}, ${formatClock(originalStart, timezone)}`;
}

export function formatTimeOfDay(value?: string | null): string {
  if (!value) return "—";
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return "—";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "—";
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function formatDateTime(iso?: string, timezone?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone || undefined,
  }).format(date);
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { dateStyle: "medium" });
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function isTimeOfDay(value: string) {
  return /^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value.trim());
}
