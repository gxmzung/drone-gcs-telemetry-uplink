param(
  [string]$TargetRoot = "C:\Users\TOBE12\Documents\Codex\2026-09-06\https-github-com-sonjh-github-forest\work\telemetry-20260912",
  [string]$EventId = "field-md1000-local"
)
$ErrorActionPreference = "Stop"

function Ensure-Npm([string]$Directory, [string]$Probe) {
  if (!(Test-Path (Join-Path $Directory $Probe))) {
    Write-Host "npm dependencies missing in $Directory -> npm ci"
    Push-Location $Directory
    try {
      npm ci
      if ($LASTEXITCODE -ne 0) { throw "npm ci failed: $Directory" }
    } finally { Pop-Location }
  }
}

$core = Join-Path $TargetRoot "core"
$front = Join-Path $TargetRoot "front"
$uplink = Join-Path $TargetRoot "uplink"
foreach ($dir in @($core,$front,$uplink)) { if (!(Test-Path $dir)) { throw "Missing repo: $dir" } }

Ensure-Npm $core "node_modules\.bin\tsx.cmd"
Ensure-Npm $front "node_modules\.bin\vite.cmd"

Write-Host "[1/3] Core tests/typecheck/build"
Push-Location $core
try {
  npm test; if ($LASTEXITCODE -ne 0) { throw "core tests failed" }
  npm run typecheck; if ($LASTEXITCODE -ne 0) { throw "core typecheck failed" }
  npm run build; if ($LASTEXITCODE -ne 0) { throw "core build failed" }
} finally { Pop-Location }

Write-Host "[2/3] Uplink tests"
Push-Location $uplink
try {
  npm test; if ($LASTEXITCODE -ne 0) { throw "uplink tests failed" }
} finally { Pop-Location }

Write-Host "[3/3] Front tests + FIELD build"
Push-Location $front
try {
  Remove-Item Env:VITE_LOCAL_E2E_ENABLED -ErrorAction SilentlyContinue
  $env:VITE_FIELD_MODE_ENABLED = "1"
  $env:VITE_FIELD_EVENT_ID = $EventId
  $env:VITE_FIELD_ASSET_CODE = "MD1000-01"
  $env:VITE_API_BASE_URL = "http://127.0.0.1:18020"
  $env:VITE_DASHBOARD_API_BASE_URL = "http://127.0.0.1:18020"
  npm test; if ($LASTEXITCODE -ne 0) { throw "front tests failed" }
  npm run build; if ($LASTEXITCODE -ne 0) { throw "front field build failed" }
} finally {
  Remove-Item Env:VITE_FIELD_MODE_ENABLED,Env:VITE_FIELD_EVENT_ID,Env:VITE_FIELD_ASSET_CODE,Env:VITE_API_BASE_URL,Env:VITE_DASHBOARD_API_BASE_URL -ErrorAction SilentlyContinue
  Pop-Location
}

Write-Host "FIELD PREP PASS"
Write-Host "EventId: $EventId"
Write-Host "Next: PowerShell -ExecutionPolicy Bypass -File `"$TargetRoot\RUN_FIELD_MD1000.ps1`""
