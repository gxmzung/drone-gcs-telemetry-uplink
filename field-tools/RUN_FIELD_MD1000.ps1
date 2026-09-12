param(
  [string]$TargetRoot = "C:\Users\TOBE12\Documents\Codex\2026-09-06\https-github-com-sonjh-github-forest\work\telemetry-20260912",
  [string]$EventId = "field-md1000-local",
  [string]$AssetId = "MD1000-01",
  [int]$SystemId = 1,
  [int]$ComponentId = 1,
  [int]$CorePort = 18020,
  [int]$FrontPort = 15174,
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"

$core = Join-Path $TargetRoot "core"
$front = Join-Path $TargetRoot "front"
$uplink = Join-Path $TargetRoot "uplink"
foreach ($dir in @($core,$front,$uplink)) { if (!(Test-Path $dir)) { throw "Missing repo: $dir" } }

function PortOwnerTcp([int]$Port) {
  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}
function PortOwnerUdp([int]$Port) {
  @(Get-NetUDPEndpoint -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}
function Wait-Http([string]$Url, [int]$TimeoutSec = 25) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return }
    } catch {}
    Start-Sleep -Milliseconds 350
  } while ((Get-Date) -lt $deadline)
  throw "HTTP timeout: $Url"
}
function Start-Logged([string]$Name, [string]$FilePath, [string[]]$ArgumentList, [string]$Cwd, [string]$Logs) {
  $out = Join-Path $Logs "$Name.out.log"
  $err = Join-Path $Logs "$Name.err.log"
  Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $Cwd -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
}

# Hard safety gate: field mode must never run beside the synthetic feeder.
$synthetic = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine -match 'synthetic-md1000-feed|RUN_LOCAL_BROWSER_E2E'
})
if ($synthetic.Count -gt 0) {
  $synthetic | Select-Object ProcessId,Name,CommandLine | Format-List | Out-Host
  throw "Synthetic E2E/feed process detected. Stop it before FIELD mode."
}

$tcpBusy = @((PortOwnerTcp $CorePort) + (PortOwnerTcp $FrontPort) | Where-Object { $_ })
$udpBusy = @(PortOwnerUdp 14551 | Where-Object { $_ })
if ($tcpBusy.Count -gt 0 -or $udpBusy.Count -gt 0) {
  Write-Host "FIELD ports are not clean." -ForegroundColor Yellow
  Get-NetTCPConnection -LocalPort $CorePort,$FrontPort -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table | Out-Host
  Get-NetUDPEndpoint -LocalPort 14551 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table | Out-Host
  throw "Stop the listed process(es) before starting FIELD mode."
}

if (!(Test-Path (Join-Path $front "node_modules\.bin\vite.cmd"))) { throw "Front dependencies missing. Run PREP_FIELD_MD1000.ps1 first." }
if (!(Test-Path (Join-Path $core "node_modules\.bin\tsx.cmd"))) { throw "Core dependencies missing. Run PREP_FIELD_MD1000.ps1 first." }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $TargetRoot "field-run-$stamp"
$logs = Join-Path $runDir "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$pointer = Join-Path $TargetRoot ".field-run-latest.txt"
$pidsFile = Join-Path $TargetRoot "field-service-pids.json"
$configFile = Join-Path $runDir "uplink-field.config.json"
Set-Content -LiteralPath $pointer -Value $runDir -Encoding UTF8

$uplinkConfig = [ordered]@{
  udp = [ordered]@{ enabled=$true; forwardEnabled=$false; listenHost="127.0.0.1"; listenPort=14551; targetHost="127.0.0.1"; targetPort=14550 }
  rtsp = [ordered]@{ enabled=$false; listenHost="0.0.0.0"; listenPort=9554; sourceHost="127.0.0.1"; sourcePort=8554 }
  telemetry = [ordered]@{ enabled=$true; systemId=$SystemId; componentId=$ComponentId; endpoint="http://127.0.0.1:$CorePort/api/v1/dashboard/telemetry/drone"; assetId=$AssetId; eventId=$EventId; assetType="UAV"; intervalMs=1000; timeoutMs=3000 }
  logging = [ordered]@{ directory=(Join-Path $runDir "uplink-logs"); statusIntervalSec=5 }
}
$uplinkConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configFile -Encoding UTF8

