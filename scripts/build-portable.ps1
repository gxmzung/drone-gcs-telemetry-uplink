param(
    [string]$Output = ".\portable"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source

if (Test-Path $Output) {
    Remove-Item -Recurse -Force $Output
}

New-Item -ItemType Directory -Force -Path $Output | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Output "src") | Out-Null

Copy-Item $node (Join-Path $Output "node.exe")

Copy-Item `
    (Join-Path $root "src\*") `
    (Join-Path $Output "src") `
    -Recurse

Copy-Item `
    (Join-Path $root "package.json") `
    (Join-Path $Output "package.json")

Copy-Item `
    (Join-Path $root "start.bat") `
    (Join-Path $Output "start.bat")

Copy-Item `
    (Join-Path $root "config.example.bat") `
    (Join-Path $Output "config.bat")

if (Test-Path (Join-Path $root "WINDOWS_UPLINK.md")) {
    Copy-Item `
        (Join-Path $root "WINDOWS_UPLINK.md") `
        (Join-Path $Output "WINDOWS_UPLINK.md")
}

Write-Host ""
Write-Host "Portable package created:"
Write-Host (Resolve-Path $Output)
Write-Host ""
Write-Host "No npm install is required on the field PC."
Write-Host "Edit config.bat and run start.bat."
