param(
  [string]$TargetRoot = "C:\Users\TOBE12\Documents\Codex\2026-09-06\https-github-com-sonjh-github-forest\work\telemetry-20260912"
)
$ErrorActionPreference = "Continue"
$pidsFile = Join-Path $TargetRoot "field-service-pids.json"
if (!(Test-Path $pidsFile)) {
  Write-Host "No FIELD PID file: $pidsFile"
  exit 0
}
try { $data = Get-Content -LiteralPath $pidsFile -Raw | ConvertFrom-Json } catch {
  Write-Warning "Could not read FIELD PID file: $($_.Exception.Message)"
  exit 1
}
foreach ($name in @("front","uplink","core")) {
  $id = [int]$data.$name
  if ($id -le 0) { continue }
  $process = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (!$process) {
    Write-Host "$name PID $id already stopped"
    continue
  }
  & taskkill.exe /PID $id /T /F 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host "Stopped $name process tree PID $id" }
  else { Write-Warning "Could not stop $name PID $id; inspect manually." }
}
Remove-Item -LiteralPath $pidsFile -Force -ErrorAction SilentlyContinue
Write-Host "FIELD services stop requested."
