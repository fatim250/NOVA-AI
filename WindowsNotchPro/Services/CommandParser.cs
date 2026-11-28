using System;
using System.Collections.Generic;
using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace WindowsNotchPro.Services;

public sealed record CommandResult(
    bool Succeeded,
    string Reply,
    bool TriggerLockWorkstation = false,
    bool? ToggleKeepAwake = null,
    int? StartFocusMinutes = null,
    string? SwitchToTab = null);

public sealed record ConversationTurn(
    DateTimeOffset Timestamp,
    string UserInput,
    string Action,
    string? Target,
    string? Root,
    string Reply);

public sealed class CommandParser
{
    private const int MemoryWindowSize = 20;

    private readonly SafeFileManager _files;
    private readonly SafeAppManager _apps;
    private readonly SecurityVault _vault;
    private readonly AuditLogger _audit;
    private readonly AudioBrightnessService _audio;
    private readonly MediaSessionService _media;
    private readonly SystemTelemetryService _telemetry;
    private readonly SystemControlService _sysControl;
    private readonly FileShelfService _fileShelf;
    private readonly AiBrainService _ai;
    private readonly SettingsService _settings;
    private readonly Queue<ConversationTurn> _memory = new();

    public Func<IntPtr>? WindowHandleProvider { get; set; }
    public Action<bool>? OnKeepAwakeChanged { get; set; }
    public Action<int>? OnStartFocusTimer { get; set; }

    public string AssistantName
    {
        get => _settings.Current.AssistantName;
        private set
        {
            _settings.Current.AssistantName = value;
            _settings.Save();
        }
    }

    public IReadOnlyCollection<ConversationTurn> RecentTurns => _memory;

    public CommandParser(
        SafeFileManager files,
        SafeAppManager apps,
        SecurityVault vault,
        AuditLogger audit,
        AudioBrightnessService audio,
        MediaSessionService media,
        SystemTelemetryService telemetry,
        SystemControlService sysControl,
        FileShelfService fileShelf,
        AiBrainService ai,
        SettingsService settings)
    {
        _files = files;
        _apps = apps;
        _vault = vault;
        _audit = audit;
        _audio = audio;
        _media = media;
        _telemetry = telemetry;
        _sysControl = sysControl;
        _fileShelf = fileShelf;
        _ai = ai;
        _settings = settings;
    }

