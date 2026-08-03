export function shouldResetDailyCountersForSession(input: {
  activeCounterDate: string | null;
  todayCounterDate: string;
  previousSessionCounterDate: string | null;
  nextSessionCounterDate: string;
  changedSession: boolean;
}) {
  if (
    input.activeCounterDate !== null &&
    input.activeCounterDate !== input.todayCounterDate
  ) {
    return true;
  }

  return (
    input.changedSession &&
    input.nextSessionCounterDate === input.todayCounterDate &&
    input.previousSessionCounterDate !== null &&
    input.previousSessionCounterDate !== input.nextSessionCounterDate
  );
}

export function reconcileWorkedToday(input: {
  trackedTodaySeconds: number;
  activeSeconds: number;
  previousBaseSeconds: number;
  preservePreviousBase: boolean;
}) {
  const trackedTodaySeconds = Math.max(0, input.trackedTodaySeconds);
  const activeSeconds = Math.max(0, input.activeSeconds);
  const serverBaseSeconds = Math.max(0, trackedTodaySeconds - activeSeconds);
  const baseSeconds = input.preservePreviousBase
    ? Math.max(0, input.previousBaseSeconds, serverBaseSeconds)
    : serverBaseSeconds;

  return {
    baseSeconds,
    workedTodaySeconds: Math.max(
      trackedTodaySeconds,
      baseSeconds + activeSeconds,
    ),
  };
}
