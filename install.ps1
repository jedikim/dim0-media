# Dim0 desktop installer for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/vcmf/dim0/main/install.ps1 | iex
#
# Downloads the newest release's installer and runs it. Fetched from the terminal,
# so it carries no mark-of-the-web and skips the SmartScreen prompt a browser
# download would trigger. (A UAC elevation prompt for the installer is still expected.)
$ErrorActionPreference = "Stop"
$repo = "vcmf/dim0"

Write-Host "`nInstalling Dim0..."
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
Write-Host "  latest release: $($release.tag_name)"

# Prefer the NSIS setup .exe; fall back to the MSI.
$asset = $release.assets | Where-Object { $_.name -like "*setup.exe" } | Select-Object -First 1
if (-not $asset) { $asset = $release.assets | Where-Object { $_.name -like "*.msi" } | Select-Object -First 1 }
if (-not $asset) { throw "no Windows build found in $($release.tag_name)" }

$out = Join-Path $env:TEMP $asset.name
Write-Host "  downloading $($asset.name)"
Invoke-WebRequest $asset.browser_download_url -OutFile $out

Write-Host "  launching the installer..."
Start-Process -FilePath $out -Wait
Write-Host "`nDone. Dim0 should be in your Start menu.`n"
