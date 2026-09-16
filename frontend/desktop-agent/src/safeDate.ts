// Renderer formatters receive timestamp strings pushed from the main process.
// A non-empty but malformed value (e.g. "2026-13-45") produces an Invalid Date,
// and Intl.DateTimeFormat(...).format(InvalidDate) throws RangeError DURING
// render — which, without an error boundary, unmounts the whole React tree and
// white-screens the app. Parse defensively so formatters can fall back instead
// of throwing. Pure (no React) so it is unit-testable under node --test.
export function toValidDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
