param(
    [string]$Output = ".\portable"
)

$ErrorActionPreference = "Stop"

$node = (Get-Command node -ErrorAction Stop).Source
$root = Split-Path -Parent $PSScriptRoot

if (Test-Path $Output) {
    Remove-Item -Recurse -Force $Output
}

New-Item -ItemType Directory -Force -Path $Output | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Output "src") | Out-Null

Copy-Item $node (Join-Path $Output "node.exe")
Copy-Item (Join-Path $root "src\*.js") (Join-Path $Output "src")
Copy-Item (Join-Path $root "config.example.json") (Join-Path $Output "config.json")
Copy-Item (Join-Path $root "start.bat") (Join-Path $Output "start.bat")
Copy-Item (Join-Path $root "README.md") (Join-Path $Output "README.md")

Write-Host ""
Write-Host "Portable package created:" -ForegroundColor Green
Write-Host (Resolve-Path $Output)
Write-Host ""
Write-Host "No npm install is required on the field PC."
Write-Host "Edit config.json and double-click start.bat."
