$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$desktop = Join-Path $root "desktop-agent"
$viteUrl = "http://127.0.0.1:5173"

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$viteConnection = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
if (-not $viteConnection) {
  Start-Process `
    -FilePath powershell.exe `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "& .\node_modules\.bin\vite.cmd --host 127.0.0.1 --port 5173"
    ) `
    -WorkingDirectory $desktop `
    -WindowStyle Hidden

  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    try {
      Invoke-WebRequest -Uri $viteUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $ready) {
    throw "Desktop Vite server did not start on $viteUrl."
  }
}

$env:VITE_DEV_SERVER_URL = $viteUrl
Set-Location $desktop
& .\node_modules\electron\dist\electron.exe .
