using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace WindowsNotchPro.Services;

public sealed record RunningAppInfo(string Name, string WindowTitle, int Pid, long MemoryMb, bool IsProtected, string? ExecutablePath = null);

public sealed class SafeAppManager
{
    private const int SwRestore = 9;

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    private readonly AuditLogger _audit;
    private readonly Dictionary<string, string> _startMenuShortcuts = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _shortcutLock = new();

    private static readonly HashSet<string> ProtectedProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "lsass", "csrss", "winlogon", "wininit", "smss", "services",
        "svchost", "explorer", "dwm", "system", "idle", "registry",
        "fontdrvhost", "audiodg", "spoolsv", "taskmgr", "securityhealthservice", "nova"
    };

    private static readonly Dictionary<string, (string FileName, string DisplayName)> BuiltinLaunchMap =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["chrome"] = ("chrome.exe", "Google Chrome"),
            ["google chrome"] = ("chrome.exe", "Google Chrome"),
            ["edge"] = ("msedge.exe", "Microsoft Edge"),
            ["microsoft edge"] = ("msedge.exe", "Microsoft Edge"),
            ["notepad"] = ("notepad.exe", "Notepad"),
            ["calculator"] = ("calc.exe", "Calculator"),
            ["calc"] = ("calc.exe", "Calculator"),
            ["terminal"] = ("wt.exe", "Windows Terminal"),
            ["windows terminal"] = ("wt.exe", "Windows Terminal"),
            ["powershell"] = ("powershell.exe", "PowerShell"),
            ["cmd"] = ("cmd.exe", "Command Prompt"),
            ["vscode"] = ("code", "Visual Studio Code"),
            ["vs code"] = ("code", "Visual Studio Code"),
            ["code"] = ("code", "Visual Studio Code"),
            ["explorer"] = ("explorer.exe", "File Explorer"),
            ["file explorer"] = ("explorer.exe", "File Explorer"),
            ["paint"] = ("mspaint.exe", "Paint"),
            ["settings"] = ("ms-settings:", "Windows Settings"),
            ["task manager"] = ("taskmgr.exe", "Task Manager"),
            ["snipping tool"] = ("ms-screenclip:", "Snipping Tool"),
            ["spotify"] = ("spotify:", "Spotify"),
            ["store"] = ("ms-windows-store:", "Microsoft Store"),
        };

    public SafeAppManager(AuditLogger audit)
    {
        _audit = audit;
        _ = Task.Run(RefreshStartMenuIndex);
    }

    public int IndexedAppCount
    {
        get
        {
            lock (_shortcutLock) return _startMenuShortcuts.Count + BuiltinLaunchMap.Count;
        }
    }

    public void RefreshStartMenuIndex()
    {
        var found = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string[] roots =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"Microsoft\Windows\Start Menu\Programs"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\Start Menu\Programs"),
        };

        foreach (var root in roots)
        {
            if (!Directory.Exists(root)) continue;
            try
            {
                foreach (var lnk in Directory.EnumerateFiles(root, "*.lnk", SearchOption.AllDirectories))
                {
                    var name = Path.GetFileNameWithoutExtension(lnk).Trim();
                    if (string.IsNullOrWhiteSpace(name)) continue;
                    if (name.Contains("uninstall", StringComparison.OrdinalIgnoreCase) ||
                        name.Contains("readme", StringComparison.OrdinalIgnoreCase) ||
                        name.Contains("help", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    found.TryAdd(name, lnk);
                }
            }
            catch
            {
                // Skip protected directories
            }
        }

        lock (_shortcutLock)
        {
            _startMenuShortcuts.Clear();
            foreach (var kv in found)
            {
                _startMenuShortcuts[kv.Key] = kv.Value;
            }
        }
    }

    public (bool Ok, string Message) OpenApp(string appQuery)
    {
        var key = (appQuery ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(key))
        {
            return (false, "Specify an application name to open.");
        }

        // 1. Check built-in fast map
        if (BuiltinLaunchMap.TryGetValue(key, out var target))
        {
            return LaunchShellTarget(target.FileName, target.DisplayName);
        }

        // 2. Fuzzy match Start Menu installed apps
        KeyValuePair<string, string>? match = null;
        lock (_shortcutLock)
        {
            if (_startMenuShortcuts.TryGetValue(key, out var exactPath))
            {
                match = new KeyValuePair<string, string>(key, exactPath);
            }
            else
            {
                match = _startMenuShortcuts
                    .Where(kv => kv.Key.StartsWith(key, StringComparison.OrdinalIgnoreCase))
                    .OrderBy(kv => kv.Key.Length)
                    .Cast<KeyValuePair<string, string>?>()
                    .FirstOrDefault()
                    ?? _startMenuShortcuts
                        .Where(kv => kv.Key.Contains(key, StringComparison.OrdinalIgnoreCase))
                        .OrderBy(kv => kv.Key.Length)
                        .Cast<KeyValuePair<string, string>?>()
                        .FirstOrDefault();
            }
        }

        if (match.HasValue)
        {
            return LaunchShellTarget(match.Value.Value, match.Value.Key);
        }

        var blockedMsg = $"No installed Start Menu app matched '{key}'.";
        _audit.Log("app", "app_open", "blocked", blockedMsg);
        return (false, blockedMsg);
    }

    private (bool Ok, string Message) LaunchShellTarget(string fileName, string displayName)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = fileName, UseShellExecute = true });
            _audit.Log("app", "app_open", "allowed", $"Launched {displayName} ({fileName})");
            return (true, $"Opened {displayName}.");
        }
        catch (Exception ex)
        {
            var err = $"Could not launch {displayName}: {ex.Message}";
            _audit.Log("app", "app_open", "warning", err);
            return (false, err);
        }
    }

    public (bool Ok, string Message) CloseApp(string processQuery)
    {
        var raw = (processQuery ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(raw))
        {
            return (false, "Specify an application name to close.");
        }

        var normalized = raw;
        if (BuiltinLaunchMap.TryGetValue(raw, out var mapped) && !mapped.FileName.EndsWith(':'))
        {
            normalized = mapped.FileName;
        }
        if (normalized.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized[..^4];
        }

        if (ProtectedProcesses.Contains(normalized))
        {
            var msg = $"Blocked: '{normalized}.exe' is a critical Windows system process and cannot be closed.";
            _audit.Log("security", "protected_process_block", "blocked", msg);
            return (false, msg);
        }

        var matches = Process.GetProcessesByName(normalized);
        if (matches.Length == 0)
        {
            return (false, $"No running process matched '{normalized}.exe'.");
        }

        int closedCount = 0;
        foreach (var proc in matches)
        {
            try
            {
                if (proc.CloseMainWindow())
                {
                    if (!proc.WaitForExit(1800))
                    {
                        proc.Kill(entireProcessTree: false);
                    }
                }
                else
                {
                    proc.Kill(entireProcessTree: false);
                }
                closedCount++;
            }
            catch
            {
                // Skip elevated or already-exited instances
            }
            finally
            {
                proc.Dispose();
            }
        }

        _audit.Log("app", "app_close", "allowed", $"Closed {closedCount} instance(s) of {normalized}.exe");
        return (true, $"Closed {normalized}.exe ({closedCount} instance{(closedCount == 1 ? "" : "s")}).");
    }

    public bool FocusApp(int pid)
    {
        try
        {
            using var proc = Process.GetProcessById(pid);
            if (proc.MainWindowHandle == IntPtr.Zero) return false;
            if (IsIconic(proc.MainWindowHandle))
            {
                ShowWindow(proc.MainWindowHandle, SwRestore);
            }
            return SetForegroundWindow(proc.MainWindowHandle);
        }
        catch
        {
            return false;
        }
    }

    public IReadOnlyList<RunningAppInfo> ListRunningApps(int maxCount = 12)
    {
        var results = new List<RunningAppInfo>();
        foreach (var p in Process.GetProcesses())
        {
            try
            {
                if (string.IsNullOrWhiteSpace(p.MainWindowTitle)) continue;
                var name = p.ProcessName;
                var mem = SafeGetMemory(p) / (1024 * 1024);
                string? exePath = null;
                try { exePath = p.MainModule?.FileName; } catch { }
                results.Add(new RunningAppInfo(name + ".exe", p.MainWindowTitle, p.Id, mem, ProtectedProcesses.Contains(name), exePath));
            }
            catch
            {
                // Ignore inaccessible processes
            }
            finally
            {
                p.Dispose();
            }
        }

        return results
            .OrderByDescending(a => a.MemoryMb)
            .Take(maxCount)
            .ToList();
    }

    private static long SafeGetMemory(Process p)
    {
        try { return p.WorkingSet64; } catch { return 0; }
    }
}