    public async Task<CommandResult> ExecuteAsync(string rawPrompt)
    {
        var text = (rawPrompt ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(text))
        {
            return new CommandResult(false, "Say or type a command.");
        }

        // 0. Instant Math Calculator ("= 24 * 17" or "calc (120+45)/3")
        if (TryEvaluateMath(text, out var mathReply))
        {
            Record(text, "math_calc", text, null, mathReply);
            _ai.AppendExternalTurn(text, mathReply);
            return new CommandResult(true, mathReply);
        }

        // 1. Dynamic Assistant Renaming ("call yourself Atlas")
        var renameSelf = Regex.Match(text, @"(?:call yourself|rename yourself to|your name is)\s+([A-Za-z0-9 _-]{2,24})", RegexOptions.IgnoreCase);
        if (renameSelf.Success)
        {
            AssistantName = renameSelf.Groups[1].Value.Trim();
            var reply = $"Got it. I will go by {AssistantName} now.";
            Record(text, "set_assistant_name", AssistantName, null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply);
        }

        // 2. Lock PC
        if (Regex.IsMatch(text, @"\b(lock pc|lock workstation|lock screen|lock computer)\b", RegexOptions.IgnoreCase))
        {
            const string reply = "Locking your Windows workstation now.";
            Record(text, "lock_pc", "workstation", null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply, TriggerLockWorkstation: true);
        }

        // 3. Keep-Awake / Coffee
        if (Regex.IsMatch(text, @"\b(keep awake|coffee on|start patrol|start mouse patrol)\b", RegexOptions.IgnoreCase))
        {
            const string reply = "Keep-awake enabled. Your display and session will stay active.";
            Record(text, "keep_awake", "on", null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply, ToggleKeepAwake: true);
        }

        if (Regex.IsMatch(text, @"\b(stop patrol|coffee off|stop mouse|keep awake off|emergency stop)\b", RegexOptions.IgnoreCase))
        {
            NativeInterop.TriggerEmergencyStop();
            const string reply = "Keep-awake and mouse automation halted.";
            Record(text, "keep_awake", "off", null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply, ToggleKeepAwake: false);
        }

        // 4. Media Transport Commands
        if (Regex.IsMatch(text, @"\b(what(?:'s| is)? (?:song |track |music )?(?:is )?playing|now playing|what song|which song|current song)\b", RegexOptions.IgnoreCase))
        {
            var now = await _media.DetectNowPlayingAsync();
            string reply;
            if (!now.HasMedia)
            {
                reply = "Nothing is playing right now.";
            }
            else
            {
                var state = now.IsPlaying ? "Now playing" : "Paused";
                var album = string.IsNullOrWhiteSpace(now.Album) ? string.Empty : $" · {now.Album}";
                var time = now.HasTimeline
                    ? $" ({now.LivePosition:m\\:ss} / {now.Duration:m\\:ss})"
                    : string.Empty;
                reply = $"{state}: \"{now.Title}\" by {now.Artist}{album} on {now.SourceApp}{time}.";
            }
            Record(text, "media_now_playing", now.Title, null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply, SwitchToTab: now.HasMedia ? "media" : null);
        }

        if (Regex.IsMatch(text, @"^(play|pause|resume|play pause|toggle music)$", RegexOptions.IgnoreCase))
        {
            _media.PlayPause();
            const string reply = "Toggled media play/pause.";
            Record(text, "media_play_pause", null, null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply, SwitchToTab: "media");
        }
        if (Regex.IsMatch(text, @"\b(next track|next song|skip track|skip song)\b", RegexOptions.IgnoreCase))
        {
            _media.NextTrack();
            const string reply = "Skipped to next track.";
            Record(text, "media_next", null, null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply, SwitchToTab: "media");
        }
        if (Regex.IsMatch(text, @"\b(prev track|previous track|previous song|last song)\b", RegexOptions.IgnoreCase))
        {
            _media.PreviousTrack();
            const string reply = "Returned to previous track.";
            Record(text, "media_prev", null, null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply, SwitchToTab: "media");
        }

        // 5. Volume Commands ("volume 60", "volume=60", "mute", "unmute", "volume up/down")
        var volMatch = Regex.Match(text, @"^(?:set\s+)?(?:volume|vol)(?:\s+to\s+|\s*=\s*|\s+)(\d{1,3})%?$", RegexOptions.IgnoreCase);
        if (volMatch.Success)
        {
            int pct = Math.Clamp(int.Parse(volMatch.Groups[1].Value), 0, 100);
            _audio.SetMasterVolume(pct);
            var reply = $"Master volume set to {pct}%.";
            Record(text, "audio_volume", pct.ToString(), null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply);
        }
        if (Regex.IsMatch(text, @"^(mute|mute audio|mute volume)$", RegexOptions.IgnoreCase))
        {
            _audio.SetMute(true);
            const string reply = "System audio muted.";
            Record(text, "audio_mute", "true", null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply);
        }
        if (Regex.IsMatch(text, @"^(unmute|unmute audio|unmute volume)$", RegexOptions.IgnoreCase))
        {
            _audio.SetMute(false);
            const string reply = "System audio unmuted.";
            Record(text, "audio_mute", "false", null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply);
        }
        if (Regex.IsMatch(text, @"^(volume up|louder)$", RegexOptions.IgnoreCase))
        {
            var (cur, _) = _audio.GetAudioState();
            int next = Math.Min(100, cur + 10);
            _audio.SetMasterVolume(next);
            var reply = $"Volume raised to {next}%.";
            Record(text, "audio_volume", next.ToString(), null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply);
        }
        if (Regex.IsMatch(text, @"^(volume down|quieter)$", RegexOptions.IgnoreCase))
        {
            var (cur, _) = _audio.GetAudioState();
            int next = Math.Max(0, cur - 10);
            _audio.SetMasterVolume(next);
            var reply = $"Volume lowered to {next}%.";
            Record(text, "audio_volume", next.ToString(), null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply);
        }

        // 6. Focus Timer ("timer 15", "focus 30m", "pomodoro 25")
        var timerMatch = Regex.Match(text, @"^(?:focus|timer|pomodoro)\s+(\d{1,3})\s*(?:m|min|mins|minutes)?$", RegexOptions.IgnoreCase);
        if (timerMatch.Success)
        {
            int mins = Math.Clamp(int.Parse(timerMatch.Groups[1].Value), 1, 180);
            var reply = $"Started a {mins}-minute focus session.";
            Record(text, "focus_timer", mins.ToString(), null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply, StartFocusMinutes: mins);
        }

        // 7. Web Search ("search <query>" or "google <query>")
        var searchMatch = Regex.Match(text, @"^(?:search|google|web)\s+(.+)$", RegexOptions.IgnoreCase);
        if (searchMatch.Success)
        {
            var q = searchMatch.Groups[1].Value.Trim();
            OpenWebSearch(q);
            var reply = $"Opened web search for '{q}'.";
            Record(text, "web_search", q, null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply);
        }

        // 8. System Stats ("cpu", "ram", "battery", "system stats")
        if (Regex.IsMatch(text, @"^(?:system stats|stats|telemetry|cpu|ram|battery|status)$", RegexOptions.IgnoreCase))
        {
            var snap = _telemetry.Capture();
            var batPart = snap.HasBattery ? $" · Battery {snap.BatteryPercent}%{(snap.IsCharging ? " (Charging)" : "")}" : "";
            var reply = $"CPU {snap.CpuPercent:F0}% · RAM {snap.RamUsedGb:F1}/{snap.RamTotalGb:F1} GB ({snap.RamPercent:F0}%){batPart}";
            Record(text, "system_stats", null, null, reply);
            _ai.AppendExternalTurn(text, reply);
            return new CommandResult(true, reply, SwitchToTab: "system");
        }

        // 9. Folder Management (Create / Rename / Delete)
        var createMatch = Regex.Match(text, @"create\s+(?:a\s+)?folder\s+(?:named\s+)?['""]?([^'""]+?)['""]?(?:\s+(?:on|in)\s+(Desktop|Documents|Downloads))?$", RegexOptions.IgnoreCase);
        if (createMatch.Success)
        {
            var folder = createMatch.Groups[1].Value.Trim();
            var root = createMatch.Groups[2].Success ? createMatch.Groups[2].Value : "Desktop";
            var res = _files.CreateFolder(folder, root);
            Record(text, "folder_create", folder, root, res.Message);
            _ai.AppendExternalTurn(text, res.Message);
            return new CommandResult(res.Ok, res.Message);
        }

        var renameFolderMatch = Regex.Match(text, @"rename\s+(?:folder\s+)?['""]?([^'""]+?)['""]?\s+to\s+['""]?([^'""]+?)['""]?(?:\s+(?:on|in)\s+(Desktop|Documents|Downloads))?$", RegexOptions.IgnoreCase);
        if (renameFolderMatch.Success)
        {
            var oldName = renameFolderMatch.Groups[1].Value.Trim();
            var newName = renameFolderMatch.Groups[2].Value.Trim();
            var root = renameFolderMatch.Groups[3].Success ? renameFolderMatch.Groups[3].Value : "Desktop";

            if (oldName.Equals("it", StringComparison.OrdinalIgnoreCase) || oldName.Equals("that folder", StringComparison.OrdinalIgnoreCase))
            {
                var lastFolder = FindLastFolderTurn();
                if (lastFolder is null || string.IsNullOrEmpty(lastFolder.Target))
                {
                    return new CommandResult(false, "I don't see a recent folder in short-term memory to rename.");
                }
                oldName = lastFolder.Target;
                root = lastFolder.Root ?? root;
            }

            var res = _files.RenameFolder(oldName, newName, root);
            Record(text, "folder_rename", res.Ok ? newName : oldName, root, res.Message);
            _ai.AppendExternalTurn(text, res.Message);
            return new CommandResult(res.Ok, res.Message);
        }

        var deleteMatch = Regex.Match(text, @"(?:delete|remove|trash)\s+(?:folder\s+)?['""]?([^'""]+?)['""]?(?:\s+(?:from|on|in)\s+(Desktop|Documents|Downloads))?$", RegexOptions.IgnoreCase);
        if (deleteMatch.Success)
        {
            var target = deleteMatch.Groups[1].Value.Trim();
            var root = deleteMatch.Groups[2].Success ? deleteMatch.Groups[2].Value : "Desktop";

            if (target.Equals("it", StringComparison.OrdinalIgnoreCase) || target.Equals("that folder", StringComparison.OrdinalIgnoreCase))
            {
                var lastFolder = FindLastFolderTurn();
                if (lastFolder is null || string.IsNullOrEmpty(lastFolder.Target))
                {
                    return new CommandResult(false, "Which folder should I move to the Recycle Bin?");
                }
                target = lastFolder.Target;
                root = lastFolder.Root ?? root;
            }

            var res = _files.DeleteFolder(target, root);
            Record(text, "folder_delete", target, root, res.Message);
            _ai.AppendExternalTurn(text, res.Message);
            return new CommandResult(res.Ok, res.Message);
        }

        // 10. Open / Close / List Apps (with Start Menu discovery!)
        var openApp = Regex.Match(text, @"^(?:open|launch|start)\s+(.+)$", RegexOptions.IgnoreCase);
        if (openApp.Success)
        {
            var app = openApp.Groups[1].Value.Trim();
            var res = _apps.OpenApp(app);
            Record(text, "app_open", app, null, res.Message);
            _ai.AppendExternalTurn(text, res.Message);
            return new CommandResult(res.Ok, res.Message);
        }

        var closeApp = Regex.Match(text, @"^(?:close|quit|kill|exit)\s+(.+)$", RegexOptions.IgnoreCase);
        if (closeApp.Success)
        {
            var app = closeApp.Groups[1].Value.Trim();
            if (app.Equals("it", StringComparison.OrdinalIgnoreCase))
            {
                var lastApp = _memory.Reverse().FirstOrDefault(t => t.Action == "app_open");
                if (lastApp?.Target is not null) app = lastApp.Target;
            }
            var res = _apps.CloseApp(app);
            Record(text, "app_close", app, null, res.Message);
            _ai.AppendExternalTurn(text, res.Message);
            return new CommandResult(res.Ok, res.Message);
        }

        if (Regex.IsMatch(text, @"\b(list apps|running apps|what is open)\b", RegexOptions.IgnoreCase))
        {
            var running = _apps.ListRunningApps(6);
            var summary = running.Count == 0
                ? "No desktop windows are currently open."
                : "Running: " + string.Join(", ", running.Select(a => $"{a.Name} ({a.MemoryMb} MB)"));
            Record(text, "app_list", null, null, summary);
            _ai.AppendExternalTurn(text, summary);
            return new CommandResult(true, summary, SwitchToTab: "system");
        }

        // 11. Smooth Mouse Move
        var mouseMove = Regex.Match(text, @"move mouse(?: to)?\s+(\d{1,4})[,\s]+(\d{1,4})", RegexOptions.IgnoreCase);
        if (mouseMove.Success)
        {
            int x = int.Parse(mouseMove.Groups[1].Value);
            int y = int.Parse(mouseMove.Groups[2].Value);
            NativeInterop.ResetEmergencyStop();
            bool ok = NativeInterop.MoveMouseSmooth(x, y, 360);
            var msg = ok ? $"Moved cursor smoothly to ({x}, {y})." : "Mouse move halted or native DLL unavailable.";
            Record(text, "mouse_move", $"{x},{y}", null, msg);
            _ai.AppendExternalTurn(text, msg);
            return new CommandResult(ok, msg);
        }

        // 12. Vault Status
        if (Regex.IsMatch(text, @"\b(vault|security status|2fa)\b", RegexOptions.IgnoreCase))
        {
            var status = _vault.IsEnrolled
                ? "2FA Security Vault is armed (PBKDF2 200k + voiceprint + DPAPI)."
                : "Security Vault needs first-time passphrase and voiceprint enrollment.";
            Record(text, "vault_status", null, null, status);
            _ai.AppendExternalTurn(text, status);
            return new CommandResult(true, status);
        }

        // 13. Route natural language to Real AI Brain (Gemini / OpenAI / Ollama) with Tool Calling!
        if (_ai.IsConfigured)
        {
            bool triggerLock = false;
            bool? toggleAwake = null;
            int? focusMinutes = null;

            var (ok, reply, _) = await _ai.AskAsync(text, (toolName, args) =>
            {
                string toolOut = ExecuteAiTool(toolName, args, ref triggerLock, ref toggleAwake, ref focusMinutes);
                return Task.FromResult(toolOut);
            });

            Record(text, "ai_chat", _settings.Current.AiProvider, null, reply);
            return new CommandResult(ok, reply, triggerLock, toggleAwake, focusMinutes);
        }

        var fallback = $"Local mode: try 'open spotify', 'volume 60', '= 24*17', 'timer 15', 'search weather', 'stats', or connect Gemini/OpenAI/Ollama in Settings for full AI chat.";
        Record(text, "general", null, null, fallback);
        _ai.AppendExternalTurn(text, fallback);
        _audit.Log("system", "command_fallback", "info", text);
        return new CommandResult(true, fallback);
    }

