using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.VisualBasic.FileIO;

namespace WindowsNotchPro.Services;

public sealed class SafeFileManager
{
    private readonly AuditLogger _audit;
    private readonly Dictionary<string, string> _allowedRoots;

    private static readonly HashSet<string> ReservedWindowsNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    };

    public SafeFileManager(AuditLogger audit)
    {
        _audit = audit;
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        _allowedRoots = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Desktop"] = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)),
            ["Documents"] = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)),
            ["Downloads"] = Path.GetFullPath(Path.Combine(profile, "Downloads")),
        };
    }

    public (bool Ok, string Message) CreateFolder(string folderName, string rootName = "Desktop")
    {
        var check = ResolveSafeFolderPath(folderName, rootName);
        if (!check.Allowed)
        {
            _audit.Log("folder", "folder_create", "blocked", check.Error);
            return (false, check.Error);
        }

        if (Directory.Exists(check.FullPath))
        {
            return (false, $"Folder '{check.CleanName}' already exists in {check.NormalizedRoot}.");
        }

        Directory.CreateDirectory(check.FullPath);
        _audit.Log("folder", "folder_create", "allowed", $"{check.NormalizedRoot}\\{check.CleanName}");
        return (true, $"Created folder '{check.CleanName}' in {check.NormalizedRoot}.");
    }

    public (bool Ok, string Message) RenameFolder(string oldName, string newName, string rootName = "Desktop")
    {
        var oldCheck = ResolveSafeFolderPath(oldName, rootName);
        if (!oldCheck.Allowed)
        {
            _audit.Log("folder", "folder_rename", "blocked", oldCheck.Error);
            return (false, oldCheck.Error);
        }

        var newCheck = ResolveSafeFolderPath(newName, rootName);
        if (!newCheck.Allowed)
        {
            _audit.Log("folder", "folder_rename", "blocked", newCheck.Error);
            return (false, newCheck.Error);
        }

        if (!Directory.Exists(oldCheck.FullPath))
        {
            return (false, $"Folder '{oldCheck.CleanName}' was not found in {oldCheck.NormalizedRoot}.");
        }

        if (IsReparsePoint(oldCheck.FullPath))
        {
            const string symlinkErr = "Blocked: symlink or junction folders cannot be modified.";
            _audit.Log("folder", "folder_rename", "blocked", symlinkErr);
            return (false, symlinkErr);
        }

        if (Directory.Exists(newCheck.FullPath))
        {
            return (false, $"A folder named '{newCheck.CleanName}' already exists in {newCheck.NormalizedRoot}.");
        }

        Directory.Move(oldCheck.FullPath, newCheck.FullPath);
        _audit.Log("folder", "folder_rename", "allowed", $"{oldCheck.NormalizedRoot}\\{oldCheck.CleanName} -> {newCheck.CleanName}");
        return (true, $"Renamed '{oldCheck.CleanName}' to '{newCheck.CleanName}' in {oldCheck.NormalizedRoot}.");
    }

    public (bool Ok, string Message) DeleteFolder(string folderName, string rootName = "Desktop")
    {
        var check = ResolveSafeFolderPath(folderName, rootName);
        if (!check.Allowed)
        {
            _audit.Log("folder", "folder_delete", "blocked", check.Error);
            return (false, check.Error);
        }

        if (!Directory.Exists(check.FullPath))
        {
            return (false, $"Folder '{check.CleanName}' was not found in {check.NormalizedRoot}.");
        }

        if (IsReparsePoint(check.FullPath))
        {
            const string symlinkErr = "Blocked: symlink or junction folders cannot be deleted.";
            _audit.Log("folder", "folder_delete", "blocked", symlinkErr);
            return (false, symlinkErr);
        }

        // Soft-delete strictly to Windows Recycle Bin (never permanent Directory.Delete)
        FileSystem.DeleteDirectory(
            check.FullPath,
            UIOption.OnlyErrorDialogs,
            RecycleOption.SendToRecycleBin);

        _audit.Log("folder", "folder_soft_delete", "allowed", $"Recycle Bin <- {check.NormalizedRoot}\\{check.CleanName}");
        return (true, $"Moved '{check.CleanName}' from {check.NormalizedRoot} to the Recycle Bin.");
    }

    public IReadOnlyList<string> ListFolders(string rootName = "Desktop")
    {
        if (!_allowedRoots.TryGetValue(rootName, out var rootPath) || !Directory.Exists(rootPath))
        {
            return Array.Empty<string>();
        }

        return Directory.EnumerateDirectories(rootPath)
            .Select(Path.GetFileName)
            .Where(name => !string.IsNullOrEmpty(name))
            .Cast<string>()
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private (bool Allowed, string FullPath, string CleanName, string NormalizedRoot, string Error)
        ResolveSafeFolderPath(string rawName, string rawRoot)
    {
        var rootKey = string.IsNullOrWhiteSpace(rawRoot) ? "Desktop" : rawRoot.Trim();
        if (!_allowedRoots.TryGetValue(rootKey, out var rootFull))
        {
            return (false, string.Empty, string.Empty, string.Empty,
                "Sandbox policy only allows Desktop, Documents, or Downloads.");
        }

        var normalizedRoot = _allowedRoots.Keys.First(k => k.Equals(rootKey, StringComparison.OrdinalIgnoreCase));
        var name = (rawName ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(name) || name.Length > 120)
        {
            return (false, string.Empty, string.Empty, normalizedRoot, "Folder name is empty or exceeds 120 characters.");
        }

        if (name.Contains("..") || name.Contains('/') || name.Contains('\\') || name.Contains(':'))
        {
            return (false, string.Empty, string.Empty, normalizedRoot,
                "Blocked: path traversal, drive letters, and alternate data streams are prohibited.");
        }

        if (name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || name.EndsWith('.') || name.EndsWith(' '))
        {
            return (false, string.Empty, string.Empty, normalizedRoot, "Folder name contains invalid Windows characters.");
        }

        var stem = name.Split('.')[0];
        if (ReservedWindowsNames.Contains(stem))
        {
            return (false, string.Empty, string.Empty, normalizedRoot, $"Blocked: '{stem}' is a reserved Windows device name.");
        }

        var rootWithSep = rootFull.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var candidate = Path.GetFullPath(Path.Combine(rootFull, name));

        if (!candidate.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase))
        {
            return (false, string.Empty, string.Empty, normalizedRoot, "Blocked: resolved path escaped sandbox root.");
        }

        return (true, candidate, name, normalizedRoot, string.Empty);
    }

    private static bool IsReparsePoint(string path)
    {
        var attrs = File.GetAttributes(path);
        return (attrs & FileAttributes.ReparsePoint) == FileAttributes.ReparsePoint;
    }
}
