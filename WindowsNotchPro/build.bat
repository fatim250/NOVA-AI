@echo off
setlocal enabledelayedexpansion

echo ================================================================
echo  NOVA / WindowsNotch Pro — Native C + .NET 8 WPF x64 Builder
echo ================================================================

:: 1. Build native/NotchNative.dll using MSVC cl.exe OR MinGW-w64 gcc
echo.
echo [1/3] Compiling native\notch_native.c -> native\NotchNative.dll ...

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

echo       [INFO] No C compiler (cl.exe / gcc.exe) detected in PATH.
echo              Continuing build using built-in Win32 P/Invoke fallback.

:native_done

:: 2. Verify .NET 8 SDK
echo.
echo [2/3] Checking .NET 8 SDK ...
where dotnet >nul 2>nul
if errorlevel 1 (
    echo [ERROR] .NET 8 SDK not found.
    echo         Run this command once in PowerShell to install it:
    echo         winget install Microsoft.DotNet.SDK.8
    pause
    exit /b 1
)
dotnet --version

:: 3. Publish standalone win-x64 WPF executable
echo.
echo [3/3] Publishing self-contained WindowsNotchPro.exe (win-x64) ...
dotnet publish WindowsNotchPro.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist
if errorlevel 1 goto :build_failed

if exist native\NotchNative.dll (
    copy /Y native\NotchNative.dll dist\NotchNative.dll >nul
)

echo.
echo ================================================================
echo  BUILD COMPLETE!
echo  Standalone binary: dist\WindowsNotchPro.exe
echo ================================================================
echo Launching NOVA / WindowsNotch Pro ...
start "" "%~dp0dist\WindowsNotchPro.exe"
exit /b 0

:build_failed
echo.
echo [ERROR] Build failed. Inspect compiler messages above.
pause
exit /b 1
