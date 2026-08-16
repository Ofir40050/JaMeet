@echo off
setlocal enabledelayedexpansion

echo [JaMeetRemote] Building Windows JaMeet Remote WaveRT Driver...
set DRIVER_DIR=%~dp0

:: In WDK environment:
:: msbuild JaMeetRemote.vcxproj /p:Configuration=Release /p:Platform=x64
echo [JaMeetRemote] Driver sources ready in %DRIVER_DIR%
exit /b 0
