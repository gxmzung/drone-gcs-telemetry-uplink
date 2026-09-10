@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0config.json" (
  echo [ERROR] config.json not found.
  pause
  exit /b 1
)

if exist "%~dp0node.exe" (
  "%~dp0node.exe" "%~dp0src\index.js" --config "%~dp0config.json"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] node.exe not found. Use the portable package or install Node.js.
    pause
    exit /b 1
  )
  node "%~dp0src\index.js" --config "%~dp0config.json"
)

if errorlevel 1 pause
