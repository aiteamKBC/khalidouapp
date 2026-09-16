// Screenshot capture is a multi-step async pipeline: check eligibility, await
// foreground detection, await screen acquisition, then upload. Eligibility is
// only checked once at the top, so a Pause / lock / sleep / logout / power
// change that lands *during* one of those awaits still produced and uploaded a
// fresh image — capturing an employee after they explicitly paused.
//
// Two independent signals decide whether an in-flight capture may still proceed
// after an await:
//   1. blockReasonNow — the live eligibility policy re-evaluated right now.
//   2. a capture generation counter that is bumped the moment eligibility is
//      lost (pause, lock, sleep, battery, logout, session change). This catches
//      a pause→resume cycle that happens entirely within one await, where the
//      re-evaluated block reason would misleadingly read as eligible again even
//      though the pixels were acquired while paused.

export function captureRemainsEligible(input: {
  blockReasonNow: string | null;
  generationAtStart: number;
  currentGeneration: number;
}): boolean {
  return (
    input.blockReasonNow === null &&
    input.generationAtStart === input.currentGeneration
  );
}
