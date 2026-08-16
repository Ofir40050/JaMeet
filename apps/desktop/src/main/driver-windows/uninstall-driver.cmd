@echo off
setlocal enabledelayedexpansion

echo [JaMeetRemote] Uninstalling Windows JaMeet Remote virtual audio driver...
set DRIVER_DIR=%~dp0
set INF_PATH=%DRIVER_DIR%JaMeetRemote.inf

:: Remove driver package and uninstall all active device nodes
pnputil.exe /delete-driver JaMeetRemote.inf /uninstall /force
set PNP_RESULT=%ERRORLEVEL%
if %PNP_RESULT% NEQ 0 (
    echo [JaMeetRemote] Driver removal status: %PNP_RESULT%
)

pnputil.exe /scan-devices

echo [JaMeetRemote] JaMeet Remote driver uninstalled cleanly.
exit /b 0
