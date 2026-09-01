export function requiresExplicitFreshSessionStart(options: {
  hasExistingSession: boolean;
  confirmationAccepted: boolean;
}) {
  return !options.hasExistingSession && !options.confirmationAccepted;
}
