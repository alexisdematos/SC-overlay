# Construit l'installeur signe et ecrit latest.json, prets a etre envoyes dans une release GitHub.
# Usage: powershell -File scripts\release.ps1 [-Key C:\chemin\cle.key] [-Notes "texte"] [-SkipSidecar]
# Le mot de passe de la cle est demande ici, jamais ecrit sur disque.
param(
  [string]$Key = (Join-Path $PSScriptRoot "..\..\sc-overlay-updater.key"),
  [string]$Notes = "",
  [switch]$SkipSidecar
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$conf = Get-Content (Join-Path $root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version
$cargo = (Select-String -Path (Join-Path $root "src-tauri\Cargo.toml") -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1).Matches.Groups[1].Value
if ($cargo -ne $version) { throw "Versions differentes: tauri.conf.json=$version, Cargo.toml=$cargo" }
if (-not (Test-Path $Key)) { throw "Cle absente: $Key" }

if (-not $SkipSidecar) { & (Join-Path $PSScriptRoot "prepare-sidecar.ps1"); if ($LASTEXITCODE) { throw "prepare-sidecar a echoue" } }

$secure = Read-Host "Mot de passe de la cle de signature" -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content (Resolve-Path $Key).Path -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
try {
  Push-Location (Join-Path $root "src-tauri")
  try { & npx --yes "@tauri-apps/cli@2" build; if ($LASTEXITCODE) { throw "tauri build a echoue ($LASTEXITCODE)" } } finally { Pop-Location }
} finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
}

$dir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$setup = Join-Path $dir "SC-overlay_${version}_x64-setup.exe"
$sig = "$setup.sig"
if (-not (Test-Path $setup) -or -not (Test-Path $sig)) { throw "Installeur ou signature absents dans $dir" }

$latest = [ordered]@{
  version  = $version
  notes    = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content $sig -Raw).Trim()
      url       = "https://github.com/alexisdematos/SC-overlay/releases/download/v$version/SC-overlay_${version}_x64-setup.exe"
    }
  }
}
$out = Join-Path $dir "latest.json"
[System.IO.File]::WriteAllText($out, ($latest | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Pret dans $dir :"
Write-Host "  SC-overlay_${version}_x64-setup.exe, .sig, latest.json"
Write-Host "Envoie ces fichiers dans la release v$version (tag v$version) du depot."
