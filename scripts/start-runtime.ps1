param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$demoRoot = Split-Path -Parent $PSScriptRoot
$demoRuntime = Join-Path $demoRoot '.runtime'
$demoStateFile = Join-Path $demoRuntime 'server-process.json'
$demoUrl = 'http://127.0.0.1:8765/'
Set-Location -LiteralPath $demoRoot

if (Test-Path -LiteralPath $demoStateFile) {
    $demoState = Get-Content -LiteralPath $demoStateFile -Raw | ConvertFrom-Json
    $demoExisting = Get-Process -Id $demoState.pid -ErrorAction SilentlyContinue
    if ($demoExisting -and $demoExisting.StartTime.ToUniversalTime().Ticks -eq ([DateTimeOffset]$demoState.startTimeUtc).UtcDateTime.Ticks) {
        Write-Output "Demo already running: $demoUrl (PID $($demoState.pid))"
        if (-not $NoBrowser) { Start-Process $demoUrl }
        exit 0
    }
}
if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 8765 is already used. Stop the existing demo terminal or choose another PORT with npm run dev.'
}
if (-not (Test-Path -LiteralPath (Join-Path $demoRoot 'node_modules/tsx'))) {
    & npm.cmd ci --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
New-Item -ItemType Directory -Path $demoRuntime -Force | Out-Null
$demoNode = (Get-Command node.exe).Source
$demoArguments = @('--import', 'tsx', 'server/index.ts', '--production')
$demoProcess = Start-Process -FilePath $demoNode -ArgumentList $demoArguments -WorkingDirectory $demoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $demoRuntime 'server.log') -RedirectStandardError (Join-Path $demoRuntime 'server-error.log') -PassThru
$demoStartedUtc = $demoProcess.StartTime.ToUniversalTime().ToString('o')
$demoReady = $false
for ($demoAttempt = 0; $demoAttempt -lt 30; $demoAttempt++) {
    $demoProcess.Refresh()
    if ($demoProcess.HasExited) { throw "Server exited. See $demoRuntime/server-error.log" }
    try {
        $demoHealth = Invoke-RestMethod -Uri ($demoUrl + 'api/health') -TimeoutSec 1
        if ($demoHealth.ok) { $demoReady = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 250
}
if (-not $demoReady) {
    $demoProcess.Refresh()
    if (-not $demoProcess.HasExited -and $demoProcess.StartTime.ToUniversalTime().ToString('o') -eq $demoStartedUtc) { Stop-Process -Id $demoProcess.Id }
    throw 'Server did not become ready; see .runtime logs.'
}
@{ pid = $demoProcess.Id; startTimeUtc = $demoStartedUtc; url = $demoUrl; root = $demoRoot } | ConvertTo-Json | Set-Content -LiteralPath $demoStateFile -Encoding UTF8
Write-Output "Demo running: $demoUrl (PID $($demoProcess.Id))"
Write-Output 'Stop with: powershell -NoProfile -ExecutionPolicy Bypass -File .\stop.ps1'
if (-not $NoBrowser) { Start-Process $demoUrl }

