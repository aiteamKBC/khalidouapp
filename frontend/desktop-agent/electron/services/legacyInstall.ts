// Detection and repair of a leftover all-users (per-machine) Khaliduo install.
//
// Releases up to ~1.1.78 installed into C:\Program Files\Khaliduo. Current
// releases install per user (AppData\Local\Programs\khaliduo) so updates never
// need administrator rights. An update cannot remove the old per-machine copy,
// and its desktop icon, all-users Start menu entry and the Windows startup
// entry keep launching it. Each launch re-downloads and re-installs the update
// into the per-user folder, forever. This module is pure so it can be tested.

export type LegacyInstall = {
  directory: string;
  executable: string;
  uninstaller: string;
};

export const STARTUP_VALUE_NAME = "Khaliduo";
export const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

function normalizeWindowsPath(value: string) {
  return value.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function samePath(left: string, right: string) {
  return normalizeWindowsPath(left) === normalizeWindowsPath(right);
}

/** Program Files locations a per-machine Khaliduo could have been installed to. */
export function legacyInstallDirectories(env: Record<string, string | undefined>) {
  const roots = [env.ProgramFiles, env.ProgramW6432, env["ProgramFiles(x86)"]]
    .filter((root): root is string => Boolean(root));
  const unique: string[] = [];
  for (const root of roots) {
    const directory = `${root.replace(/[\\/]+$/, "")}\\Khaliduo`;
    if (!unique.some((existing) => samePath(existing, directory))) {
      unique.push(directory);
    }
  }
  return unique;
}

/**
 * The per-machine install that is NOT the running executable, if one exists.
 * `exists` is injected so the lookup is testable without a filesystem.
 */
export function findLegacyInstall(
  runningExecutable: string,
  directories: string[],
  exists: (filePath: string) => boolean,
): LegacyInstall | null {
  for (const directory of directories) {
    const executable = `${directory}\\Khaliduo.exe`;
    const uninstaller = `${directory}\\Uninstall Khaliduo.exe`;
    if (samePath(executable, runningExecutable)) continue;
    if (exists(executable) && exists(uninstaller)) {
      return { directory, executable, uninstaller };
    }
  }
  return null;
}

/** The startup command this executable should own. */
export function desiredStartupCommand(runningExecutable: string) {
  return `"${runningExecutable}" --autostart`;
}

/** Parse `reg query <RUN_KEY> /v Khaliduo` output into the command, if any. */
export function parseRunValue(regQueryOutput: string): string | null {
  for (const line of regQueryOutput.split(/\r?\n/)) {
    const match = line.match(/^\s*Khaliduo\s+REG_(?:EXPAND_)?SZ\s+(.*)$/i);
    if (match) return match[1].trim();
  }
  return null;
}

/** The executable a startup command launches (quoted or bare). */
export function startupCommandExecutable(command: string): string {
  const quoted = command.match(/^\s*"([^"]+)"/);
  if (quoted) return quoted[1];
  return command.trim().split(/\s+/)[0] ?? "";
}

export function startupEntryNeedsRepair(
  currentCommand: string | null,
  runningExecutable: string,
) {
  if (currentCommand === null) return true;
  return !samePath(startupCommandExecutable(currentCommand), runningExecutable);
}

function powershellLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * PowerShell run (hidden, detached, NOT elevated) that asks Windows for
 * administrator permission to silently uninstall the old copy, waits for it,
 * and starts the current per-user Khaliduo again if the old uninstaller closed
 * it. `processName` excludes the .exe suffix.
 */
export function legacyCleanupScript(
  legacy: LegacyInstall,
  runningExecutable: string,
) {
  const uninstaller = powershellLiteral(legacy.uninstaller);
  const current = powershellLiteral(runningExecutable);
  return [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    `  $p = Start-Process -FilePath ${uninstaller} -ArgumentList '/allusers','/S' -Verb RunAs -Wait -PassThru`,
    "  $code = $p.ExitCode",
    "} catch { $code = -1 }",
    "Start-Sleep -Seconds 2",
    `$running = Get-CimInstance Win32_Process -Filter "Name='Khaliduo.exe'" | Where-Object { $_.ExecutablePath -eq ${current} }`,
    `if (-not $running) { Start-Process -FilePath ${current} -ArgumentList '--autostart' }`,
    "exit $code",
  ].join("\n");
}
