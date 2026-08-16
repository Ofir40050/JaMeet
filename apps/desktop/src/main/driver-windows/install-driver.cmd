@echo off
setlocal enabledelayedexpansion

echo [JaMeetRemote] Installing Windows JaMeet Remote virtual audio driver...
set DRIVER_DIR=%~dp0
set INF_PATH=%DRIVER_DIR%JaMeetRemote.inf

if not exist "%INF_PATH%" (
    echo [JaMeetRemote] Error: Could not find JaMeetRemote.inf at %INF_PATH%
    exit /b 1
)

:: Use Microsoft PnPUtil to install driver package into DriverStore and install endpoint
pnputil.exe /add-driver "%INF_PATH%" /install
if %ERRORLEVEL% NEQ 0 (
    echo [JaMeetRemote] Warning: PnPUtil returned exit code %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)

echo [JaMeetRemote] JaMeet Remote driver installed successfully.
exit /b 0
