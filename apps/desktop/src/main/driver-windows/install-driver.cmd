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

:: Locate native JaMeet device installer in packaged layout (resources\bin) or dev layout (bin)
set INSTALLER_EXE=%DRIVER_DIR%..\bin\jameet-device-installer.exe
if not exist "%INSTALLER_EXE%" set INSTALLER_EXE=%DRIVER_DIR%..\..\bin\jameet-device-installer.exe
if not exist "%INSTALLER_EXE%" set INSTALLER_EXE=%DRIVER_DIR%..\..\..\bin\jameet-device-installer.exe
if not exist "%INSTALLER_EXE%" set INSTALLER_EXE=%DRIVER_DIR%jameet-device-installer.exe

if not exist "%INSTALLER_EXE%" (
    echo [JaMeetRemote] Error: Could not find jameet-device-installer.exe
    exit /b 1
)

echo [JaMeetRemote] Invoking jameet-device-installer.exe from %INSTALLER_EXE%...
"%INSTALLER_EXE%" install "%INF_PATH%"
set INSTALL_STATUS=%ERRORLEVEL%
if %INSTALL_STATUS% NEQ 0 (
    echo [JaMeetRemote] Error: Device installation failed with code %INSTALL_STATUS%
    exit /b %INSTALL_STATUS%
)

echo [JaMeetRemote] JaMeet Remote driver installed successfully.
exit /b 0
