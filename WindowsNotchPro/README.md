# NOVA / WindowsNotch Pro — Native Windows 10 & 11 (x64)

Ultra-low-RAM native Windows Dynamic Island AI assistant built with **.NET 8 WPF (C# + XAML)**, a **C11 Win32 native engine (`NotchNative.dll`)**, and a **Kotlin companion client**.

## Folder Structure

- `WindowsNotchPro.csproj`, `app.manifest`, `App.xaml`, `App.xaml.cs`, `MainWindow.xaml`, `MainWindow.xaml.cs` — Frameless, transparent, always-on-top Per-Monitor V2 DPI WPF overlay with `248x48` idle pill, dark frosted-glass Bento card, auto-cycling aurora themes, and two-way `System.Speech` voice talk-back.
- `native/notch_native.h`, `native/notch_native.c` — Compiled into `NotchNative.dll` for cubic ease-in-out Win32 `SendInput` mouse control, atomic emergency stop, `LockWorkStation()`, Windows 11 `DwmSetWindowAttribute` rounded corners, DPAPI sealing, and SDDL-protected Named Pipes (`\\.\pipe\WindowsNotchUnlock`).
- `native/credential_provider_skeleton.cpp` — Session-0 Winlogon `ICredentialProvider` COM skeleton.
- `Services/NativeInterop.cs`, `SafeFileManager.cs`, `SafeAppManager.cs`, `SecurityVault.cs`, `AuditLogger.cs`, `CommandParser.cs`, `CompanionServer.cs` — Core Windows managers, Recycle Bin soft-delete sandbox, critical-process guard, PBKDF2-HMAC-SHA256 (200k) + voiceprint 2FA vault, hash-chained `audit.jsonl`, and Bearer-authenticated local WebSocket/HTTP listener.
- `companion/NotchCompanion.kt` — Kotlin companion client for remote commands and 2FA unlock challenges.
- `build.bat` — One-click x64 build producing `dist\WindowsNotchPro.exe`.

## One-Click Build (Windows 10 & 11 x64)

1. Install .NET 8 SDK (https://dotnet.microsoft.com/download/dotnet/8.0) and either Visual Studio C++ Build Tools (`cl.exe`) or MinGW-w64 (`gcc.exe`).
2. Run `build.bat`.
3. Launch `dist\WindowsNotchPro.exe`.

## Kotlin Companion Usage

Set `NOTCH_COMPANION_TOKEN` on both the Windows host (before launching `WindowsNotchPro.exe`) and the Kotlin client device, then compile and run:

```bat
kotlinc companion\NotchCompanion.kt -include-runtime -d NotchCompanion.jar
java -jar NotchCompanion.jar "Open Chrome"
```
