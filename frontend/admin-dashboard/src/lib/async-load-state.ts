// Resolve the initial-load UI state for a page that must fetch data before it
// can render its form. A page that only leaves "loading" when data arrives will
// hang forever on a failed initial request; this distinguishes loading from a
// recoverable error and from a permission denial (R2).
export type InitialLoadState = "ready" | "loading" | "error" | "denied";

export function resolveInitialLoadState(input: {
  hasData: boolean;
  isError: boolean;
  errorStatus?: number;
}): InitialLoadState {
  if (input.hasData) return "ready";
  if (input.isError) return input.errorStatus === 403 ? "denied" : "error";
  return "loading";
}
