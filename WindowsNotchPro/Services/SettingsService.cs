using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace WindowsNotchPro.Services;

public sealed class NotchSettings
{
    public string AssistantName { get; set; } = "NOVA";
    public string AiProvider { get; set; } = "None"; // None | Gemini | OpenAI | Ollama
    public string AiModel { get; set; } = "gemini-3.1-flash-lite";
    public string AiEndpoint { get; set; } = "https://generativelanguage.googleapis.com";
    public string GeminiLiveModel { get; set; } = "gemini-3.8-live";
    public string GeminiVoice { get; set; } = "Kore";
    public string EncryptedApiKeyBase64 { get; set; } = string.Empty;

    public bool AutoAurora { get; set; } = true;
    public int AuroraThemeIndex { get; set; } = 0;
    public bool TtsMuted { get; set; } = false;
    public int MonitorIndex { get; set; } = 0;
    public string HotkeyCombo { get; set; } = "Alt+Space";
    public bool StartWithWindows { get; set; } = false;
    public int FocusMinutes { get; set; } = 25;
    public bool KeepAwakeUseMousePatrol { get; set; } = false;
}

public sealed class SettingsService
{
    private const string RunRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "NOVA_WindowsNotchPro";

    private readonly string _settingsPath;
    private readonly object _lock = new();

    public NotchSettings Current { get; private set; }

    public SettingsService()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "WindowsNotchPro");
        Directory.CreateDirectory(dir);
        _settingsPath = Path.Combine(dir, "settings.json");
        Current = Load();
    }

    private NotchSettings Load()
    {
        try
        {
            if (File.Exists(_settingsPath))
            {
                var json = File.ReadAllText(_settingsPath, Encoding.UTF8);
                var parsed = JsonSerializer.Deserialize<NotchSettings>(json);
                if (parsed is not null)
                {
                    // Auto-migrate retired gemini-2.5-flash default
                    if (string.Equals(parsed.AiModel, "gemini-2.5-flash", StringComparison.OrdinalIgnoreCase))
                    {
                        parsed.AiModel = "gemini-3.1-flash-lite";
                    }
                    if (string.IsNullOrWhiteSpace(parsed.GeminiVoice)) parsed.GeminiVoice = "Kore";
                    if (string.IsNullOrWhiteSpace(parsed.GeminiLiveModel)) parsed.GeminiLiveModel = "gemini-3.8-live";
                    return parsed;
                }
            }
        }
        catch (Exception ex)
        {
            AuditLogger.Instance.Log("settings", "load_failed", "warning", ex.Message);
        }

        // Auto-bootstrap Gemini key from environment if present
        var settings = new NotchSettings();
        var envGemini = Environment.GetEnvironmentVariable("GEMINI_API_KEY");
        var envOpenAi = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        if (!string.IsNullOrWhiteSpace(envGemini))
        {
            settings.AiProvider = "Gemini";
            settings.AiModel = "gemini-3.1-flash-lite";
            settings.EncryptedApiKeyBase64 = SealApiKey(envGemini.Trim());
        }
        else if (!string.IsNullOrWhiteSpace(envOpenAi))
        {
            settings.AiProvider = "OpenAI";
            settings.AiModel = "gpt-4o-mini";
            settings.AiEndpoint = "https://api.openai.com/v1";
            settings.EncryptedApiKeyBase64 = SealApiKey(envOpenAi.Trim());
        }

        return settings;
    }

    public void Save()
    {
        lock (_lock)
        {
            try
            {
                var json = JsonSerializer.Serialize(Current, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_settingsPath, json, Encoding.UTF8);
            }
            catch (Exception ex)
            {
                AuditLogger.Instance.Log("settings", "save_failed", "warning", ex.Message);
            }
        }
    }

    public void SetApiKey(string plainApiKey)
    {
        if (string.IsNullOrWhiteSpace(plainApiKey))
        {
            Current.EncryptedApiKeyBase64 = string.Empty;
        }
        else
        {
            Current.EncryptedApiKeyBase64 = SealApiKey(plainApiKey.Trim());
        }
        Save();
    }

    public string GetApiKey()
    {
        if (string.IsNullOrWhiteSpace(Current.EncryptedApiKeyBase64))
        {
            return Current.AiProvider switch
            {
                "Gemini" => Environment.GetEnvironmentVariable("GEMINI_API_KEY") ?? string.Empty,
                "OpenAI" => Environment.GetEnvironmentVariable("OPENAI_API_KEY") ?? string.Empty,
                _ => string.Empty
            };
        }

        try
        {
            var cipher = Convert.FromBase64String(Current.EncryptedApiKeyBase64);
            var plain = NativeInterop.UnprotectBytes(cipher);
            try
            {
                return Encoding.UTF8.GetString(plain);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(plain);
            }
        }
        catch
        {
            return string.Empty;
        }
    }

    public bool HasApiKey => !string.IsNullOrWhiteSpace(GetApiKey());

    public bool SetStartWithWindows(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunRegistryKey, writable: true);
            if (key is null) return false;

            if (enabled)
            {
                var exePath = Environment.ProcessPath;
                if (!string.IsNullOrWhiteSpace(exePath))
                {
                    key.SetValue(RunValueName, $"\"{exePath}\"");
                }
            }
            else
            {
                key.DeleteValue(RunValueName, throwOnMissingValue: false);
            }

            Current.StartWithWindows = enabled;
            Save();
            AuditLogger.Instance.Log("settings", "startup_toggle", "allowed", $"StartWithWindows={enabled}");
            return true;
        }
        catch (Exception ex)
        {
            AuditLogger.Instance.Log("settings", "startup_toggle", "warning", ex.Message);
            return false;
        }
    }

    private static string SealApiKey(string plain)
    {
        var bytes = Encoding.UTF8.GetBytes(plain);
        try
        {
            var cipher = NativeInterop.ProtectBytes(bytes);
            return Convert.ToBase64String(cipher);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }
    }
}
