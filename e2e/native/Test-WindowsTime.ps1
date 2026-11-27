[CmdletBinding()]
param([switch]$IncludeSleep, [string]$Report = '')
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $Report) { $Report = Join-Path $repo 'test-reports/native-windows.json' }
New-Item -ItemType Directory -Force (Split-Path $Report -Parent) | Out-Null
$result = [ordered]@{ status = 'blocked'; clock = 'not_run'; timezone = 'not_run'; sleep = 'not_run'; reason = ''; samples = @() }
$machine = Get-CimInstance Win32_ComputerSystem
$isVm = ($machine.Manufacturer + ' ' + $machine.Model) -match 'Virtual Machine|VMware|VirtualBox|KVM|QEMU|Xen|HVM domU'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isVm -or -not $isAdmin -or ($env:KHALIDUO_NATIVE_TEST_VM -ne '1' -and $env:GITHUB_ACTIONS -ne 'true')) {
    $result.reason = 'Requires an explicitly designated, disposable Windows VM with administrator rights; host clock was untouched.'
    $result | ConvertTo-Json | Set-Content -LiteralPath $Report -Encoding UTF8
    Write-Output $result.reason
    exit 2
}
$originalZone = (Get-TimeZone).Id
$originalUtc = [DateTime]::UtcNow
$elapsed = [Diagnostics.Stopwatch]::StartNew()
$observer = $null
$wakeTask = 'KhaliduoTimeTest-' + [Guid]::NewGuid().ToString('N')
try {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command node).Source
    $start.Arguments = '"' + (Join-Path $PSScriptRoot 'clock-observer.mjs') + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $observer = [Diagnostics.Process]::Start($start)
    function Sample {
        $observer.StandardInput.WriteLine('sample')
        $observer.StandardInput.Flush()
        $pending = $observer.StandardOutput.ReadLineAsync()
        if (-not $pending.Wait(10000)) { throw 'Native clock observer timed out' }
        $pending.Result | ConvertFrom-Json
    }
    $before = Sample
    foreach ($hours in @(6, -12)) {
        Set-Date -Date (Get-Date).AddHours($hours) | Out-Null
        $osUtc = [DateTime]::UtcNow
        $after = Sample
        $result.samples += @{ requested_shift_hours = $hours; controller_utc = $osUtc.ToString('o'); observer_os = $after.os; tracking_utc = $after.utc }
        if ([Math]::Abs(($after.utc - $before.utc) - ($after.elapsed - $before.elapsed)) -gt 100) { throw 'UTC changed with the Windows clock' }
        # V8 may cache its Windows wall-clock source briefly. Verify the OS
        # change using the independent controller, not the observer's Date cache.
        $actualOffset = ($osUtc - $originalUtc.Add($elapsed.Elapsed)).TotalMilliseconds
        if ([Math]::Abs($actualOffset) -lt 3600000) { throw 'The controller could not verify an actual OS clock shift' }
    }
    $result.clock = 'passed'
    foreach ($zone in @('China Standard Time', 'GMT Standard Time', 'Nepal Standard Time')) {
        Set-TimeZone -Id $zone
        $after = Sample
        if ([Math]::Abs(($after.utc - $before.utc) - ($after.elapsed - $before.elapsed)) -gt 100) { throw 'UTC changed with the Windows timezone' }
    }
    $result.timezone = 'passed'
    if ($IncludeSleep) {
        # A wake task and >60s suspend exercise the real frozen-gap safeguard.
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -Command "exit 0"'
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(80)
        $settings = New-ScheduledTaskSettingsSet -WakeToRun
        Register-ScheduledTask -TaskName $wakeTask -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
        Add-Type -Path (Join-Path $PSScriptRoot 'Suspend.cs')
        $beforeSleep = Sample
        if (-not [KhaliduoSleep]::Suspend()) { throw 'This VM does not support real suspend/wake' }
        Start-Sleep -Seconds 2
        $afterSleep = Sample
        if ($afterSleep.elapsed - $beforeSleep.elapsed -lt 60001) { throw 'The VM did not spend >60 seconds suspended' }
        if ($afterSleep.worked - $beforeSleep.worked -gt 5) { throw 'Suspended time was counted as work' }
        $result.sleep = 'passed'
    } else {
        $result.sleep = 'requires_dedicated_power_vm'
    }
    $result.status = 'passed'
} catch {
    $result.status = 'failed'
    $result.reason = $_.Exception.Message
} finally {
    # Restore before any report/network activity, even after assertion failure.
    Set-TimeZone -Id $originalZone
    Set-Date -Date ($originalUtc.Add($elapsed.Elapsed).ToLocalTime()) | Out-Null
    Unregister-ScheduledTask -TaskName $wakeTask -Confirm:$false -ErrorAction SilentlyContinue
    if ($observer -and -not $observer.HasExited) { $observer.Kill() }
    $result | ConvertTo-Json | Set-Content -LiteralPath $Report -Encoding UTF8
}
if ($result.status -ne 'passed') { throw $result.reason }
Write-Output 'Native Windows clock/timezone checks passed; original settings restored.'
