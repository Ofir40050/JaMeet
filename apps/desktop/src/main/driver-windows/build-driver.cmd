@echo off
setlocal enabledelayedexpansion

echo [JaMeetRemote] Building Windows JaMeet Remote WaveRT Driver...
set DRIVER_DIR=%~dp0

where msbuild >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [JaMeetRemote] Compiling JaMeetRemote.vcxproj with MSBuild...
    msbuild "%DRIVER_DIR%JaMeetRemote.vcxproj" /p:Configuration=Release /p:Platform=x64 /v:m
    if %ERRORLEVEL% NEQ 0 (
        echo [JaMeetRemote] Error: MSBuild failed with error %ERRORLEVEL%
        exit /b %ERRORLEVEL%
    )
    echo [JaMeetRemote] Driver built successfully.
    exit /b 0
) else (
    echo [JaMeetRemote] Note: MSBuild/WDK not found in current PATH. Ensure Visual Studio with WDK is installed.
    exit /b 1
)
