// Physical power/lock state (unlock, resume) is not employee work intent.
//
// Explicit "Pause" (unpaid) and "Stop" both express that the employee has
// deliberately stopped working. A Windows unlock or system resume that arrives
// while one of those is active previously flipped tracking back to "active" and
// resumed crediting time — banking pay for a paused employee. These helpers keep
// the two concepts separate so the rule is unit-testable and applied
// consistently in both the state-transition path and the accrual path.

export type PauseIntent = {
  // The employee's explicit unpaid "Pause" (unpaidPauseActive). Stops active
  // accrual and new screenshots until Resume.
  manualPauseActive: boolean;
  // The employee's explicit "Stop"/sign-out-of-work intent (trackingPausedByUser).
  trackingStoppedByUser: boolean;
};

/**
 * A physical unlock/resume may only re-post an "active" transition when the
 * employee has not explicitly paused or stopped. Otherwise the machine coming
 * back to life must leave the paused/stopped intent untouched.
 */
export function physicalResumeShouldResumeWork(intent: PauseIntent): boolean {
  return !intent.manualPauseActive && !intent.trackingStoppedByUser;
}

/**
 * Defensive accrual guard: even if a stale status or a raced event leaves the
 * runtime marked "active", no active/idle time may be credited while the
 * employee has explicitly paused or stopped. This is independent of the
 * status-transition fix so a single missed transition cannot leak paid time.
 */
export function shouldAccrueTrackedTime(intent: PauseIntent): boolean {
  return !intent.manualPauseActive && !intent.trackingStoppedByUser;
}
