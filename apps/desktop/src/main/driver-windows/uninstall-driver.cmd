@echo off
setlocal enabledelayedexpansion

echo [JaMeetRemote] Uninstalling Windows JaMeet Remote virtual audio driver...
set DRIVER_DIR=%~dp0

:: 1. Attempt uninstallation via native JaMeet device installer if available
set INSTALLER_EXE=%DRIVER_DIR%..\..\..\bin\jameet-device-installer.exe
if not exist "%INSTALLER_EXE%" set INSTALLER_EXE=%DRIVER_DIR%jameet-device-installer.exe

if exist "%INSTALLER_EXE%" (
    echo [JaMeetRemote] Invoking jameet-device-installer.exe uninstall...
    "%INSTALLER_EXE%" uninstall
)

:: 2. Find published oem*.inf name and delete from DriverStore
for /f "tokens=1,2 delims=:" %%a in ('pnputil.exe /enum-drivers ^| findstr /i /c:"JaMeetRemote.inf" /c:"Published Name"') do (
    set LINE=%%b
)

pnputil.exe /delete-driver JaMeetRemote.inf /uninstall /force >nul 2>&1
pnputil.exe /scan-devices

echo [JaMeetRemote] JaMeet Remote driver uninstalled cleanly.
exit /b 0
