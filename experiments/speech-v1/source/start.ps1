param([switch]$NoBrowser,[ValidateSet('cuda','cpu')][string]$Device='cuda')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$latentLinuxRoot=(& wsl.exe --distribution Ubuntu-24.04 --exec wslpath -u $PSScriptRoot).Trim()
& wsl.exe --distribution Ubuntu-24.04 --cd $latentLinuxRoot --exec python3 latent/manage.py start --device $Device
if($LASTEXITCODE -ne 0){throw 'Latent model startup failed; see .runtime/latent.log'}
& wsl.exe --distribution Ubuntu-24.04 --cd $latentLinuxRoot --exec python3 -m speech.manage start --device $Device
if($LASTEXITCODE -ne 0){throw 'TTS startup failed; see .runtime/tts.log and speech/config.json'}
& (Join-Path $PSScriptRoot 'scripts/start-runtime.ps1') -NoBrowser
if(-not $NoBrowser){Start-Process 'http://127.0.0.1:8765/'}
