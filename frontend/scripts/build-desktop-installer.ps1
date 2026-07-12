$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$desktop = Join-Path $root "desktop-agent"
$release = Join-Path $desktop "release-khaliduo"
$tempOutput = Join-Path $env:TEMP ("khaliduo-release-" + [guid]::NewGuid().ToString("N"))
$internalSigningSubject = "Kent Consultancy Internal Code Signing"
$installerTrust = Join-Path $desktop "installer\trust"
$runtimeEnvironmentFile = Join-Path $desktop "build-runtime.env"

if (-not $env:KHALIDUO_UPDATE_URL) {
    throw "KHALIDUO_UPDATE_URL is required for an installer build."
}
if (-not $env:VITE_API_BASE_URL) {
    throw "VITE_API_BASE_URL is required for an installer build."
}
if (-not $env:KHALIDUO_EMPLOYEE_PORTAL_URL) {
    throw "KHALIDUO_EMPLOYEE_PORTAL_URL is required for an installer build."
}
$updateCheckIntervalMinutes = if ($env:UPDATE_CHECK_INTERVAL_MINUTES) { $env:UPDATE_CHECK_INTERVAL_MINUTES } else { "15" }
if ($updateCheckIntervalMinutes -notmatch '^\d+$' -or [int]$updateCheckIntervalMinutes -lt 5 -or [int]$updateCheckIntervalMinutes -gt 1440) {
    throw "UPDATE_CHECK_INTERVAL_MINUTES must be between 5 and 1440."
}
foreach ($publicUrl in @($env:KHALIDUO_UPDATE_URL, $env:VITE_API_BASE_URL, $env:KHALIDUO_EMPLOYEE_PORTAL_URL)) {
    if ($publicUrl -notmatch '^https://[^\s]+$' -or $publicUrl -match '[\r\n]') {
        throw "Installer public URLs must be valid HTTPS URLs without line breaks."
    }
}

