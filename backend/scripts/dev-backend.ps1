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

if (-not $env:JWT_SECRET_KEY) {
  $env:JWT_SECRET_KEY = "your-dev-jwt-secret"
}

if (-not $env:DEVICE_TOKEN_SECRET) {
  $env:DEVICE_TOKEN_SECRET = "your-dev-device-secret"
}

Set-Location $backend
& $venvPython -m alembic upgrade head
if ($LASTEXITCODE -ne 0) {
  throw "Database migration failed."
}
& $venvPython -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
