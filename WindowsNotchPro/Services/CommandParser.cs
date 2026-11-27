using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace WindowsNotchPro.Services;

public sealed record CommandResult(
    bool Succeeded,
    string Reply,
    bool TriggerLockWorkstation = false,
    bool? ToggleKeepAwake = null);

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
    private readonly Queue<ConversationTurn> _memory = new();

    public string AssistantName { get; private set; } = "NOVA";
    public IReadOnlyCollection<ConversationTurn> RecentTurns => _memory;

    public CommandParser(
        SafeFileManager files,
        SafeAppManager apps,
        SecurityVault vault,
        AuditLogger audit)
    {
        _files = files;
        _apps = apps;
        _vault = vault;
        _audit = audit;
    }

    public Task<CommandResult> ExecuteAsync(string rawPrompt)
    {
        var text = (rawPrompt ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(text))
        {
            return Task.FromResult(new CommandResult(false, "Say or type a command."));
        }

        // 1. Dynamic Assistant Renaming ("call yourself Atlas")
        var renameSelf = Regex.Match(text, @"(?:call yourself|rename yourself to|your name is)\s+([A-Za-z0-9 _-]{2,24})", RegexOptions.IgnoreCase);
        if (renameSelf.Success)
        {
            AssistantName = renameSelf.Groups[1].Value.Trim();
            var reply = $"Got it. I will go by {AssistantName} now.";
            Record(text, "set_assistant_name", AssistantName, null, reply);
            return Task.FromResult(new CommandResult(true, reply));
        }

        // 2. Lock PC
        if (Regex.IsMatch(text, @"\b(lock pc|lock workstation|lock screen|lock computer)\b", RegexOptions.IgnoreCase))
        {
            const string reply = "Locking your Windows workstation now.";
            Record(text, "lock_pc", "workstation", null, reply);
            return Task.FromResult(new CommandResult(true, reply, TriggerLockWorkstation: true));
        }

        // 3. Keep-Awake / Coffee Mouse Patrol
        if (Regex.IsMatch(text, @"\b(keep awake|coffee on|start patrol|start mouse patrol)\b", RegexOptions.IgnoreCase))
        {
            const string reply = "Keep-awake patrol enabled. Press Escape anytime for emergency stop.";
            Record(text, "mouse_patrol", "on", null, reply);
            return Task.FromResult(new CommandResult(true, reply, ToggleKeepAwake: true));
        }

        if (Regex.IsMatch(text, @"\b(stop patrol|coffee off|stop mouse|emergency stop)\b", RegexOptions.IgnoreCase))
        {
            NativeInterop.TriggerEmergencyStop();
            const string reply = "Mouse automation halted immediately.";
            Record(text, "mouse_stop", "off", null, reply);
            return Task.FromResult(new CommandResult(true, reply, ToggleKeepAwake: false));
        }

        // 4. Create Folder ("create folder Q4 Reports on Desktop")
        var createMatch = Regex.Match(text, @"create\s+(?:a\s+)?folder\s+(?:named\s+)?['""]?([^'""]+?)['""]?(?:\s+(?:on|in)\s+(Desktop|Documents|Downloads))?$", RegexOptions.IgnoreCase);
        if (createMatch.Success)
        {
            var folder = createMatch.Groups[1].Value.Trim();
            var root = createMatch.Groups[2].Success ? createMatch.Groups[2].Value : "Desktop";
            var res = _files.CreateFolder(folder, root);
            Record(text, "folder_create", folder, root, res.Message);
            return Task.FromResult(new CommandResult(res.Ok, res.Message));
        }

        // 5. Rename Folder (supports pronoun "rename it to Archive")
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
                    return Task.FromResult(new CommandResult(false, "I don't see a recent folder in short-term memory to rename."));
                }
                oldName = lastFolder.Target;
                root = lastFolder.Root ?? root;
            }

            var res = _files.RenameFolder(oldName, newName, root);
            Record(text, "folder_rename", res.Ok ? newName : oldName, root, res.Message);
            return Task.FromResult(new CommandResult(res.Ok, res.Message));
        }

        // 6. Delete Folder (Recycle Bin only; supports "delete it")
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
                    return Task.FromResult(new CommandResult(false, "Which folder should I move to the Recycle Bin?"));
                }
                target = lastFolder.Target;
                root = lastFolder.Root ?? root;
            }

            var res = _files.DeleteFolder(target, root);
            Record(text, "folder_delete", target, root, res.Message);
            return Task.FromResult(new CommandResult(res.Ok, res.Message));
        }

        // 7. Open / Close / List Apps
        var openApp = Regex.Match(text, @"^(?:open|launch|start)\s+(.+)$", RegexOptions.IgnoreCase);
        if (openApp.Success)
        {
            var app = openApp.Groups[1].Value.Trim();
            var res = _apps.OpenApp(app);
            Record(text, "app_open", app, null, res.Message);
            return Task.FromResult(new CommandResult(res.Ok, res.Message));
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
            return Task.FromResult(new CommandResult(res.Ok, res.Message));
        }

        if (Regex.IsMatch(text, @"\b(list apps|running apps|what is open)\b", RegexOptions.IgnoreCase))
        {
            var running = _apps.ListRunningApps(6);
            var summary = running.Count == 0
                ? "No desktop windows are currently open."
                : "Running apps: " + string.Join(", ", running.Select(a => $"{a.Name} ({a.MemoryMb} MB)"));
            Record(text, "app_list", null, null, summary);
            return Task.FromResult(new CommandResult(true, summary));
        }

        // 8. Smooth Mouse Move ("move mouse to 600 400")
        var mouseMove = Regex.Match(text, @"move mouse(?: to)?\s+(\d{1,4})[,\s]+(\d{1,4})", RegexOptions.IgnoreCase);
        if (mouseMove.Success)
        {
            int x = int.Parse(mouseMove.Groups[1].Value);
            int y = int.Parse(mouseMove.Groups[2].Value);
            NativeInterop.ResetEmergencyStop();
            bool ok = NativeInterop.MoveMouseSmooth(x, y, 360);
            var msg = ok ? $"Moved cursor smoothly to ({x}, {y})." : "Mouse move halted or native DLL unavailable.";
            Record(text, "mouse_move", $"{x},{y}", null, msg);
            return Task.FromResult(new CommandResult(ok, msg));
        }

        // 9. Vault Status / Help
        if (Regex.IsMatch(text, @"\b(vault|security status|2fa)\b", RegexOptions.IgnoreCase))
        {
            var status = _vault.IsEnrolled
                ? "2FA Security Vault is armed (PBKDF2 200k + voiceprint + DPAPI)."
                : "Security Vault needs first-time passphrase and voiceprint enrollment.";
            Record(text, "vault_status", null, null, status);
            return Task.FromResult(new CommandResult(true, status));
        }

        var fallback = $"I heard '{text}'. Try 'Open Chrome', 'Create folder Invoices on Desktop', 'Close Notepad', 'Coffee on', or 'Lock PC'.";
        Record(text, "general", null, null, fallback);
        _audit.Log("system", "command_fallback", "info", text);
        return Task.FromResult(new CommandResult(true, fallback));
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
