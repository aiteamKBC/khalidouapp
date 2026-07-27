export const IDLE_THRESHOLD_MINUTES = 10;
export const IDLE_THRESHOLD_SECONDS = IDLE_THRESHOLD_MINUTES * 60;

export function hasReachedIdleThreshold(systemIdleSeconds: number): boolean {
  return systemIdleSeconds >= IDLE_THRESHOLD_SECONDS;
}
