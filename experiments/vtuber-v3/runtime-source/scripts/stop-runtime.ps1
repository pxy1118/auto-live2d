$ErrorActionPreference = 'Stop'
$runtimeRoot = Split-Path -Parent $PSScriptRoot
$demoStateFile = Join-Path $runtimeRoot '.runtime/server-process.json'
if (-not (Test-Path -LiteralPath $demoStateFile)) { Write-Output 'No background demo process is registered. Use Ctrl+C for a foreground npm run dev session.'; exit 0 }
$demoState = Get-Content -LiteralPath $demoStateFile -Raw | ConvertFrom-Json
$demoProcess = Get-Process -Id $demoState.pid -ErrorAction SilentlyContinue
if ($demoProcess) {
    $demoCommand = Get-CimInstance Win32_Process -Filter "ProcessId=$($demoState.pid)"
    if ($demoProcess.StartTime.ToUniversalTime().Ticks -ne ([DateTimeOffset]$demoState.startTimeUtc).UtcDateTime.Ticks -or $demoCommand.CommandLine -notmatch 'server[\\/]index\.ts' -or $demoState.root -ne $runtimeRoot) {
        throw 'Process ownership check failed. No process was stopped.'
    }
    Stop-Process -Id $demoProcess.Id
    Write-Output "Stopped demo PID $($demoProcess.Id)."
} else { Write-Output 'The registered demo process is already stopped.' }
Remove-Item -LiteralPath $demoStateFile

