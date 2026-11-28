using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;

namespace WindowsNotchPro.Services;

public sealed record ShelfItem(
    string FullPath,
    string Name,
    bool IsDirectory,
    string SizeLabel,
    DateTimeOffset AddedAt);

public sealed class FileShelfService
{
    private readonly List<ShelfItem> _items = new();

    public IReadOnlyList<ShelfItem> Items => _items;
    public int Count => _items.Count;
    public event Action? ShelfChanged;

    public int AddPaths(IEnumerable<string> paths)
    {
        int added = 0;
        foreach (var raw in paths)
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            var full = Path.GetFullPath(raw);
            if (!File.Exists(full) && !Directory.Exists(full)) continue;
            if (_items.Any(i => i.FullPath.Equals(full, StringComparison.OrdinalIgnoreCase))) continue;

            bool isDir = Directory.Exists(full);
            string name = Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar));
            if (string.IsNullOrEmpty(name)) name = full;

            string sizeLabel = isDir ? "Folder" : FormatBytes(SafeFileLength(full));
            _items.Insert(0, new ShelfItem(full, name, isDir, sizeLabel, DateTimeOffset.Now));
            added++;
        }

        if (added > 0)
        {
            ShelfChanged?.Invoke();
        }
        return added;
    }

    public void Remove(string fullPath)
    {
        if (_items.RemoveAll(i => i.FullPath.Equals(fullPath, StringComparison.OrdinalIgnoreCase)) > 0)
        {
            ShelfChanged?.Invoke();
        }
    }

    public void Clear()
    {
        if (_items.Count == 0) return;
        _items.Clear();
        ShelfChanged?.Invoke();
    }

    public static void OpenItem(string fullPath)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = fullPath, UseShellExecute = true });
        }
        catch
        {
            // Ignore shell open failure
        }
    }

    public static void RevealInExplorer(string fullPath)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = $"/select,\"{fullPath}\"",
                UseShellExecute = true
            });
        }
        catch
        {
            // Ignore explorer failure
        }
    }

    private static long SafeFileLength(string path)
    {
        try { return new FileInfo(path).Length; } catch { return 0; }
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F1} KB";
        if (bytes < 1024L * 1024L * 1024L) return $"{bytes / (1024.0 * 1024.0):F1} MB";
        return $"{bytes / (1024.0 * 1024.0 * 1024.0):F2} GB";
    }
}
