// Auth lifecycle "generation".
//
// Bumped on every logout / account switch. Long-running work that was started
// under one identity — an in-flight token refresh, or a `/auth/me` restore —
// captures the generation at the moment it began and compares it before
// committing its result. If a logout happened in between, the result is stale
// and must be discarded, so a request that resolves *after* logout can never
// resurrect cleared credentials (W6).
let generation = 0;

/** The current auth generation. */
export function currentAuthGeneration(): number {
  return generation;
}

/** Advance the generation (call on logout / account switch). Returns the new value. */
export function advanceAuthGeneration(): number {
  generation += 1;
  return generation;
}

/** True when a logout/account switch happened after `captured` was taken. */
export function isAuthGenerationStale(captured: number): boolean {
  return captured !== generation;
}
