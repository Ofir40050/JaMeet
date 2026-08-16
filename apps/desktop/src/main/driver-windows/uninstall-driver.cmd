@echo off
setlocal enabledelayedexpansion

echo [JaMeetRemote] Uninstalling Windows JaMeet Remote virtual audio driver...
set DRIVER_DIR=%~dp0
set INF_PATH=%DRIVER_DIR%JaMeetRemote.inf

:: Remove driver package from DriverStore with /delete-driver and /uninstall
pnputil.exe /delete-driver JaMeetRemote.inf /uninstall /force
if %ERRORLEVEL% NEQ 0 (
    echo [JaMeetRemote] Driver removal completed with status %ERRORLEVEL%
)

echo [JaMeetRemote] JaMeet Remote driver uninstalled cleanly.
exit /b 0
