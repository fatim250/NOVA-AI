@echo off
setlocal enabledelayedexpansion

set "RELEASE_DIR=%~dp0NOVA-v2.0.0-win-x64"

echo ================================================================
echo  NOVA v2.0.0 — Portable Windows x64 Release Builder
echo  Output: NOVA-v2.0.0-win-x64\ (NOVA.exe + python\ + web\)
echo ================================================================

:: 1. Optionally compile native\NotchNative.dll if cl.exe or gcc.exe is installed
echo.
echo [1/4] Checking for C compiler (optional NotchNative.dll) ...

where cl.exe >nul 2>nul
if %ERRORLEVEL%==0 (
    echo       Detected MSVC cl.exe
    cl.exe /nologo /O2 /LD /DNOTCH_NATIVE_EXPORTS native\notch_native.c /Fe:native\NotchNative.dll user32.lib crypt32.lib advapi32.lib
    if errorlevel 1 goto :build_failed
    del /q notch_native.obj native\NotchNative.exp native\NotchNative.lib 2>nul
    echo       [OK] native\NotchNative.dll compiled cleanly.
    goto :native_done
)

where gcc.exe >nul 2>nul
if %ERRORLEVEL%==0 (
    echo       Detected MinGW-w64 gcc.exe
    gcc.exe -O2 -shared -DNOTCH_NATIVE_EXPORTS -o native\NotchNative.dll native\notch_native.c -luser32 -lcrypt32 -ladvapi32 -lm
    if errorlevel 1 goto :build_failed
    echo       [OK] native\NotchNative.dll compiled cleanly.
    goto :native_done
)

echo       [INFO] Using built-in Win32 P/Invoke (no C compiler needed).

:native_done

:: 2. Verify .NET 8 SDK
echo.
echo [2/4] Checking .NET 8 SDK ...
where dotnet >nul 2>nul
if errorlevel 1 (
    echo [ERROR] .NET 8 SDK not found.
    echo         Install once in PowerShell: winget install Microsoft.DotNet.SDK.8
    pause
    exit /b 1
)
dotnet --version

:: 3. Publish NOVA.exe (tries single-file self-contained first; falls back to zero-NuGet offline build)
echo.
echo [3/4] Building NOVA.exe ...
if exist "%~dp0_stage" rmdir /s /q "%~dp0_stage"

dotnet publish WindowsNotchPro.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=None -p:DebugSymbols=false -o "%~dp0_stage" --nologo
if errorlevel 1 (
    echo.
    echo       [INFO] Online single-file publish skipped; building offline zero-NuGet NOVA.exe ...
    if exist "%~dp0_stage" rmdir /s /q "%~dp0_stage"
    dotnet publish WindowsNotchPro.csproj -c Release -o "%~dp0_stage" --nologo
    if errorlevel 1 goto :build_failed
)

:: 4. Assemble clean 3-item folder: NOVA-v2.0.0-win-x64\ (NOVA.exe, python\, web\)
echo.
echo [4/4] Assembling NOVA-v2.0.0-win-x64\ ...
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%\python"
mkdir "%RELEASE_DIR%\web"

if exist "%~dp0_stage\NOVA.exe" (
    copy /Y "%~dp0_stage\*" "%RELEASE_DIR%\" >nul
)
if exist "%~dp0python" xcopy /E /I /Y "%~dp0python\*" "%RELEASE_DIR%\python\" >nul
if exist "%~dp0..\python" xcopy /E /I /Y "%~dp0..\python\*" "%RELEASE_DIR%\python\" >nul
if exist "%~dp0..\dist" xcopy /E /I /Y "%~dp0..\dist\*" "%RELEASE_DIR%\web\" >nul

if not exist "%RELEASE_DIR%\web\index.html" (
    echo ^<!doctype html^>^<html^>^<body style="background:#06080e;color:#f8fafc;font-family:Segoe UI"^>^<h2^>NOVA Web Assets^</h2^>^</body^>^</html^> > "%RELEASE_DIR%\web\index.html"
)

if exist "%~dp0_stage" rmdir /s /q "%~dp0_stage"

echo.
echo ================================================================
echo  BUILD COMPLETE!
echo  Portable folder: %RELEASE_DIR%
echo    - NOVA.exe
echo    - python\
echo    - web\
echo ================================================================
start "" explorer.exe "%RELEASE_DIR%"
start "" "%RELEASE_DIR%\NOVA.exe"
exit /b 0

:build_failed
echo.
echo [ERROR] Build failed. Inspect compiler messages above.
pause
exit /b 1
