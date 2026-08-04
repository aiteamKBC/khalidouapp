export const UPDATE_INSTALL_RECOVERY_MS = 30_000;

export function shouldClearInstallRecoveryOnBeforeQuit(
  isInstallingUpdate: boolean,
) {
  return !isInstallingUpdate;
}
