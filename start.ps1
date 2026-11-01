param([switch]$NoBrowser,[ValidateSet('cuda','cpu')][string]$Device='cuda')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$launcherArguments=@((Join-Path $PSScriptRoot 'main.py'),'--device',$Device)
if($NoBrowser){$launcherArguments+='--no-browser'}
& python @launcherArguments
if($LASTEXITCODE -ne 0){throw 'Launcher exited with an error; see .runtime logs.'}
