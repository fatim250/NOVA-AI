using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

namespace WindowsNotchPro.Services;

public sealed class SafeAppManager
{
    private readonly AuditLogger _audit;

    private static readonly HashSet<string> ProtectedProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "lsass", "csrss", "winlogon", "wininit", "smss", "services",
        "svchost", "explorer", "dwm", "system", "idle", "registry",
        "fontdrvhost", "audiodg", "spoolsv", "taskmgr", "securityhealthservice"
    };

    private static readonly Dictionary<string, (string FileName, string DisplayName)> AllowedLaunchMap =
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
            ["vscode"] = ("code", "Visual Studio Code"),
            ["vs code"] = ("code", "Visual Studio Code"),
            ["code"] = ("code", "Visual Studio Code"),
            ["explorer"] = ("explorer.exe", "File Explorer"),
            ["file explorer"] = ("explorer.exe", "File Explorer"),
            ["paint"] = ("mspaint.exe", "Paint"),
            ["settings"] = ("ms-settings:", "Windows Settings"),
        };

    public SafeAppManager(AuditLogger audit)
    {
        _audit = audit;
    }

    public (bool Ok, string Message) OpenApp(string appQuery)
    {
        var key = (appQuery ?? string.Empty).Trim();
        if (!AllowedLaunchMap.TryGetValue(key, out var target))
        {
            var blockedMsg = $"Blocked: '{key}' is not in the approved Windows application allowlist.";
            _audit.Log("app", "app_open", "blocked", blockedMsg);
            return (false, blockedMsg);
        }

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = target.FileName,
                UseShellExecute = true,
            };
            Process.Start(psi);
            _audit.Log("app", "app_open", "allowed", $"Launched {target.DisplayName} ({target.FileName})");
            return (true, $"Opened {target.DisplayName}.");
        }
        catch (Exception ex)
        {
            var err = $"Could not launch {target.DisplayName}: {ex.Message}";
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

        // Resolve friendly aliases first (e.g., "VS Code" -> "code")
        var normalized = raw;
        if (AllowedLaunchMap.TryGetValue(raw, out var mapped))
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

    public IReadOnlyList<(string Name, int Pid, long MemoryMb, bool IsProtected)> ListRunningApps(int maxCount = 20)
    {
        return Process.GetProcesses()
            .Where(p => !string.IsNullOrWhiteSpace(p.MainWindowTitle))
            .OrderByDescending(p => SafeGetMemory(p))
            .Take(maxCount)
            .Select(p =>
            {
                var name = p.ProcessName;
                var mem = SafeGetMemory(p) / (1024 * 1024);
                var pid = p.Id;
                p.Dispose();
                return (name + ".exe", pid, mem, ProtectedProcesses.Contains(name));
            })
            .ToList();
    }

    private static long SafeGetMemory(Process p)
    {
        try { return p.WorkingSet64; } catch { return 0; }
    }
}
