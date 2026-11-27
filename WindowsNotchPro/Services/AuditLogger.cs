using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WindowsNotchPro.Services;

public sealed class AuditLogger
{
    public static AuditLogger Instance { get; } = new();

    private readonly object _writeLock = new();
    private readonly string _logPath;
    private string _prevHash = "0000000000000000";

    private AuditLogger()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "WindowsNotchPro");
        Directory.CreateDirectory(dir);
        _logPath = Path.Combine(dir, "audit.jsonl");
    }

    public void Log(string category, string eventName, string status, string detail, string actor = "nova")
    {
        lock (_writeLock)
        {
            var timestamp = DateTimeOffset.UtcNow.ToString("O");
            var hashInput = $"{_prevHash}|{timestamp}|{category}|{eventName}|{status}|{detail}|{actor}";
            var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(hashInput));
            var entryHash = Convert.ToHexString(hashBytes)[..16].ToLowerInvariant();

            var payload = new
            {
                timestamp,
                category,
                @event = eventName,
                status,
                detail,
                actor,
                prevHash = _prevHash,
                entryHash
            };

            var line = JsonSerializer.Serialize(payload);
            File.AppendAllText(_logPath, line + Environment.NewLine, Encoding.UTF8);
            _prevHash = entryHash;
        }
    }
}
