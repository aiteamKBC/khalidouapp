[CmdletBinding()]
param(
    [ValidateSet('quick', 'nightly')][string]$Profile = 'quick',
    [ValidateSet('all', 'unit', 'integration', 'load', 'native')][string]$Suite = 'all',
    [Nullable[int]]$Seed = $null,
    [switch]$InstallTools,
    [switch]$IncludeSleep
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$python = Join-Path $root 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { $python = Join-Path $root 'backend/.venv/bin/python' }
if ($env:KHALIDUO_TEST_PYTHON) { $python = $env:KHALIDUO_TEST_PYTHON }
if (-not (Test-Path -LiteralPath $python)) { throw 'Create backend/.venv and install backend/requirements-test.txt first.' }
$arguments = @((Join-Path $PSScriptRoot 'test_khaliduo.py'), '--profile', $Profile, '--suite', $Suite)
if ($null -ne $Seed) { $arguments += @('--seed', [string]$Seed) }
if ($InstallTools) { $arguments += '--install-tools' }
if ($IncludeSleep) { $arguments += '--include-sleep' }
& $python @arguments
exit $LASTEXITCODE
