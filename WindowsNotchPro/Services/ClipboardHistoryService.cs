using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace WindowsNotchPro.Services;

public sealed class ClipboardEntry
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N")[..8];
    public string Text { get; init; } = string.Empty;
    public string Preview { get; init; } = string.Empty;
    public DateTimeOffset CapturedAt { get; init; } = DateTimeOffset.Now;
    public bool IsPinned { get; set; }
    public string TimeLabel => CapturedAt.ToString("HH:mm");
}

public sealed class ClipboardHistoryService : IDisposable
{
    private const int WmClipboardUpdate = 0x031D;
    private const int MaxEntries = 25;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool AddClipboardFormatListener(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RemoveClipboardFormatListener(IntPtr hwnd);

    private readonly List<ClipboardEntry> _entries = new();
    private IntPtr _hwnd;
    private HwndSource? _source;
    private bool _listening;
    private bool _suppressNextCapture;

    public IReadOnlyList<ClipboardEntry> Entries => _entries;
    public event Action? HistoryChanged;

    public void Attach(IntPtr hwnd)
    {
        _hwnd = hwnd;
        _source = HwndSource.FromHwnd(hwnd);
        _source?.AddHook(WndProc);
        _listening = AddClipboardFormatListener(hwnd);
        CaptureCurrentClipboard();
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WmClipboardUpdate)
        {
            if (_suppressNextCapture)
            {
                _suppressNextCapture = false;
                return IntPtr.Zero;
            }
            CaptureCurrentClipboard();
        }
        return IntPtr.Zero;
    }

    private void CaptureCurrentClipboard()
    {
        try
        {
            if (!Clipboard.ContainsText()) return;
            var text = Clipboard.GetText();
            if (string.IsNullOrWhiteSpace(text)) return;

            var trimmed = text.Trim();
            var existing = _entries.FirstOrDefault(e => e.Text == trimmed);
            if (existing is not null)
            {
                bool wasPinned = existing.IsPinned;
                _entries.Remove(existing);
                _entries.Insert(0, new ClipboardEntry
                {
                    Id = existing.Id,
                    Text = trimmed,
                    Preview = MakePreview(trimmed),
                    CapturedAt = DateTimeOffset.Now,
                    IsPinned = wasPinned
                });
            }
            else
            {
                _entries.Insert(0, new ClipboardEntry
                {
                    Text = trimmed,
                    Preview = MakePreview(trimmed),
                    CapturedAt = DateTimeOffset.Now
                });
            }

            SortAndTrim();
            HistoryChanged?.Invoke();
        }
        catch
        {
            // Clipboard can be transiently locked by another application
        }
    }

    public void CopyEntry(string id)
    {
        var entry = _entries.FirstOrDefault(e => e.Id == id);
        if (entry is null) return;
        try
        {
            _suppressNextCapture = true;
            Clipboard.SetText(entry.Text);
        }
        catch
        {
            _suppressNextCapture = false;
        }
    }

    public void TogglePin(string id)
    {
        var entry = _entries.FirstOrDefault(e => e.Id == id);
        if (entry is null) return;
        entry.IsPinned = !entry.IsPinned;
        SortAndTrim();
        HistoryChanged?.Invoke();
    }

    public void Remove(string id)
    {
        _entries.RemoveAll(e => e.Id == id);
        HistoryChanged?.Invoke();
    }

    public void ClearUnpinned()
    {
        _entries.RemoveAll(e => !e.IsPinned);
        HistoryChanged?.Invoke();
    }

    private void SortAndTrim()
    {
        var ordered = _entries
            .OrderByDescending(e => e.IsPinned)
            .ThenByDescending(e => e.CapturedAt)
            .ToList();

        while (ordered.Count > MaxEntries)
        {
            var lastUnpinned = ordered.FindLastIndex(e => !e.IsPinned);
            if (lastUnpinned >= 0) ordered.RemoveAt(lastUnpinned);
            else ordered.RemoveAt(ordered.Count - 1);
        }

        _entries.Clear();
        _entries.AddRange(ordered);
    }

    private static string MakePreview(string text)
    {
        var singleLine = text.Replace("\r\n", " ").Replace('\n', ' ').Replace('\r', ' ');
        return singleLine.Length <= 84 ? singleLine : singleLine[..84] + "…";
    }

    public void Dispose()
    {
        if (_listening && _hwnd != IntPtr.Zero)
        {
            RemoveClipboardFormatListener(_hwnd);
            _listening = false;
        }
        _source?.RemoveHook(WndProc);
        _source = null;
    }
}