try {
    Set-Location $desktop
    @(
        "VITE_API_BASE_URL=$($env:VITE_API_BASE_URL)"
        "KHALIDUO_EMPLOYEE_PORTAL_URL=$($env:KHALIDUO_EMPLOYEE_PORTAL_URL)"
        "UPDATE_CHECK_INTERVAL_MINUTES=$updateCheckIntervalMinutes"
    ) | Set-Content -LiteralPath $runtimeEnvironmentFile -Encoding ascii
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "Khaliduo build failed."
    }

    $builderArguments = @(
        "exec",
        "electron-builder",
        "--",
        "--win",
        "nsis",
        "--publish",
        "never",
        "--config.directories.output=$tempOutput"
    )

    $signingCertificate = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Subject -like "CN=$internalSigningSubject,*" -and
            $_.HasPrivateKey -and
            $_.NotAfter -gt (Get-Date)
        } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1

    if ($signingCertificate) {
        $releaseTrust = Join-Path $release "trust"
        $rootPublicCertificate = Join-Path $releaseTrust "KentConsultancy-Internal-Root-CA.cer"
        $publisherPublicCertificate = Join-Path $releaseTrust "KentConsultancy-Code-Signing-Publisher.cer"
        if (-not (Test-Path -LiteralPath $rootPublicCertificate) -or -not (Test-Path -LiteralPath $publisherPublicCertificate)) {
            throw "Public trust certificates were not found. Run scripts/setup-internal-code-signing.ps1 first."
        }
        New-Item -ItemType Directory -Force -Path $installerTrust | Out-Null
        Copy-Item -LiteralPath $rootPublicCertificate -Destination $installerTrust -Force
        Copy-Item -LiteralPath $publisherPublicCertificate -Destination $installerTrust -Force

        $builderArguments += "--config.win.signtoolOptions.certificateSha1=$($signingCertificate.Thumbprint)"
        $builderArguments += "--config.forceCodeSigning=true"
        Write-Host "Signing Khaliduo as: $internalSigningSubject"
    }
    elseif ($env:KHALIDUO_ALLOW_UNSIGNED_BUILD -eq "1") {
        Write-Warning "Internal signing certificate was not found; creating an explicitly allowed unsigned test build."
    }
    else {
        throw "Internal signing certificate was not found. Run scripts/setup-internal-code-signing.ps1 first."
    }

    & npm.cmd @builderArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Khaliduo installer build failed."
    }

    $embeddedUpdateConfig = Join-Path $tempOutput "win-unpacked\resources\app-update.yml"
    if (-not (Test-Path -LiteralPath $embeddedUpdateConfig)) {
        throw "The packaged app does not contain app-update.yml. Automatic updates would not work."
    }
    $embeddedUpdateConfigText = Get-Content -LiteralPath $embeddedUpdateConfig -Raw
    if ($embeddedUpdateConfigText -notmatch [regex]::Escape($env:KHALIDUO_UPDATE_URL)) {
        throw "The packaged app does not contain the expected update URL: $env:KHALIDUO_UPDATE_URL"
    }
    $embeddedRuntimeEnvironment = Join-Path $tempOutput "win-unpacked\resources\khaliduo-runtime.env"
    if (-not (Test-Path -LiteralPath $embeddedRuntimeEnvironment)) {
        throw "The packaged app does not contain its production runtime URLs."
    }
    $embeddedRuntimeEnvironmentText = Get-Content -LiteralPath $embeddedRuntimeEnvironment -Raw
    foreach ($expectedRuntimeValue in @($env:VITE_API_BASE_URL, $env:KHALIDUO_EMPLOYEE_PORTAL_URL)) {
        if ($embeddedRuntimeEnvironmentText -notmatch [regex]::Escape($expectedRuntimeValue)) {
            throw "The packaged app is missing the expected runtime URL: $expectedRuntimeValue"
        }
    }

    New-Item -ItemType Directory -Force -Path $release | Out-Null
    $updateArtifacts = @(
        "KhaliduoSetup.exe",
        "KhaliduoSetup.exe.blockmap",
        "latest.yml"
    )
    foreach ($artifact in $updateArtifacts) {
        $artifactPath = Join-Path $tempOutput $artifact
        if (-not (Test-Path -LiteralPath $artifactPath)) {
            throw "Electron Builder did not create the required update file: $artifact"
        }
        Copy-Item -LiteralPath $artifactPath -Destination $release -Force
    }

    $installerPath = Join-Path $release "KhaliduoSetup.exe"
    $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
    if ($signingCertificate -and $signature.Status -ne "Valid") {
        throw "Khaliduo installer signature validation failed: $($signature.Status) $($signature.StatusMessage)"
    }

    Write-Host ""
    Write-Host "Khaliduo installer created at:"
    Write-Host $installerPath
    Write-Host "Signature status: $($signature.Status)"
    Write-Host "Update feed: $env:KHALIDUO_UPDATE_URL"
    Write-Host "Update metadata: $(Join-Path $release 'latest.yml')"
}
finally {
    $tempRoot = [System.IO.Path]::GetFullPath($env:TEMP)
    $resolvedTempOutput = [System.IO.Path]::GetFullPath($tempOutput)
    if (
        (Test-Path -LiteralPath $resolvedTempOutput) -and
        $resolvedTempOutput.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        try {
            Remove-Item -LiteralPath $resolvedTempOutput -Recurse -Force
        }
        catch {
            Write-Warning "The temporary Electron build folder could not be removed: $resolvedTempOutput"
        }
    }
    if (Test-Path -LiteralPath $installerTrust) {
        Remove-Item -LiteralPath $installerTrust -Recurse -Force
    }
    if (Test-Path -LiteralPath $runtimeEnvironmentFile) {
        Remove-Item -LiteralPath $runtimeEnvironmentFile -Force
    }
    Set-Location $root
}
