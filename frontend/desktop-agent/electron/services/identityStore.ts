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
  deviceId?: string;
  deviceName?: string;
  encryptedDeviceToken?: string;
};

export type EnrollmentIdentity = {
  companyId: string;
  employeeId: string;
  employeeName: string;
  deviceId: string;
  deviceName: string;
  deviceToken: string;
};

function getIdentityPath() {
  return path.join(app.getPath('userData'), 'identity.json');
}

function getLegacyIdentityPaths() {
  const currentPath = path.resolve(getIdentityPath());
  return ['khaliduo-desktop-agent', 'Khaliduo']
    .map((directoryName) => path.join(app.getPath('appData'), directoryName, 'identity.json'))
    .filter((candidate) => path.resolve(candidate) !== currentPath);
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
          writeIdentityFile(identity);
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

  return safeStorage.decryptString(Buffer.from(identity.encryptedDeviceToken, 'base64'));
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
