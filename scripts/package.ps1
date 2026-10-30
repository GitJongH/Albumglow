# Builds dist/albumglow-v<version>.zip containing only the files the extension needs.
# Usage (from the project root):  powershell -ExecutionPolicy Bypass -File scripts/package.ps1
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 misreads non-ASCII text in BOM-less files.

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$dist = Join-Path $root 'dist'
$out = Join-Path $dist ("albumglow-v" +$manifest.version + ".zip")

New-Item -ItemType Directory -Force $dist | Out-Null
if (Test-Path $out) { Remove-Item $out }

# tar.exe (bsdtar, bundled with Windows 10+) writes zip entries with forward slashes,
# which Chrome expects. Compress-Archive in Windows PowerShell 5.1 does not.
Push-Location $root
try {
  # Use the Windows tar explicitly: Git Bash puts GNU tar first on PATH and it cannot handle C:\ paths.
  & (Join-Path $env:SystemRoot 'System32\tar.exe') -a -c -f $out manifest.json background.js LICENSE content popup icons
  if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host "Created $out"
