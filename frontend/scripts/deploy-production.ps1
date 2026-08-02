[CmdletBinding()]
param(
    [string]$Server = "root@72.62.133.105",
    [string]$AppRoot = "/var/www/khalidouapp",
    [string]$ApiBaseUrl = "https://api.khaliduoapp.kentbusinesscollege.net/api/v1",
    [string]$DashboardUrl = "https://khaliduoapp.kentbusinesscollege.net/dashboard",
    [switch]$SkipDesktop,
    [switch]$ValidateOnly,
    [switch]$ResumeDesktopPublish
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$desktopRoot = Join-Path $repoRoot "frontend\desktop-agent"
$releaseRoot = Join-Path $desktopRoot "release-khaliduo"
$installer = Join-Path $releaseRoot "KhaliduoSetup.exe"
$blockmap = Join-Path $releaseRoot "KhaliduoSetup.exe.blockmap"
$latestYml = Join-Path $releaseRoot "latest.yml"

function Invoke-CheckedNative {
    param(
        [Parameter(Mandatory)]
        [scriptblock]$Command,
        [Parameter(Mandatory)]
        [string]$FailureMessage
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)"
    }
}

function Get-YamlValue {
    param(
        [Parameter(Mandatory)]
        [string[]]$Lines,
        [Parameter(Mandatory)]
        [string]$Key
    )

    $match = $Lines |
        Select-String -Pattern "^\s*$([regex]::Escape($Key)):\s*(.+?)\s*$" |
        Select-Object -First 1
    if (-not $match) {
        throw "Missing '$Key' in $latestYml"
    }
    return $match.Matches[0].Groups[1].Value.Trim("'`"")
}

if ($ResumeDesktopPublish -and $SkipDesktop) {
    throw "ResumeDesktopPublish cannot be combined with SkipDesktop."
}

$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $commit) {
    throw "Unable to resolve the local Git commit."
}

if (-not $ResumeDesktopPublish) {
    $trackedChanges = & git -C $repoRoot status --porcelain --untracked-files=no
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read the Git worktree."
    }
    if ($trackedChanges) {
        throw "Tracked worktree changes exist. Commit and test them before production deployment."
    }

    $remoteMainLine = & git -C $repoRoot ls-remote origin refs/heads/main
    if ($LASTEXITCODE -ne 0 -or -not $remoteMainLine) {
        throw "Unable to resolve origin/main."
    }
    $remoteMain = ($remoteMainLine -split "\s+")[0]
    if ($remoteMain -ne $commit) {
        throw "HEAD $commit is not the pushed origin/main commit $remoteMain."
    }
}

if (-not $SkipDesktop) {
    foreach ($file in @($installer, $blockmap, $latestYml)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Missing desktop release file: $file"
        }
    }

    $latestLines = Get-Content -LiteralPath $latestYml
    $version = Get-YamlValue -Lines $latestLines -Key "version"
    $expectedSha512 = Get-YamlValue -Lines $latestLines -Key "sha512"
    $expectedSize = [int64](Get-YamlValue -Lines $latestLines -Key "size")
    $installerInfo = Get-Item -LiteralPath $installer
    if ($installerInfo.Length -ne $expectedSize) {
        throw "Installer size does not match latest.yml."
    }
    $stream = [IO.File]::OpenRead($installer)
    $hasher = [Security.Cryptography.SHA512]::Create()
    try {
        $actualSha512 = [Convert]::ToBase64String(
            $hasher.ComputeHash($stream)
        )
    } finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
    if ($actualSha512 -ne $expectedSha512) {
        throw "Installer SHA512 does not match latest.yml."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        throw "Installer signature is not valid: $($signature.StatusMessage)"
    }
} else {
    $version = ""
    $expectedSha512 = ""
    $expectedSize = 0
}

if ($ValidateOnly) {
    if ($ResumeDesktopPublish) {
        Write-Host "Desktop publication recovery inputs are valid."
    } else {
        Write-Host "Production deployment inputs are valid."
    }
    Write-Host "Commit: $commit"
    if (-not $SkipDesktop) {
        Write-Host "Desktop: $version"
        Write-Host "Installer signature: valid"
        Write-Host "Installer SHA512 and size: match latest.yml"
    }
    return
}

$appDeployScript = @'
set -euo pipefail

APP_ROOT="__APP_ROOT__"
EXPECTED_COMMIT="__EXPECTED_COMMIT__"
DEPLOY_ID="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="/var/backups/khaliduo"
DASHBOARD="$APP_ROOT/frontend/admin-dashboard"
NEXT_OUTPUT="$DASHBOARD/.output.next-$DEPLOY_ID"
ROLLBACK_OUTPUT="$DASHBOARD/.output.rollback-$DEPLOY_ID"

cd "$APP_ROOT"
git fetch origin main
git merge --ff-only origin/main
test "$(git rev-parse HEAD)" = "$EXPECTED_COMMIT"

