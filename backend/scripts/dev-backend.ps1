param([switch]$CheckOnly)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backend = $root
$venvPython = Join-Path $backend ".venv\Scripts\python.exe"
$envFile = Join-Path $backend ".env"

if (-not (Test-Path -LiteralPath $venvPython)) {
  throw "Backend virtual environment was not found. Create it in backend/.venv and install requirements first."
}

if (-not $env:DATABASE_URL -and -not (Test-Path -LiteralPath $envFile)) {
  throw "DATABASE_URL is required. Set it in the current shell or create backend/.env."
}

Set-Location $backend
# Settings already loads backend/.env. Do not inject fallback secrets into the
# process environment: environment variables override that file and can invalidate
# existing login/device tokens and JWT-derived encrypted salary records.
& $venvPython -m scripts.check_environment
if ($LASTEXITCODE -ne 0) {
  throw "Backend configuration needs attention. No migrations or server startup were attempted."
}
if ($CheckOnly) {
  exit 0
}

& $venvPython -m alembic upgrade head
if ($LASTEXITCODE -ne 0) {
  throw "Database migration failed."
}
& $venvPython -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
