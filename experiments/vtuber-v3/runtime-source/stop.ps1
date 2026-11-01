$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'scripts/stop-runtime.ps1')
$latentLinuxRoot=(& wsl.exe --distribution Ubuntu-24.04 --exec wslpath -u $PSScriptRoot).Trim()
& wsl.exe --distribution Ubuntu-24.04 --cd $latentLinuxRoot --exec python3 latent/manage.py stop
if($LASTEXITCODE -ne 0){throw 'Latent process ownership check or stop failed.'}
