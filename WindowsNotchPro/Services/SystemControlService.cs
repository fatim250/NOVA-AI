using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;

namespace WindowsNotchPro.Services;

/// <summary>
/// Comprehensive, audit-logged Windows OS control engine for NOVA AI (both Text Chat and Gemini Live Voice).
/// </summary>
public sealed class SystemControlService
{
    private const uint KeyEventKeyUp = 0x0002;
    private const uint KeyEventUnicode = 0x0004;
    private const uint MouseEventWheel = 0x0800;
    private const uint InputKeyboard = 1;

    private const uint ShErbNoConfirmation = 0x00000001;
    private const uint ShErbNoProgressUi = 0x00000002;
    private const uint ShErbNoSound = 0x00000004;

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public KeyboardInput ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, Input[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

    [DllImport("powrprof.dll", SetLastError = true)]
    private static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHEmptyRecycleBinW(IntPtr hwnd, string? pszRootPath, uint dwFlags);

    private readonly AuditLogger _audit;

    private static readonly Dictionary<string, string> SettingsUriMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["wifi"] = "ms-settings:network-wifi",
        ["network"] = "ms-settings:network-status",
        ["bluetooth"] = "ms-settings:bluetooth",
        ["display"] = "ms-settings:display",
        ["sound"] = "ms-settings:sound",
        ["audio"] = "ms-settings:sound",
        ["battery"] = "ms-settings:batterysaver",
        ["power"] = "ms-settings:powersleep",
        ["storage"] = "ms-settings:storagesense",
        ["apps"] = "ms-settings:appsfeatures",
        ["update"] = "ms-settings:windowsupdate",
        ["privacy"] = "ms-settings:privacy",
        ["personalization"] = "ms-settings:personalization",
        ["about"] = "ms-settings:about",
    };

    public SystemControlService(AuditLogger audit)
    {
        _audit = audit;
    }

    public string WindowAction(string action)
    {
        var act = (action ?? string.Empty).Trim().ToLowerInvariant();
        switch (act)
        {
            case "show_desktop":
            case "minimize_all":
                PressCombo(0x5B, 0x44); // Win+D
                _audit.Log("window", "show_desktop", "allowed", "Toggled desktop");
                return "Toggled Show Desktop.";
            case "maximize":
                PressCombo(0x5B, 0x26); // Win+Up
                return "Maximized active window.";
            case "minimize":
                PressCombo(0x5B, 0x28); // Win+Down
                return "Minimized active window.";
            case "snap_left":
                PressCombo(0x5B, 0x25); // Win+Left
                return "Snapped active window to the left half.";
            case "snap_right":
                PressCombo(0x5B, 0x27); // Win+Right
                return "Snapped active window to the right half.";
            case "switch_window":
                PressCombo(0x12, 0x09); // Alt+Tab
                return "Switched to previous window.";
            case "task_view":
                PressCombo(0x5B, 0x09); // Win+Tab
                return "Opened Task View.";
            case "close_active":
                PressCombo(0x12, 0x73); // Alt+F4
                _audit.Log("window", "close_active", "allowed", "Sent Alt+F4");
                return "Sent close command to active window.";
            default:
                return $"Unknown window action '{action}'. Supported: show_desktop, maximize, minimize, snap_left, snap_right, switch_window, task_view, close_active.";
        }
    }