if (!$SkipBuild) {
  Write-Host "[1/5] Build FIELD front"
  Push-Location $front
  try {
    Remove-Item Env:VITE_LOCAL_E2E_ENABLED -ErrorAction SilentlyContinue
    $env:VITE_FIELD_MODE_ENABLED = "1"
    $env:VITE_FIELD_EVENT_ID = $EventId
    $env:VITE_FIELD_ASSET_CODE = $AssetId
    $env:VITE_API_BASE_URL = "http://127.0.0.1:$CorePort"
    $env:VITE_DASHBOARD_API_BASE_URL = "http://127.0.0.1:$CorePort"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "front FIELD build failed" }
  } finally {
    Remove-Item Env:VITE_FIELD_MODE_ENABLED,Env:VITE_FIELD_EVENT_ID,Env:VITE_FIELD_ASSET_CODE,Env:VITE_API_BASE_URL,Env:VITE_DASHBOARD_API_BASE_URL -ErrorAction SilentlyContinue
    Pop-Location
  }
} else {
  Write-Host "[1/5] Skip front build (using existing dist)"
  if (!(Test-Path (Join-Path $front "dist\index.html"))) { throw "front/dist missing; run without -SkipBuild first." }
}

Write-Host "[2/5] Start local Core :$CorePort"
$coreCmd = "set `"SUPABASE_URL=https://test.supabase.co`"&& set `"SUPABASE_SECRET_KEY=field-local-only`"&& set `"HOST=127.0.0.1`"&& set `"PORT=$CorePort`"&& npm run dev"
$coreProcess = Start-Logged "core" "cmd.exe" @("/d","/s","/c",$coreCmd) $core $logs
Wait-Http "http://127.0.0.1:$CorePort/" 30

Write-Host "[3/5] Start actual MD1000 uplink :14551 -> Core"
$uplinkProcess = Start-Logged "uplink" "node.exe" @("src/index.js","--config",$configFile) $uplink $logs
Start-Sleep -Milliseconds 800

Write-Host "[4/5] Start FIELD front :$FrontPort"
$frontCmd = "npm run preview -- --host 127.0.0.1 --port $FrontPort --strictPort"
$frontProcess = Start-Logged "front" "cmd.exe" @("/d","/s","/c",$frontCmd) $front $logs
$frontUrl = "http://127.0.0.1:$FrontPort/?field=1"
Wait-Http $frontUrl 30

@{
  mode = "PHYSICAL_FIELD_NO_SYNTHETIC"
  eventId = $EventId
  assetId = $AssetId
  systemId = $SystemId
  componentId = $ComponentId
  core = $coreProcess.Id
  uplink = $uplinkProcess.Id
  front = $frontProcess.Id
  runDir = $runDir
  frontUrl = $frontUrl
  createdAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -LiteralPath $pidsFile -Encoding UTF8

Write-Host "[5/5] FIELD ready"
$qgc = Get-NetUDPEndpoint -LocalPort 14550 -ErrorAction SilentlyContinue
if ($qgc) {
  Write-Host "QGC UDP 14550: LISTENING" -ForegroundColor Green
} else {
  Write-Warning "QGC UDP 14550 is not listening yet. Start QGroundControl before physical telemetry test."
}

Write-Host ""
Write-Host "FIELD MODE READY - SYNTHETIC FEED NOT STARTED" -ForegroundColor Green
Write-Host "URL: $frontUrl"
Write-Host "QGC RX: 172.30.1.79:14550 (current field network assumption)"
Write-Host "QGC Forward: 127.0.0.1:14551"
Write-Host "Telemetry identity: SYS$SystemId / COMP$ComponentId"
Write-Host "Position source required: GLOBAL_POSITION_INT(33)"
Write-Host "Logs: $logs"
Write-Host "Check: PowerShell -ExecutionPolicy Bypass -File `"$TargetRoot\CHECK_FIELD_MD1000.ps1`""
Write-Host "Stop : PowerShell -ExecutionPolicy Bypass -File `"$TargetRoot\STOP_FIELD_MD1000.ps1`""
Start-Process $frontUrl
