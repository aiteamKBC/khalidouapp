export function requiresExplicitExtraTimeStart(options: {
  hasExistingSession: boolean;
  outsideScheduledShift: boolean;
  confirmationAccepted: boolean;
}) {
  return (
    !options.hasExistingSession &&
    options.outsideScheduledShift &&
    !options.confirmationAccepted
  );
}
