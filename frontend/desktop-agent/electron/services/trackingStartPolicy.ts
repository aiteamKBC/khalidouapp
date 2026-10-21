export function requiresExplicitFreshSessionStart(options: {
  hasExistingSession: boolean;
  confirmationAccepted: boolean;
}) {
  return !options.hasExistingSession && !options.confirmationAccepted;
}

export type NewWorkdayStartAction = "prompt_on_input" | "already_working" | "wait";

/**
 * What to do once the local date changes while Khaliduo stays open overnight.
 * With no session running, yesterday's Stop / "Not working" / pause must not
 * carry into today: the first real input asks the employee to start work. Work
 * already active past midnight means the new day has begun — nothing to ask.
 * An idle or paused session waits until the server closes it at the new day.
 */
export function newWorkdayStartAction(options: {
  enrolled: boolean;
  hasTrackingSession: boolean;
  trackingStatus: string;
}): NewWorkdayStartAction {
  if (!options.enrolled) return "wait";
  if (!options.hasTrackingSession) return "prompt_on_input";
  return options.trackingStatus === "active" ? "already_working" : "wait";
}
