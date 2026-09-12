param(
  [string]$TargetRoot = "C:\Users\TOBE12\Documents\Codex\2026-09-06\https-github-com-sonjh-github-forest\work\telemetry-20260912",
  [string]$EventId = "field-md1000-local"
)
$ErrorActionPreference = "Continue"
Write-Host "=== PORTS ==="
Get-NetTCPConnection -LocalPort 15174,18020 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table
Get-NetUDPEndpoint -LocalPort 14550,14551 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table

Write-Host "`n=== CORE TELEMETRY ==="
try {
  $url = "http://127.0.0.1:18020/api/v1/dashboard/telemetry/drones?eventId=$([uri]::EscapeDataString($EventId))"
  $rows = (Invoke-RestMethod -Uri $url -TimeoutSec 3).data
  if (!$rows -or $rows.Count -eq 0) { Write-Host "No current GLOBAL_POSITION_INT telemetry in Core." }
  else { $rows | Select-Object assetId,qualityStatus,observedAt,latitude,longitude,altitude,sequence | Format-Table }
} catch { Write-Warning "Core telemetry query failed: $($_.Exception.Message)" }

Write-Host "`n=== LATEST UPLINK STATUS ==="
$pointer = Join-Path $TargetRoot ".field-run-latest.txt"
if (Test-Path $pointer) {
  $run = (Get-Content -LiteralPath $pointer -Raw).Trim()
  $out = Join-Path $run "logs\uplink.out.log"
  if (Test-Path $out) {
    Get-Content -LiteralPath $out | Select-String 'UPLINK_STATUS' | Select-Object -Last 2 | ForEach-Object { $_.Line }
  } else { Write-Host "No uplink.out.log yet: $out" }
} else { Write-Host "No FIELD run pointer." }

Write-Host "`nSUCCESS GATE: validatedMessageCounts[33] > 0 -> telemetryCount > 0 -> Core row -> dashboard marker"
