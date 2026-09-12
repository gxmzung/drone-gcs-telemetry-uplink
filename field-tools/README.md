# MD1000 FIELD tools

Portable copies of the local FIELD scripts used for the Sep 14 MD1000 flight integration.

Expected workspace layout:

```text
<workspace>/
  front/
  core/
  uplink/
```

From a home/alternate clone, pass the workspace root explicitly because the scripts retain the office default path for compatibility:

```powershell
$work = "C:\path\to\workspace"
PowerShell -ExecutionPolicy Bypass -File ".\uplink\field-tools\PREP_FIELD_MD1000.ps1" -TargetRoot $work
PowerShell -ExecutionPolicy Bypass -File ".\uplink\field-tools\RUN_FIELD_MD1000.ps1" -TargetRoot $work -SkipBuild
PowerShell -ExecutionPolicy Bypass -File ".\uplink\field-tools\CHECK_FIELD_MD1000.ps1" -TargetRoot $work
PowerShell -ExecutionPolicy Bypass -File ".\uplink\field-tools\STOP_FIELD_MD1000.ps1" -TargetRoot $work
```

FIELD mode uses real QGroundControl forwarding on UDP 14551. Synthetic feed is not started by these scripts.
