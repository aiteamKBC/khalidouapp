import electronMain from 'electron/main';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { app, safeStorage } = electronMain;

export type StoredIdentity = {
  installationId: string;
  companyId?: string;
  employeeId?: string;
  employeeName?: string;
  employeeEmail?: string;
  deviceId?: string;
  deviceName?: string;
  encryptedDeviceToken?: string;
};

export type EnrollmentIdentity = {
  companyId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  deviceId: string;
  deviceName: string;
  deviceToken: string;
};

function getIdentityPath() {
  return path.join(app.getPath('userData'), 'identity.json');
}

function getLegacyIdentityPaths() {
  // A development run keeps its own userData (see main.ts). Never adopt the
  // installed app's identity: on Windows the legacy "Khaliduo" folder IS the
  // packaged app's folder (paths are case-insensitive).
  if (!app.isPackaged) {
    return [];
  }
  const currentPath = path.resolve(getIdentityPath()).toLowerCase();
  return ['khaliduo-desktop-agent', 'Khaliduo']
    .map((directoryName) => path.join(app.getPath('appData'), directoryName, 'identity.json'))
    .filter((candidate) => path.resolve(candidate).toLowerCase() !== currentPath);
}

function ensureUserDataDirectory() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
}

function readIdentityFile(): StoredIdentity | null {
  const filePath = getIdentityPath();
  const candidatePaths = [filePath, ...getLegacyIdentityPaths()];
  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    try {
      const identity = JSON.parse(fs.readFileSync(candidatePath, 'utf-8')) as StoredIdentity;
      if (identity.installationId) {
        if (candidatePath !== filePath) {
          // The device token is encrypted with the OTHER folder's safeStorage
          // key and can never be decrypted here. Keep only the installation
          // id; the employee signs in again instead of every request failing.
          const migrated: StoredIdentity = { installationId: identity.installationId };
          writeIdentityFile(migrated);
          return migrated;
        }
        return identity;
      }
    } catch {
      // Ignore an unreadable legacy identity and continue looking for a valid one.
    }
  }
  return null;
}

function writeIdentityFile(identity: StoredIdentity) {
  ensureUserDataDirectory();
  fs.writeFileSync(getIdentityPath(), JSON.stringify(identity, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function ensureInstallationIdentity(): StoredIdentity {
  const current = readIdentityFile();
  if (current?.installationId) {
    return current;
  }

  const next: StoredIdentity = {
    installationId: randomUUID(),
  };
  writeIdentityFile(next);
  return next;
}

export function loadIdentity(): StoredIdentity {
  return ensureInstallationIdentity();
}

export function getDeviceToken(): string | null {
  const identity = loadIdentity();
  if (!identity.encryptedDeviceToken) {
    return null;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure storage is not available.');
  }

  try {
    return safeStorage.decryptString(Buffer.from(identity.encryptedDeviceToken, 'base64'));
  } catch {
    throw new Error('The saved sign-in on this device can no longer be read. Sign in again.');
  }
}

/**
 * Startup check: a stored token that cannot be decrypted (copied from another
 * profile, or the OS key was reset) makes every API call fail while the app
 * still looks signed in. Drop the unusable enrollment so the sign-in screen
 * shows instead. Returns true when the enrollment was cleared.
 */
export function discardUndecryptableEnrollment(): boolean {
  const identity = loadIdentity();
  if (!identity.encryptedDeviceToken || !safeStorage.isEncryptionAvailable()) {
    return false;
  }
  try {
    safeStorage.decryptString(Buffer.from(identity.encryptedDeviceToken, 'base64'));
    return false;
  } catch {
    clearEnrollmentIdentity();
    return true;
  }
}

export function saveEnrollmentIdentity(enrollment: EnrollmentIdentity): StoredIdentity {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure storage is not available.');
  }

  const current = ensureInstallationIdentity();
  const encryptedDeviceToken = safeStorage.encryptString(enrollment.deviceToken).toString('base64');
  const next: StoredIdentity = {
    ...current,
    companyId: enrollment.companyId,
    employeeId: enrollment.employeeId,
    employeeName: enrollment.employeeName,
    employeeEmail: enrollment.employeeEmail,
    deviceId: enrollment.deviceId,
    deviceName: enrollment.deviceName,
    encryptedDeviceToken,
  };
  writeIdentityFile(next);
  return next;
}

export function clearEnrollmentIdentity(): StoredIdentity {
  const current = ensureInstallationIdentity();
  const next: StoredIdentity = {
    installationId: current.installationId,
  };
  writeIdentityFile(next);
  return next;
}

export function isEnrolled(identity = loadIdentity()) {
  return Boolean(identity.companyId && identity.employeeId && identity.deviceId && identity.encryptedDeviceToken);
}
