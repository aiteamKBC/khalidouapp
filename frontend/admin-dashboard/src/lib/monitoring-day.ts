export function monitoringDay(
  selectedDay: string | undefined,
  timezone = "Africa/Cairo",
  now = new Date(),
): string {
  if (selectedDay) return selectedDay;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function monitoringDaySearchValue(
  selectedDay: string | undefined,
  timezone = "Africa/Cairo",
  now = new Date(),
): string | undefined {
  return selectedDay === monitoringDay(undefined, timezone, now) ? undefined : selectedDay;
}
