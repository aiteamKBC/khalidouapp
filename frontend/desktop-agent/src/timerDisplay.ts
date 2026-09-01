export function mainTimerSeconds(options: {
  isAutomaticIdle: boolean;
  isExtraTime: boolean;
  currentIdleSeconds: number;
  extraSeconds: number;
  trackedTodaySeconds: number;
}) {
  if (options.isAutomaticIdle) {
    return Math.max(0, options.currentIdleSeconds);
  }
  if (options.isExtraTime) {
    return Math.max(0, options.extraSeconds);
  }
  return Math.max(0, options.trackedTodaySeconds);
}

export function reconciledNormalTodaySeconds(options: {
  normalSeconds: number;
  extraSeconds: number;
  manualApprovedSeconds: number;
  trackedTodaySeconds: number;
}) {
  const trackedNormalSeconds = Math.max(
    0,
    options.trackedTodaySeconds -
      Math.max(0, options.extraSeconds) -
      Math.max(0, options.manualApprovedSeconds),
  );
  return Math.max(0, options.normalSeconds, trackedNormalSeconds);
}
