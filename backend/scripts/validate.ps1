$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

Set-Location $root
& .\.venv\Scripts\python.exe -m pytest
if ($LASTEXITCODE -ne 0) { throw "Backend tests failed." }
& .\.venv\Scripts\python.exe -m compileall app
if ($LASTEXITCODE -ne 0) { throw "Backend compile check failed." }

Set-Location (Join-Path $root "..\frontend\admin-dashboard")
npm run lint
if ($LASTEXITCODE -ne 0) { throw "Admin dashboard lint failed." }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Admin dashboard build failed." }

Set-Location (Join-Path $root "..\frontend\desktop-agent")
npm run lint
if ($LASTEXITCODE -ne 0) { throw "Desktop app lint failed." }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Desktop app build failed." }

Set-Location $root
