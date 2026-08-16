@echo off
setlocal enabledelayedexpansion

echo [JaMeetRemote] Installing Windows JaMeet Remote virtual audio driver...
set DRIVER_DIR=%~dp0
set INF_PATH=%DRIVER_DIR%package\JaMeetRemote.inf
if not exist "%INF_PATH%" set INF_PATH=%DRIVER_DIR%JaMeetRemote.inf

if not exist "%INF_PATH%" (
    echo [JaMeetRemote] Error: Could not find JaMeetRemote.inf at %INF_PATH%
    exit /b 1
)

:: 1. Attempt installation via native JaMeet device installer if available
set INSTALLER_EXE=%DRIVER_DIR%..\..\..\bin\jameet-device-installer.exe
if not exist "%INSTALLER_EXE%" set INSTALLER_EXE=%DRIVER_DIR%jameet-device-installer.exe

if exist "%INSTALLER_EXE%" (
    echo [JaMeetRemote] Invoking jameet-device-installer.exe...
    "%INSTALLER_EXE%" install "%INF_PATH%"
    set INSTALL_STATUS=%ERRORLEVEL%
    if !INSTALL_STATUS! NEQ 0 (
        echo [JaMeetRemote] Error: Device installation failed with code !INSTALL_STATUS!
        exit /b !INSTALL_STATUS!
    )
    echo [JaMeetRemote] JaMeet Remote driver installed successfully.
    exit /b 0
)

:: 2. Fallback: Standard PnPUtil DriverStore installation
echo [JaMeetRemote] Invoking PnPUtil...
pnputil.exe /add-driver "%INF_PATH%" /install
set PNP_RESULT=%ERRORLEVEL%
if %PNP_RESULT% NEQ 0 if %PNP_RESULT% NEQ 259 if %PNP_RESULT% NEQ 3010 (
    echo [JaMeetRemote] Error: PnPUtil returned error code %PNP_RESULT%
    exit /b %PNP_RESULT%
)

pnputil.exe /scan-devices
echo [JaMeetRemote] JaMeet Remote driver staged successfully.
exit /b 0
