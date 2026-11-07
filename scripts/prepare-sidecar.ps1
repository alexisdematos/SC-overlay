# Construit le service SC-hauling et le copie ou Tauri l'attend (externalBin).
# Usage: powershell -File scripts\prepare-sidecar.ps1 [-Hauling C:\chemin\SC-hauling] [-SkipBuild]
param(
  [string]$Hauling = (Join-Path $PSScriptRoot "..\..\SC-hauling"),
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$Hauling = (Resolve-Path $Hauling).Path

$triple = ((& rustc -vV) | Where-Object { $_ -like "host:*" }) -replace "host:\s*", ""
if (-not $triple) { throw "rustc introuvable: impossible de lire le triplet" }

if (-not $SkipBuild) {
  $py = Join-Path $Hauling ".venv-build\Scripts\python.exe"
  if (-not (Test-Path $py)) { throw "Venv de build absent: $py (voir README de SC-hauling)" }
  Push-Location $Hauling
  try { & $py build.py; if ($LASTEXITCODE) { throw "build.py a echoue ($LASTEXITCODE)" } } finally { Pop-Location }
}

$src = Join-Path $Hauling "dist\schauling-service.exe"
if (-not (Test-Path $src)) { throw "Service absent: $src" }
$dir = Join-Path $PSScriptRoot "..\src-tauri\binaries"
New-Item -ItemType Directory -Force $dir | Out-Null
$dst = Join-Path $dir "schauling-service-$triple.exe"
Copy-Item $src $dst -Force
Write-Host "OK: $dst"
