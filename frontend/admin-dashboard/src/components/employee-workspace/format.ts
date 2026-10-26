export function fmtSeconds(totalSeconds: number, padMinutes = false): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${padMinutes ? String(minutes).padStart(2, "0") : minutes}m`;
}

export function fmtMinutes(minutes: number): string {
  return fmtSeconds(minutes * 60);
}

export function fmtClock(iso: string | null): string {
  if (!iso) return "â€”";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "â€”";
  return d
    .toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "â€”";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "â€”";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateShort(iso: string | null): string {
  if (!iso) return "â€”";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "â€”";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function fmtNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "â€”";
  return value.toLocaleString("en-US");
}

export function workingDaysBetween(
  from: string,
  to: string,
  workingDays?: number[] | null,
): number {
  if (!from || !to) return 0;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (workingDays?.length ? workingDays.includes((day + 6) % 7) : true) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function todayISO(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
