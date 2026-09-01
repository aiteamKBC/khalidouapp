$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$desktop = Join-Path $root "desktop-agent"
$source = Join-Path $desktop "native\input-probe\InputProbe.cs"
$outputDirectory = Join-Path $desktop "native-bin"
$output = Join-Path $outputDirectory "KhaliduoInputProbe.exe"
$compilerCandidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$compiler = $compilerCandidates |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1

if (-not $compiler) {
    throw "The Windows C# compiler required for the input-integrity probe was not found."
}
if (-not (Test-Path -LiteralPath $source)) {
    throw "Input-integrity probe source was not found: $source"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
& $compiler /nologo /optimize+ /target:exe /platform:anycpu "/out:$output" $source
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) {
    throw "Input-integrity probe compilation failed."
}

Write-Host "Input-integrity probe created at: $output"