    /// <summary>
    /// Public unified tool executor used by both Gemini/OpenAI Text Chat and Gemini Live Voice (Kore).
    /// </summary>
    public string ExecuteSystemTool(string toolName, JsonElement args)
    {
        bool triggerLock = false;
        bool? toggleAwake = null;
        int? focusMinutes = null;
        var res = ExecuteAiTool(toolName, args, ref triggerLock, ref toggleAwake, ref focusMinutes);
        if (triggerLock) NativeInterop.LockWorkstation();
        if (toggleAwake.HasValue) OnKeepAwakeChanged?.Invoke(toggleAwake.Value);
        if (focusMinutes.HasValue) OnStartFocusTimer?.Invoke(focusMinutes.Value);
        return res;
    }

    private string ExecuteAiTool(
        string toolName,
        JsonElement args,
        ref bool triggerLock,
        ref bool? toggleAwake,
        ref int? focusMinutes)
    {
        static string GetStr(JsonElement el, string prop, string fallback = "") =>
            el.ValueKind == JsonValueKind.Object && el.TryGetProperty(prop, out var v) ? v.GetString() ?? fallback : fallback;

        static int GetInt(JsonElement el, string prop, int fallback = 0) =>
            el.ValueKind == JsonValueKind.Object && el.TryGetProperty(prop, out var v) && v.TryGetInt32(out int n) ? n : fallback;

        static bool GetBool(JsonElement el, string prop, bool fallback = false) =>
            el.ValueKind == JsonValueKind.Object && el.TryGetProperty(prop, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? v.GetBoolean()
                : fallback;

        switch (toolName)
        {
            case "open_app":
                return _apps.OpenApp(GetStr(args, "name")).Message;
            case "close_app":
                return _apps.CloseApp(GetStr(args, "name")).Message;
            case "focus_app":
            {
                var query = GetStr(args, "name");
                var running = _apps.ListRunningApps(20);
                var found = running.FirstOrDefault(a =>
                    a.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                    a.WindowTitle.Contains(query, StringComparison.OrdinalIgnoreCase));
                if (found is null) return $"No running window matched '{query}'.";
                return _apps.FocusApp(found.Pid) ? $"Focused {found.Name}." : $"Could not focus {found.Name}.";
            }
            case "list_running_apps":
            {
                var list = _apps.ListRunningApps(10);
                return list.Count == 0
                    ? "No desktop windows are open."
                    : string.Join(", ", list.Select(a => $"{a.Name} ({a.MemoryMb} MB)"));
            }
            case "window_action":
                return _sysControl.WindowAction(GetStr(args, "action"));
            case "set_volume":
            {
                int pct = Math.Clamp(GetInt(args, "percent", 50), 0, 100);
                _audio.SetMasterVolume(pct);
                return $"Master volume set to {pct}%.";
            }
            case "toggle_mute":
            {
                bool muted = GetBool(args, "muted", true);
                _audio.SetMute(muted);
                return muted ? "System audio muted." : "System audio unmuted.";
            }
            case "set_brightness":
            {
                int pct = Math.Clamp(GetInt(args, "percent", 70), 5, 100);
                var hwnd = WindowHandleProvider?.Invoke() ?? IntPtr.Zero;
                _audio.SetBrightnessAsync(hwnd, pct);
                return $"Display brightness set to {pct}%.";
            }
            case "media_control":
            {
                var action = GetStr(args, "action", "play_pause").ToLowerInvariant();
                if (action == "next") _media.NextTrack();
                else if (action is "prev" or "previous") _media.PreviousTrack();
                else if (action == "stop") _media.Stop();
                else _media.PlayPause();
                return $"Executed media command: {action}.";
            }
            case "open_settings":
                return _sysControl.OpenWindowsSettings(GetStr(args, "page"));
            case "power_action":
            {
                var act = GetStr(args, "action");
                if (act.Equals("lock", StringComparison.OrdinalIgnoreCase))
                {
                    triggerLock = true;
                    return "Locking workstation now.";
                }
                return _sysControl.PowerAction(act);
            }
            case "take_screenshot":
            {
                var shot = _sysControl.TakeScreenshot();
                if (shot.Ok && !string.IsNullOrEmpty(shot.Path))
                {
                    _fileShelf.AddPaths(new[] { shot.Path });
                }
                return shot.Message;
            }
            case "type_text":
                return _sysControl.TypeText(GetStr(args, "text"));
            case "press_hotkey":
                return _sysControl.PressHotkey(GetStr(args, "combo"));
            case "mouse_action":
            {
                var act = GetStr(args, "action", "click").ToLowerInvariant();
                if (act == "move")
                {
                    int x = GetInt(args, "x", 500);
                    int y = GetInt(args, "y", 500);
                    NativeInterop.ResetEmergencyStop();
                    return NativeInterop.MoveMouseSmooth(x, y, 320) ? $"Moved cursor to ({x}, {y})." : "Mouse move halted.";
                }
                if (act == "scroll")
                {
                    return _sysControl.ScrollMouse(GetInt(args, "amount", -3));
                }
                int btn = act.Contains("right") ? NativeInterop.MouseRight
                    : act.Contains("double") ? NativeInterop.MouseDoubleLeft
                    : NativeInterop.MouseLeft;
                NativeInterop.ResetEmergencyStop();
                return NativeInterop.ClickMouse(btn) ? $"Performed {act} mouse click." : "Mouse click unavailable.";
            }
            case "create_folder":
                return _files.CreateFolder(GetStr(args, "name"), GetStr(args, "root", "Desktop")).Message;
            case "delete_folder":
                return _files.DeleteFolder(GetStr(args, "name"), GetStr(args, "root", "Desktop")).Message;
            case "write_text_file":
                return _sysControl.WriteTextFile(GetStr(args, "fileName"), GetStr(args, "content"), GetStr(args, "root", "Desktop"));
            case "read_text_file":
                return _sysControl.ReadTextFile(GetStr(args, "fileName"), GetStr(args, "root", "Desktop"));
            case "clipboard_action":
            {
                var act = GetStr(args, "action", "get").ToLowerInvariant();
                return act == "set" ? SystemControlService.SetClipboardText(GetStr(args, "text")) : SystemControlService.GetClipboardText();
            }
            case "open_url":
                return _sysControl.OpenUrl(GetStr(args, "url"));
            case "web_search":
            {
                var q = GetStr(args, "query");
                OpenWebSearch(q);
                return $"Opened web search for '{q}'.";
            }
            case "get_system_stats":
            {
                var s = _telemetry.Capture();
                return $"CPU {s.CpuPercent:F0}%, RAM {s.RamUsedGb:F1}/{s.RamTotalGb:F1} GB ({s.RamPercent:F0}%), Battery {(s.HasBattery ? s.BatteryPercent + "%" : "AC Desktop")}, Network {(s.IsNetworkConnected ? $"{s.NetDownMbps:F1} Mbps down" : "Offline")}.";
            }
            case "set_focus_timer":
            {
                int mins = Math.Clamp(GetInt(args, "minutes", 25), 1, 180);
                focusMinutes = mins;
                return $"Started {mins}-minute focus timer.";
            }
            case "set_keep_awake":
            {
                bool en = GetBool(args, "enabled", true);
                toggleAwake = en;
                return en ? "Keep-awake enabled." : "Keep-awake disabled.";
            }
            case "lock_pc":
                triggerLock = true;
                return "Locking workstation.";
            default:
                return $"Unknown tool '{toolName}'.";
        }
    }

    private static bool TryEvaluateMath(string input, out string reply)
    {
        reply = string.Empty;
        string expr = input;
        if (expr.StartsWith('=')) expr = expr[1..].Trim();
        else if (expr.StartsWith("calc ", StringComparison.OrdinalIgnoreCase)) expr = expr[5..].Trim();
        else if (!Regex.IsMatch(expr, @"^[\d\.\s\+\-\*\/\(\)%]+$") || !Regex.IsMatch(expr, @"[\+\-\*\/]"))
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(expr) || !Regex.IsMatch(expr, @"^[\d\.\s\+\-\*\/\(\)%]+$"))
        {
            return false;
        }

        try
        {
            using var dt = new DataTable();
            var val = dt.Compute(expr, null);
            if (val is not null && val != DBNull.Value)
            {
                double num = Convert.ToDouble(val, CultureInfo.InvariantCulture);
                reply = $"{expr} = {num.ToString("G12", CultureInfo.InvariantCulture)}";
                return true;
            }
        }
        catch
        {
            // Not a valid math expression
        }
        return false;
    }

    private static void OpenWebSearch(string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = $"https://www.google.com/search?q={Uri.EscapeDataString(query)}",
                UseShellExecute = true
            });
        }
        catch { }
    }

    private ConversationTurn? FindLastFolderTurn() =>
        _memory.Reverse().FirstOrDefault(t => t.Action is "folder_create" or "folder_rename");

    private void Record(string user, string action, string? target, string? root, string reply)
    {
        if (_memory.Count >= MemoryWindowSize)
        {
            _memory.Dequeue();
        }
        _memory.Enqueue(new ConversationTurn(DateTimeOffset.UtcNow, user, action, target, root, reply));
    }
}