mkdir -p "$BACKUP_ROOT/database" "$BACKUP_ROOT/audits"
if command -v pg_dump >/dev/null 2>&1; then
  DATABASE_URL="$(
    cd "$APP_ROOT/backend"
    "$APP_ROOT/venv/bin/python" -c \
      'from app.database.session import normalize_database_url; from app.core.config import settings; print(normalize_database_url(settings.database_url).replace("postgresql+psycopg://", "postgresql://", 1))'
  )"
  pg_dump \
    --dbname="$DATABASE_URL" \
    --format=custom \
    --file="$BACKUP_ROOT/database/pre-deploy-$DEPLOY_ID.dump"
  chmod 600 "$BACKUP_ROOT/database/pre-deploy-$DEPLOY_ID.dump"
else
  echo "WARNING: pg_dump is unavailable; database backup was skipped." >&2
fi

cd "$APP_ROOT/backend"
"$APP_ROOT/venv/bin/python" -m alembic upgrade head
"$APP_ROOT/venv/bin/python" -m compileall -q app scripts
systemctl restart khaliduo-api
systemctl is-active --quiet khaliduo-api

cd "$DASHBOARD"
npm ci
KHALIDUO_OUTPUT_DIR="$NEXT_OUTPUT" npm run build
test -s "$NEXT_OUTPUT/server/index.mjs"

systemctl stop khaliduo-dashboard
if [ -d "$DASHBOARD/.output" ]; then
  mv "$DASHBOARD/.output" "$ROLLBACK_OUTPUT"
fi
mv "$NEXT_OUTPUT" "$DASHBOARD/.output"
if ! systemctl start khaliduo-dashboard; then
  mv "$DASHBOARD/.output" "$DASHBOARD/.output.failed-$DEPLOY_ID"
  if [ -d "$ROLLBACK_OUTPUT" ]; then
    mv "$ROLLBACK_OUTPUT" "$DASHBOARD/.output"
  fi
  systemctl start khaliduo-dashboard
  echo "Dashboard deployment failed and was rolled back." >&2
  exit 1
fi
systemctl is-active --quiet khaliduo-dashboard

install -m 0755 \
  "$APP_ROOT/backend/deployment/systemd/khaliduo-healthcheck.sh" \
  /usr/local/sbin/khaliduo-healthcheck
install -m 0644 \
  "$APP_ROOT/backend/deployment/systemd/khaliduo-healthcheck.service" \
  /etc/systemd/system/khaliduo-healthcheck.service
install -m 0644 \
  "$APP_ROOT/backend/deployment/systemd/khaliduo-healthcheck.timer" \
  /etc/systemd/system/khaliduo-healthcheck.timer
mkdir -p \
  /etc/systemd/system/khaliduo-api.service.d \
  /etc/systemd/system/khaliduo-dashboard.service.d
install -m 0644 \
  "$APP_ROOT/backend/deployment/systemd/reliability.conf" \
  /etc/systemd/system/khaliduo-api.service.d/reliability.conf
install -m 0644 \
  "$APP_ROOT/backend/deployment/systemd/reliability.conf" \
  /etc/systemd/system/khaliduo-dashboard.service.d/reliability.conf
systemctl daemon-reload
systemctl enable --now khaliduo-healthcheck.timer

healthy=0
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 10 \
      "http://127.0.0.1:8100/api/v1/health/db" >/dev/null &&
    curl -fsS --max-time 10 \
      "http://127.0.0.1:3100/" >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  systemctl status khaliduo-api khaliduo-dashboard --no-pager
  exit 1
fi

AUDIT_PATH="$BACKUP_ROOT/audits/production-$DEPLOY_ID.json"
cd "$APP_ROOT/backend"
"$APP_ROOT/venv/bin/python" -m scripts.audit_production_state \
  --days 7 | tee "$AUDIT_PATH"
chmod 600 "$AUDIT_PATH"

echo "APP_COMMIT=$(git -C "$APP_ROOT" rev-parse HEAD)"
echo "AUDIT_PATH=$AUDIT_PATH"
echo "HEALTH_TIMER=$(systemctl is-active khaliduo-healthcheck.timer)"
'@
$appDeployScript = $appDeployScript.
    Replace("__APP_ROOT__", $AppRoot).
    Replace("__EXPECTED_COMMIT__", $commit)

if ($ResumeDesktopPublish) {
    Write-Host "Resuming the uploaded Desktop publication; application deployment is skipped."
} else {
    Write-Host "Deploying backend, dashboard, health recovery, and production audit..."
    # Keep SSH stdin attached to the console so password authentication cannot
    # consume bytes from the remote Bash script. This also gives the user one
    # clean password prompt instead of mixing the prompt with pipeline input.
    $appDeployPayload = [Convert]::ToBase64String(
        [Text.Encoding]::UTF8.GetBytes($appDeployScript)
    )
    & ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=3 $Server (
        "printf '%s' '$appDeployPayload' | base64 -d | bash"
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Application deployment failed."
    }
}