    public string TypeText(string text)
    {
        if (string.IsNullOrEmpty(text)) return "No text provided to type.";
        var clipped = text.Length > 500 ? text[..500] : text;
        var inputs = new List<Input>(clipped.Length * 2);
        foreach (char c in clipped)
        {
            inputs.Add(new Input
            {
                type = InputKeyboard,
                U = new InputUnion { ki = new KeyboardInput { wScan = c, dwFlags = KeyEventUnicode } }
            });
            inputs.Add(new Input
            {
                type = InputKeyboard,
                U = new InputUnion { ki = new KeyboardInput { wScan = c, dwFlags = KeyEventUnicode | KeyEventKeyUp } }
            });
        }
        SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<Input>());
        _audit.Log("input", "type_text", "allowed", $"Typed {clipped.Length} chars");
        return $"Typed {clipped.Length} characters.";
    }

    public string PressHotkey(string combo)
    {
        if (string.IsNullOrWhiteSpace(combo)) return "No hotkey specified.";
        var parts = combo.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var vks = new List<byte>();
        foreach (var part in parts)
        {
            if (TryMapKey(part, out byte vk)) vks.Add(vk);
            else return $"Unrecognized key '{part}' in '{combo}'.";
        }

        foreach (var vk in vks) keybd_event(vk, 0, 0, UIntPtr.Zero);
        for (int i = vks.Count - 1; i >= 0; i--) keybd_event(vks[i], 0, KeyEventKeyUp, UIntPtr.Zero);

        _audit.Log("input", "press_hotkey", "allowed", combo);
        return $"Pressed {combo}.";
    }

    public string ScrollMouse(int amount)
    {
        int clamped = Math.Clamp(amount, -20, 20);
        mouse_event(MouseEventWheel, 0, 0, clamped * 120, UIntPtr.Zero);
        return clamped >= 0 ? $"Scrolled up ({clamped} notches)." : $"Scrolled down ({-clamped} notches).";
    }

    public (bool Ok, string Path, string Message) TakeScreenshot()
    {
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var folder = Path.Combine(desktop, "NOVA_Screenshots");
            Directory.CreateDirectory(folder);
            var filePath = Path.Combine(folder, $"NOVA_{DateTime.Now:yyyyMMdd_HHmmss}.png");

            var bounds = System.Windows.Forms.Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1920, 1080);
            using var bmp = new Bitmap(bounds.Width, bounds.Height);
            using (var g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(bounds.Location, System.Drawing.Point.Empty, bounds.Size);
            }
            bmp.Save(filePath, ImageFormat.Png);
            _audit.Log("screen", "screenshot", "allowed", filePath);
            return (true, filePath, $"Screenshot saved to Desktop\\NOVA_Screenshots\\{Path.GetFileName(filePath)} and staged in Drop Shelf.");
        }
        catch (Exception ex)
        {
            return (false, string.Empty, $"Screenshot failed: {ex.Message}");
        }
    }

    public string OpenWindowsSettings(string page)
    {
        var key = (page ?? string.Empty).Trim();
        var uri = SettingsUriMap.TryGetValue(key, out var mapped) ? mapped : "ms-settings:";
        try
        {
            Process.Start(new ProcessStartInfo { FileName = uri, UseShellExecute = true });
            _audit.Log("system", "open_settings", "allowed", uri);
            return $"Opened Windows Settings ({(string.IsNullOrEmpty(key) ? "Home" : key)}).";
        }
        catch (Exception ex)
        {
            return $"Could not open settings: {ex.Message}";
        }
    }

    public string OpenUrl(string url)
    {
        var clean = (url ?? string.Empty).Trim();
        if (!clean.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
            !clean.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
        {
            clean = "https://" + clean;
        }
        if (!Uri.TryCreate(clean, UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
        {
            return "Blocked: invalid web URL.";
        }

        try
        {
            Process.Start(new ProcessStartInfo { FileName = parsed.ToString(), UseShellExecute = true });
            _audit.Log("web", "open_url", "allowed", parsed.ToString());
            return $"Opened {parsed.Host} in browser.";
        }
        catch (Exception ex)
        {
            return $"Could not open URL: {ex.Message}";
        }
    }

    public string PowerAction(string action)
    {
        var act = (action ?? string.Empty).Trim().ToLowerInvariant();
        switch (act)
        {
            case "lock":
                _audit.Log("power", "lock", "allowed", "AI triggered LockWorkStation");
                NativeInterop.LockWorkstation();
                return "Locking workstation now.";
            case "sleep":
                _audit.Log("power", "sleep", "allowed", "AI triggered Sleep");
                SetSuspendState(hibernate: false, forceCritical: false, disableWakeEvent: false);
                return "Putting PC to sleep.";
            case "empty_recycle_bin":
                SHEmptyRecycleBinW(IntPtr.Zero, null, ShErbNoConfirmation | ShErbNoProgressUi | ShErbNoSound);
                _audit.Log("file", "empty_recycle_bin", "allowed", "Emptied Windows Recycle Bin");
                return "Emptied the Windows Recycle Bin.";
            case "shutdown":
                _audit.Log("power", "shutdown", "allowed", "Scheduled 15s shutdown");
                Process.Start(new ProcessStartInfo { FileName = "shutdown.exe", Arguments = "/s /t 15", CreateNoWindow = true, UseShellExecute = false });
                return "PC will shut down in 15 seconds. Say 'cancel shutdown' to abort.";
            case "restart":
                _audit.Log("power", "restart", "allowed", "Scheduled 15s restart");
                Process.Start(new ProcessStartInfo { FileName = "shutdown.exe", Arguments = "/r /t 15", CreateNoWindow = true, UseShellExecute = false });
                return "PC will restart in 15 seconds. Say 'cancel shutdown' to abort.";
            case "cancel_shutdown":
                Process.Start(new ProcessStartInfo { FileName = "shutdown.exe", Arguments = "/a", CreateNoWindow = true, UseShellExecute = false });
                return "Cancelled pending shutdown or restart.";
            default:
                return $"Unknown power action '{action}'. Supported: lock, sleep, shutdown, restart, cancel_shutdown, empty_recycle_bin.";
        }
    }

    public string WriteTextFile(string fileName, string content, string root = "Desktop")
    {
        var cleanName = Path.GetFileName((fileName ?? string.Empty).Trim());
        if (string.IsNullOrWhiteSpace(cleanName)) return "Provide a valid file name.";
        if (!cleanName.Contains('.')) cleanName += ".txt";

        var dir = ResolveSafeRoot(root);
        var full = Path.Combine(dir, cleanName);
        try
        {
            File.WriteAllText(full, content ?? string.Empty);
            _audit.Log("file", "write_text_file", "allowed", full);
            return $"Saved '{cleanName}' to {root}.";
        }
        catch (Exception ex)
        {
            return $"Could not write file: {ex.Message}";
        }
    }

    public string ReadTextFile(string fileName, string root = "Desktop")
    {
        var cleanName = Path.GetFileName((fileName ?? string.Empty).Trim());
        if (string.IsNullOrWhiteSpace(cleanName)) return "Provide a valid file name.";

        var dir = ResolveSafeRoot(root);
        var full = Path.Combine(dir, cleanName);
        if (!File.Exists(full)) return $"File '{cleanName}' was not found in {root}.";
        try
        {
            var text = File.ReadAllText(full);
            return text.Length > 1200 ? text[..1200] + "…" : text;
        }
        catch (Exception ex)
        {
            return $"Could not read file: {ex.Message}";
        }
    }

    public static string GetClipboardText()
    {
        string result = string.Empty;
        Application.Current?.Dispatcher.Invoke(() =>
        {
            try { if (Clipboard.ContainsText()) result = Clipboard.GetText(); } catch { }
        });
        if (string.IsNullOrEmpty(result)) return "Clipboard is empty or does not contain text.";
        return result.Length > 600 ? result[..600] + "…" : result;
    }

    public static string SetClipboardText(string text)
    {
        Application.Current?.Dispatcher.Invoke(() =>
        {
            try { Clipboard.SetText(text ?? string.Empty); } catch { }
        });
        return "Copied text to clipboard.";
    }

    private static string ResolveSafeRoot(string root)
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return (root ?? "Desktop").Trim().ToLowerInvariant() switch
        {
            "documents" => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "downloads" => Path.Combine(profile, "Downloads"),
            _ => Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)
        };
    }

    private static void PressCombo(byte modVk, byte keyVk)
    {
        keybd_event(modVk, 0, 0, UIntPtr.Zero);
        keybd_event(keyVk, 0, 0, UIntPtr.Zero);
        keybd_event(keyVk, 0, KeyEventKeyUp, UIntPtr.Zero);
        keybd_event(modVk, 0, KeyEventKeyUp, UIntPtr.Zero);
    }

    private static bool TryMapKey(string key, out byte vk)
    {
        var k = key.ToLowerInvariant();
        if (k.Length == 1 && char.IsLetterOrDigit(k[0]))
        {
            vk = (byte)char.ToUpperInvariant(k[0]);
            return true;
        }

        vk = k switch
        {
            "ctrl" or "control" => 0x11,
            "alt" => 0x12,
            "shift" => 0x10,
            "win" or "windows" => 0x5B,
            "enter" or "return" => 0x0D,
            "esc" or "escape" => 0x1B,
            "tab" => 0x09,
            "space" => 0x20,
            "backspace" => 0x08,
            "delete" or "del" => 0x2E,
            "up" => 0x26,
            "down" => 0x28,
            "left" => 0x25,
            "right" => 0x27,
            "f1" => 0x70, "f2" => 0x71, "f3" => 0x72, "f4" => 0x73,
            "f5" => 0x74, "f6" => 0x75, "f7" => 0x76, "f8" => 0x77,
            "f9" => 0x78, "f10" => 0x79, "f11" => 0x7A, "f12" => 0x7B,
            _ => 0
        };
        return vk != 0;
    }

    /// <summary>
    /// Full 22-tool Gemini functionDeclarations schema shared by both Gemini Text Chat and Gemini Live Voice.
    /// </summary>
    public static object[] BuildGeminiToolDeclarations() => new object[]
    {
        new
        {
            functionDeclarations = new object[]
            {
                new { name = "open_app", description = "Open any installed Windows app by name (Chrome, Spotify, VS Code, Terminal, Discord, etc.)", parameters = new { type = "OBJECT", properties = new { name = new { type = "STRING" } }, required = new[] { "name" } } },
                new { name = "close_app", description = "Close a running non-critical Windows application", parameters = new { type = "OBJECT", properties = new { name = new { type = "STRING" } }, required = new[] { "name" } } },
                new { name = "focus_app", description = "Bring a running application window to the foreground by name", parameters = new { type = "OBJECT", properties = new { name = new { type = "STRING" } }, required = new[] { "name" } } },
                new { name = "list_running_apps", description = "List currently open desktop applications and memory usage", parameters = new { type = "OBJECT", properties = new { } } },
                new { name = "window_action", description = "Control windows: show_desktop, maximize, minimize, snap_left, snap_right, switch_window, task_view, close_active", parameters = new { type = "OBJECT", properties = new { action = new { type = "STRING" } }, required = new[] { "action" } } },
                new { name = "set_volume", description = "Set master Windows volume percentage 0 to 100", parameters = new { type = "OBJECT", properties = new { percent = new { type = "INTEGER" } }, required = new[] { "percent" } } },
                new { name = "toggle_mute", description = "Mute or unmute Windows master audio", parameters = new { type = "OBJECT", properties = new { muted = new { type = "BOOLEAN" } }, required = new[] { "muted" } } },
                new { name = "set_brightness", description = "Set display screen brightness percentage 5 to 100", parameters = new { type = "OBJECT", properties = new { percent = new { type = "INTEGER" } }, required = new[] { "percent" } } },
                new { name = "media_control", description = "Control media playback: play_pause, next, previous, stop", parameters = new { type = "OBJECT", properties = new { action = new { type = "STRING" } }, required = new[] { "action" } } },
                new { name = "open_settings", description = "Open a Windows Settings page: wifi, bluetooth, display, sound, battery, power, storage, apps, update, privacy, personalization, about", parameters = new { type = "OBJECT", properties = new { page = new { type = "STRING" } }, required = new[] { "page" } } },
                new { name = "power_action", description = "System power & maintenance: lock, sleep, shutdown, restart, cancel_shutdown, empty_recycle_bin", parameters = new { type = "OBJECT", properties = new { action = new { type = "STRING" } }, required = new[] { "action" } } },
                new { name = "take_screenshot", description = "Capture a full-screen screenshot to Desktop\\NOVA_Screenshots and stage it in Drop Shelf", parameters = new { type = "OBJECT", properties = new { } } },
                new { name = "type_text", description = "Type text directly into the currently focused application window", parameters = new { type = "OBJECT", properties = new { text = new { type = "STRING" } }, required = new[] { "text" } } },
                new { name = "press_hotkey", description = "Press a Windows keyboard shortcut such as ctrl+c, ctrl+v, ctrl+s, ctrl+z, win+e, alt+tab, enter", parameters = new { type = "OBJECT", properties = new { combo = new { type = "STRING" } }, required = new[] { "combo" } } },
                new { name = "mouse_action", description = "Control mouse: move (with x,y), click (left/right/double), or scroll (with amount)", parameters = new { type = "OBJECT", properties = new { action = new { type = "STRING" }, x = new { type = "INTEGER" }, y = new { type = "INTEGER" }, amount = new { type = "INTEGER" } }, required = new[] { "action" } } },
                new { name = "create_folder", description = "Create a folder in Desktop, Documents, or Downloads", parameters = new { type = "OBJECT", properties = new { name = new { type = "STRING" }, root = new { type = "STRING" } }, required = new[] { "name" } } },
                new { name = "delete_folder", description = "Move a folder in Desktop, Documents, or Downloads to the Recycle Bin", parameters = new { type = "OBJECT", properties = new { name = new { type = "STRING" }, root = new { type = "STRING" } }, required = new[] { "name" } } },
                new { name = "write_text_file", description = "Create or overwrite a text/note file in Desktop, Documents, or Downloads", parameters = new { type = "OBJECT", properties = new { fileName = new { type = "STRING" }, content = new { type = "STRING" }, root = new { type = "STRING" } }, required = new[] { "fileName", "content" } } },
                new { name = "read_text_file", description = "Read a text file from Desktop, Documents, or Downloads", parameters = new { type = "OBJECT", properties = new { fileName = new { type = "STRING" }, root = new { type = "STRING" } }, required = new[] { "fileName" } } },
                new { name = "clipboard_action", description = "Read ('get') or write ('set' with text) the Windows clipboard", parameters = new { type = "OBJECT", properties = new { action = new { type = "STRING" }, text = new { type = "STRING" } }, required = new[] { "action" } } },
                new { name = "open_url", description = "Open a website URL in the default browser", parameters = new { type = "OBJECT", properties = new { url = new { type = "STRING" } }, required = new[] { "url" } } },
                new { name = "web_search", description = "Search Google in the default browser", parameters = new { type = "OBJECT", properties = new { query = new { type = "STRING" } }, required = new[] { "query" } } },
                new { name = "get_system_stats", description = "Get live CPU, RAM, battery, network, and uptime telemetry", parameters = new { type = "OBJECT", properties = new { } } },
                new { name = "set_focus_timer", description = "Start a Pomodoro focus timer in minutes", parameters = new { type = "OBJECT", properties = new { minutes = new { type = "INTEGER" } }, required = new[] { "minutes" } } },
                new { name = "set_keep_awake", description = "Enable or disable keep-awake mode", parameters = new { type = "OBJECT", properties = new { enabled = new { type = "BOOLEAN" } }, required = new[] { "enabled" } } }
            }
        }
    };
}
