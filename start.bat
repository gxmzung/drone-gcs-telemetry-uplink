@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0config.bat" (
  call "%~dp0config.bat"
)

if exist "%~dp0node.exe" (
  "%~dp0node.exe" "%~dp0src\index.js"
) else (
  where node >nul 2>nul

  if errorlevel 1 (
    echo [ERROR] node.exe not found.
    echo Use the portable package or install Node.js.
    pause
    exit /b 1
  )

  node "%~dp0src\index.js"
)

if errorlevel 1 pause
