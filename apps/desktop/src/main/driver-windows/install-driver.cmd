@echo off
setlocal enabledelayedexpansion

echo [JaMeetRemote] Installing Windows JaMeet Remote virtual audio driver...
set DRIVER_DIR=%~dp0
set INF_PATH=%DRIVER_DIR%JaMeetRemote.inf

if not exist "%INF_PATH%" (
    echo [JaMeetRemote] Error: Could not find JaMeetRemote.inf at %INF_PATH%
    exit /b 1
)

:: 1. Add and install driver package into Windows DriverStore
pnputil.exe /add-driver "%INF_PATH%" /install
set PNP_RESULT=%ERRORLEVEL%
if %PNP_RESULT% NEQ 0 (
    echo [JaMeetRemote] Warning: PnPUtil returned exit code %PNP_RESULT%
)

:: 2. Trigger PnP device enumeration to bind root device instance
pnputil.exe /scan-devices

echo [JaMeetRemote] JaMeet Remote driver installed successfully.
exit /b 0
