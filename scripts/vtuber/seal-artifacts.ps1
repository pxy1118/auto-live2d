#requires -Version 7.0
param([switch]$VerifyOnly)
$ErrorActionPreference='Stop'
$artifactWorkspace=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Test-ArtifactManifest([string]$folder) {
 $manifest=Get-Content -LiteralPath (Join-Path $folder 'FULL-MANIFEST.json') -Raw | ConvertFrom-Json
 $actual=@(Get-ChildItem -LiteralPath $folder -Recurse -File | Where-Object {
  $relative=[IO.Path]::GetRelativePath($folder,$_.FullName).Replace('\','/');$excluded=$_.FullName -eq (Join-Path $folder 'FULL-MANIFEST.json')
  foreach ($pattern in $manifest.excludes) {if ($_.Name -like $pattern -or $relative -like "*/$pattern/*" -or $relative -like "$pattern/*") {$excluded=$true}}
  -not $excluded
 })
 if ($actual.Count -ne $manifest.files.Count) {throw "Artifact file count changed: $folder"}
 foreach ($entry in $manifest.files) {
  $file=Join-Path $folder $entry.path
  if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower() -ne $entry.sha256) {throw "Artifact changed: $file"}
 }
 return @{files=$manifest.files.Count;verified=$true}
}
$artifactAudit=[ordered]@{}
foreach ($relative in @('datasets/vtuber-v2','experiments/vtuber-v2')) {$artifactAudit[$relative]=Test-ArtifactManifest (Join-Path $artifactWorkspace $relative)}
if (-not $VerifyOnly) {$artifactAudit | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $artifactWorkspace 'experiments/vtuber-v3/previous-version-integrity.json') -Encoding utf8}
foreach ($relative in @('datasets/vtuber-v3','experiments/vtuber-v3')) {
 $folder=Join-Path $artifactWorkspace $relative;$manifestFile=Join-Path $folder 'FULL-MANIFEST.json'
 if (-not (Test-Path -LiteralPath $manifestFile)) {
  if ($VerifyOnly) {throw "Missing artifact manifest: $manifestFile"}
  $files=@(Get-ChildItem -LiteralPath $folder -Recurse -File | Sort-Object FullName | ForEach-Object {@{path=[IO.Path]::GetRelativePath($folder,$_.FullName).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()}})
  @{schema='artifact_manifest.v1';created_utc=[DateTimeOffset]::UtcNow.ToString('o');files=$files;human_reviewed=$false} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestFile -Encoding utf8
 }
 $artifactAudit[$relative]=Test-ArtifactManifest $folder
}
$artifactAudit | ConvertTo-Json -Depth 6
