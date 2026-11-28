using System;
using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace WindowsNotchPro.Services;

public sealed class GlobalHotkeyService : IDisposable
{
    private const int WmHotKey = 0x0312;
    private const int HotkeyId = 0x4E56; // "NV"

    private const uint ModAlt = 0x0001;
    private const uint ModControl = 0x0002;
    private const uint ModShift = 0x0004;
    private const uint ModNoRepeat = 0x4000;

    private const uint VkSpace = 0x20;
    private const uint VkN = 0x4E;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    private IntPtr _hwnd;
    private HwndSource? _source;
    private bool _registered;

    public string ActiveCombo { get; private set; } = "Alt+Space";
    public event Action? HotkeyPressed;

    public bool Attach(IntPtr hwnd, string combo)
    {
        _hwnd = hwnd;
        _source = HwndSource.FromHwnd(hwnd);
        _source?.AddHook(WndProc);
        return Register(combo);
    }

    public bool Register(string combo)
    {
        if (_hwnd == IntPtr.Zero) return false;
        Unregister();

        var (mods, vk, normalized) = ParseCombo(combo);
        _registered = RegisterHotKey(_hwnd, HotkeyId, mods | ModNoRepeat, vk);
        if (_registered)
        {
            ActiveCombo = normalized;
            AuditLogger.Instance.Log("system", "hotkey_registered", "allowed", normalized);
        }
        else
        {
            AuditLogger.Instance.Log("system", "hotkey_register_failed", "warning", $"Could not register {normalized} (already in use)");
        }
        return _registered;
    }

    public void Unregister()
    {
        if (_registered && _hwnd != IntPtr.Zero)
        {
            UnregisterHotKey(_hwnd, HotkeyId);
            _registered = false;
        }
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WmHotKey && wParam.ToInt32() == HotkeyId)
        {
            HotkeyPressed?.Invoke();
            handled = true;
        }
        return IntPtr.Zero;
    }

    private static (uint Mods, uint Vk, string Normalized) ParseCombo(string? combo)
    {
        var key = (combo ?? "Alt+Space").Trim();
        return key.ToLowerInvariant() switch
        {
            "ctrl+space" => (ModControl, VkSpace, "Ctrl+Space"),
            "ctrl+shift+space" => (ModControl | ModShift, VkSpace, "Ctrl+Shift+Space"),
            "ctrl+alt+n" => (ModControl | ModAlt, VkN, "Ctrl+Alt+N"),
            _ => (ModAlt, VkSpace, "Alt+Space"),
        };
    }

    public void Dispose()
    {
        Unregister();
        _source?.RemoveHook(WndProc);
        _source = null;
    }
}