if (-not $SkipDesktop) {
    $remoteStage = "/tmp/khaliduo-update-$version"
    if ($ResumeDesktopPublish) {
        Write-Host "Using the existing uploaded Desktop staging directory: $remoteStage"
    } else {
        Invoke-CheckedNative -FailureMessage "Unable to create the desktop staging directory" -Command {
            & ssh $Server "mkdir -p -- '$remoteStage' && chmod 700 -- '$remoteStage'"
        }
        Invoke-CheckedNative -FailureMessage "Desktop upload failed" -Command {
            & scp -- $installer $blockmap $latestYml "${Server}:$remoteStage/"
        }
    }

    $desktopPublishScript = @'
set -euo pipefail

STAGE="__STAGE__"
RELEASE="__APP_ROOT__/frontend/desktop-agent/release-khaliduo"
VERSION="__VERSION__"
EXPECTED_SHA512="__SHA512__"
EXPECTED_SIZE="__SIZE__"
BACKUP="/var/backups/khaliduo/desktop-$(date +%Y%m%d-%H%M%S)"

test -s "$STAGE/KhaliduoSetup.exe"
test -s "$STAGE/KhaliduoSetup.exe.blockmap"
test -s "$STAGE/latest.yml"
grep -Fqx "version: $VERSION" "$STAGE/latest.yml"

ACTUAL_SIZE="$(stat -c %s "$STAGE/KhaliduoSetup.exe")"
test "$ACTUAL_SIZE" = "$EXPECTED_SIZE"
ACTUAL_SHA512="$(
  openssl dgst -sha512 -binary "$STAGE/KhaliduoSetup.exe" |
    openssl base64 -A
)"
test "$ACTUAL_SHA512" = "$EXPECTED_SHA512"

mkdir -p "$RELEASE" "$BACKUP"
for file in KhaliduoSetup.exe KhaliduoSetup.exe.blockmap latest.yml; do
  if [ -f "$RELEASE/$file" ]; then
    cp -a "$RELEASE/$file" "$BACKUP/$file"
  fi
done

install -m 0644 \
  "$STAGE/KhaliduoSetup.exe" \
  "$RELEASE/KhaliduoSetup.exe.new"
install -m 0644 \
  "$STAGE/KhaliduoSetup.exe.blockmap" \
  "$RELEASE/KhaliduoSetup.exe.blockmap.new"
install -m 0644 "$STAGE/latest.yml" "$RELEASE/latest.yml.new"
mv -f "$RELEASE/KhaliduoSetup.exe.new" "$RELEASE/KhaliduoSetup.exe"
mv -f \
  "$RELEASE/KhaliduoSetup.exe.blockmap.new" \
  "$RELEASE/KhaliduoSetup.exe.blockmap"
mv -f "$RELEASE/latest.yml.new" "$RELEASE/latest.yml"

published=0
for attempt in $(seq 1 30); do
  if curl -fsS \
      "__API_BASE_URL__/updates/windows/latest.yml?ts=$(date +%s)" |
      grep -Fqx "version: $VERSION"; then
    published=1
    break
  fi
  sleep 2
done
test "$published" -eq 1
echo "DESKTOP_VERSION=$VERSION"
echo "DESKTOP_BACKUP=$BACKUP"
'@
    $desktopPublishScript = $desktopPublishScript.
        Replace("__STAGE__", $remoteStage).
        Replace("__APP_ROOT__", $AppRoot).
        Replace("__VERSION__", $version).
        Replace("__SHA512__", $expectedSha512).
        Replace("__SIZE__", [string]$expectedSize).
        Replace("__API_BASE_URL__", $ApiBaseUrl)

    Write-Host "Publishing signed Desktop $version..."
    $desktopPublishPayload = [Convert]::ToBase64String(
        [Text.Encoding]::UTF8.GetBytes($desktopPublishScript)
    )
    & ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=3 $Server (
        "printf '%s' '$desktopPublishPayload' | base64 -d | bash"
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Desktop publication failed. The staged files were kept; rerun with -ResumeDesktopPublish."
    }
}

$health = Invoke-RestMethod -Uri "$ApiBaseUrl/health/db"
if (
    $health.data.database -ne "reachable" -or
    $health.data.schema -ne "ready"
) {
    throw "The public database health check did not report a ready schema."
}
$dashboard = Invoke-WebRequest -UseBasicParsing -Uri $DashboardUrl
if ($dashboard.StatusCode -ne 200) {
    throw "The dashboard returned HTTP $($dashboard.StatusCode)."
}
if (-not $SkipDesktop) {
    $publishedYml = (Invoke-WebRequest -UseBasicParsing -Uri (
        "$ApiBaseUrl/updates/windows/latest.yml?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
    )).Content
    if ($publishedYml -notmatch "(?m)^version:\s+$([regex]::Escape($version))\s*$") {
        throw "The public update feed does not expose Desktop $version."
    }
}

Write-Host ""
Write-Host "Production deployment verified."
Write-Host "Commit: $commit"
if (-not $SkipDesktop) {
    Write-Host "Desktop: $version"
}
Write-Host "API database: reachable; schema: ready"
Write-Host "Dashboard: HTTP $($dashboard.StatusCode)"
