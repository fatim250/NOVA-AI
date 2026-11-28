using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace WindowsNotchPro.Services;

public sealed record ChatBubble(
    string Role, // "user" | "assistant" | "tool"
    string Text,
    DateTimeOffset Timestamp)
{
    public bool IsUser => Role == "user";
    public bool IsTool => Role == "tool";
    public string TimeLabel => Timestamp.ToString("HH:mm");
}

public sealed class AiBrainService
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(35) };

    private readonly SettingsService _settings;
    private readonly List<ChatBubble> _history = new();
    private const int MaxHistory = 16;

    public IReadOnlyList<ChatBubble> History => _history;

    public AiBrainService(SettingsService settings)
    {
        _settings = settings;
    }

    public bool IsConfigured
    {
        get
        {
            var provider = _settings.Current.AiProvider;
            if (provider.Equals("Ollama", StringComparison.OrdinalIgnoreCase)) return true;
            if (provider.Equals("Gemini", StringComparison.OrdinalIgnoreCase) ||
                provider.Equals("OpenAI", StringComparison.OrdinalIgnoreCase))
            {
                return _settings.HasApiKey;
            }
            return false;
        }
    }

    public string ProviderBadge
    {
        get
        {
            var p = _settings.Current.AiProvider;
            if (!IsConfigured) return "Local Mode";
            return $"{p} · {_settings.Current.AiModel}";
        }
    }

    public void ClearHistory() => _history.Clear();

    public void AppendExternalTurn(string userText, string assistantReply)
    {
        AddHistory("user", userText);
        AddHistory("assistant", assistantReply);
    }

    public async Task<(bool Ok, string Reply, string? ToolTrace)> AskAsync(
        string prompt,
        Func<string, JsonElement, Task<string>> executeTool)
    {
        AddHistory("user", prompt);

        var provider = _settings.Current.AiProvider;
        try
        {
            var (reply, trace) = provider.ToLowerInvariant() switch
            {
                "gemini" => await CallGeminiAsync(prompt, executeTool),
                "openai" => await CallOpenAiAsync(prompt, executeTool),
                "ollama" => await CallOllamaAsync(prompt),
                _ => ("AI provider is not configured. Open Settings to add Gemini, OpenAI, or Ollama.", (string?)null)
            };

            AddHistory("assistant", reply);
            return (true, reply, trace);
        }
        catch (Exception ex)
        {
            var err = $"AI request failed ({provider}): {ex.Message}";
            AuditLogger.Instance.Log("ai", "request_failed", "warning", err);
            AddHistory("assistant", err);
            return (false, err, null);
        }
    }

    private string BuildSystemPrompt() =>
        $"You are {_settings.Current.AssistantName}, an ultra-fast, concise native Windows Dynamic Island AI assistant. " +
        "Keep answers crisp (1-3 sentences unless asked for detail) because they appear in a compact top-screen notch. " +
        "When the user wants to control their PC (open/close apps, create/rename/delete folders, change volume, control media, check CPU/RAM/battery, set focus timer, toggle keep-awake, search the web, or lock PC), call the appropriate tool.";

    private async Task<(string Reply, string? ToolTrace)> CallGeminiAsync(
        string prompt,
        Func<string, JsonElement, Task<string>> executeTool)
    {
        var apiKey = _settings.GetApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return ("Gemini API key is missing. Add it in the Settings tab.", null);
        }

        var model = string.IsNullOrWhiteSpace(_settings.Current.AiModel) ? "gemini-3.1-flash-lite" : _settings.Current.AiModel.Trim();
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(apiKey)}";

        var contents = _history
            .Where(h => h.Role is "user" or "assistant")
            .TakeLast(10)
            .Select(h => new Dictionary<string, object>
            {
                ["role"] = h.Role == "user" ? "user" : "model",
                ["parts"] = new object[] { new Dictionary<string, object> { ["text"] = h.Text } }
            })
            .ToList();

        var tools = SystemControlService.BuildGeminiToolDeclarations();

        var payload = new Dictionary<string, object>
        {
            ["system_instruction"] = new { parts = new[] { new { text = BuildSystemPrompt() } } },
            ["contents"] = contents,
            ["tools"] = tools,
            ["generationConfig"] = new { temperature = 0.6, maxOutputTokens = 320 }
        };

        using var doc = await PostJsonAsync(url, payload, bearerToken: null);
        var (text, fnName, fnArgs) = ParseGeminiResponse(doc.RootElement);

        if (!string.IsNullOrEmpty(fnName))
        {
            string toolResult = await executeTool(fnName, fnArgs);
            string trace = $"Tool: {fnName} -> {toolResult}";

            // Send function response back for a natural final answer
            contents.Add(new Dictionary<string, object>
            {
                ["role"] = "model",
                ["parts"] = new object[]
                {
                    new Dictionary<string, object>
                    {
                        ["functionCall"] = new Dictionary<string, object>
                        {
                            ["name"] = fnName,
                            ["args"] = JsonSerializer.Deserialize<object>(fnArgs.GetRawText()) ?? new { }
                        }
                    }
                }
            });
            contents.Add(new Dictionary<string, object>
            {
                ["role"] = "user",
                ["parts"] = new object[]
                {
                    new Dictionary<string, object>
                    {
                        ["functionResponse"] = new Dictionary<string, object>
                        {
                            ["name"] = fnName,
                            ["response"] = new Dictionary<string, object> { ["result"] = toolResult }
                        }
                    }
                }
            });

            var followUpPayload = new Dictionary<string, object>
            {
                ["system_instruction"] = new { parts = new[] { new { text = BuildSystemPrompt() } } },
                ["contents"] = contents,
                ["generationConfig"] = new { temperature = 0.4, maxOutputTokens = 200 }
            };

            using var followDoc = await PostJsonAsync(url, followUpPayload, bearerToken: null);
            var (finalText, _, _) = ParseGeminiResponse(followDoc.RootElement);
            return (string.IsNullOrWhiteSpace(finalText) ? toolResult : finalText, trace);
        }

        return (string.IsNullOrWhiteSpace(text) ? "No response from Gemini." : text, null);
    }

    private async Task<(string Reply, string? ToolTrace)> CallOpenAiAsync(
        string prompt,
        Func<string, JsonElement, Task<string>> executeTool)
    {
        var apiKey = _settings.GetApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return ("OpenAI API key is missing. Add it in the Settings tab.", null);
        }

        var baseUrl = string.IsNullOrWhiteSpace(_settings.Current.AiEndpoint)
            ? "https://api.openai.com/v1"
            : _settings.Current.AiEndpoint.Trim().TrimEnd('/');
        var url = baseUrl.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase)
            ? baseUrl
            : $"{baseUrl}/chat/completions";

        var model = string.IsNullOrWhiteSpace(_settings.Current.AiModel) ? "gpt-4o-mini" : _settings.Current.AiModel.Trim();

        var messages = new List<object>
        {
            new { role = "system", content = BuildSystemPrompt() }
        };
        foreach (var h in _history.Where(x => x.Role is "user" or "assistant").TakeLast(10))
        {
            messages.Add(new { role = h.Role, content = h.Text });
        }

        var payload = new Dictionary<string, object>
        {
            ["model"] = model,
            ["messages"] = messages,
            ["tools"] = BuildOpenAiTools(),
            ["max_tokens"] = 320,
            ["temperature"] = 0.6
        };

        using var doc = await PostJsonAsync(url, payload, bearerToken: apiKey);
        var choice = doc.RootElement.GetProperty("choices")[0].GetProperty("message");

        if (choice.TryGetProperty("tool_calls", out var toolCalls) && toolCalls.GetArrayLength() > 0)
        {
            var firstCall = toolCalls[0];
            var callId = firstCall.GetProperty("id").GetString() ?? "call_1";
            var fn = firstCall.GetProperty("function");
            var fnName = fn.GetProperty("name").GetString() ?? string.Empty;
            var argsRaw = fn.GetProperty("arguments").GetString() ?? "{}";
            using var argsDoc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argsRaw) ? "{}" : argsRaw);

            string toolResult = await executeTool(fnName, argsDoc.RootElement);
            string trace = $"Tool: {fnName} -> {toolResult}";

            messages.Add(JsonSerializer.Deserialize<object>(choice.GetRawText())!);
            messages.Add(new { role = "tool", tool_call_id = callId, content = toolResult });

            var followUp = new Dictionary<string, object>
            {
                ["model"] = model,
                ["messages"] = messages,
                ["max_tokens"] = 200
            };

            using var followDoc = await PostJsonAsync(url, followUp, bearerToken: apiKey);
            var finalContent = followDoc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
            return (string.IsNullOrWhiteSpace(finalContent) ? toolResult : finalContent.Trim(), trace);
        }

        var content = choice.TryGetProperty("content", out var c) ? c.GetString() : null;
        return (string.IsNullOrWhiteSpace(content) ? "No response from model." : content.Trim(), null);
    }

    private async Task<(string Reply, string? ToolTrace)> CallOllamaAsync(string prompt)
    {
        var baseUrl = string.IsNullOrWhiteSpace(_settings.Current.AiEndpoint)
            ? "http://localhost:11434"
            : _settings.Current.AiEndpoint.Trim().TrimEnd('/');
        var url = $"{baseUrl}/api/chat";
        var model = string.IsNullOrWhiteSpace(_settings.Current.AiModel) ? "llama3.2" : _settings.Current.AiModel.Trim();

        var messages = new List<object>
        {
            new { role = "system", content = BuildSystemPrompt() }
        };
        foreach (var h in _history.Where(x => x.Role is "user" or "assistant").TakeLast(8))
        {
            messages.Add(new { role = h.Role, content = h.Text });
        }

        var payload = new
        {
            model,
            messages,
            stream = false
        };

        using var doc = await PostJsonAsync(url, payload, bearerToken: null);
        if (doc.RootElement.TryGetProperty("message", out var msg) &&
            msg.TryGetProperty("content", out var content))
        {
            return (content.GetString()?.Trim() ?? "Empty response from Ollama.", null);
        }
        return ("No response from Ollama.", null);
    }

    private static async Task<JsonDocument> PostJsonAsync(string url, object payload, string? bearerToken)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        if (!string.IsNullOrWhiteSpace(bearerToken))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        using var resp = await Http.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"HTTP {(int)resp.StatusCode}: {(body.Length > 160 ? body[..160] : body)}");
        }
        return JsonDocument.Parse(body);
    }

    private static (string Text, string FnName, JsonElement FnArgs) ParseGeminiResponse(JsonElement root)
    {
        if (!root.TryGetProperty("candidates", out var candidates) || candidates.GetArrayLength() == 0)
        {
            return (string.Empty, string.Empty, default);
        }

        var parts = candidates[0].GetProperty("content").GetProperty("parts");
        var textSb = new StringBuilder();
        foreach (var part in parts.EnumerateArray())
        {
            if (part.TryGetProperty("functionCall", out var fc))
            {
                var name = fc.GetProperty("name").GetString() ?? string.Empty;
                var args = fc.TryGetProperty("args", out var a) ? a.Clone() : JsonDocument.Parse("{}").RootElement;
                return (textSb.ToString().Trim(), name, args);
            }
            if (part.TryGetProperty("text", out var t))
            {
                textSb.Append(t.GetString());
            }
        }
        return (textSb.ToString().Trim(), string.Empty, default);
    }

    private static object[] BuildGeminiTools() => new object[]
    {
        new
        {
            functionDeclarations = new object[]
            {
                new { name = "open_app", description = "Open a Windows application by name", parameters = new { type = "OBJECT", properties = new { name = new { type = "STRING" } }, required = new[] { "name" } } },
                new { name = "close_app", description = "Close a running non-critical Windows application", parameters = new { type = "OBJECT", properties = new { name = new { type = "STRING" } }, required = new[] { "name" } } },
                new { name = "create_folder", description = "Create a folder in Desktop, Documents, or Downloads", parameters = new { type = "OBJECT", properties = new { name = new { type = "STRING" }, root = new { type = "STRING" } }, required = new[] { "name" } } },
                new { name = "set_volume", description = "Set master Windows volume percentage 0 to 100", parameters = new { type = "OBJECT", properties = new { percent = new { type = "INTEGER" } }, required = new[] { "percent" } } },
                new { name = "media_control", description = "Control media playback: play_pause, next, previous, stop", parameters = new { type = "OBJECT", properties = new { action = new { type = "STRING" } }, required = new[] { "action" } } },
                new { name = "get_system_stats", description = "Get current CPU, RAM, and battery telemetry", parameters = new { type = "OBJECT", properties = new { } } },
                new { name = "set_focus_timer", description = "Start a Pomodoro focus timer in minutes", parameters = new { type = "OBJECT", properties = new { minutes = new { type = "INTEGER" } }, required = new[] { "minutes" } } },
                new { name = "set_keep_awake", description = "Enable or disable keep-awake mode", parameters = new { type = "OBJECT", properties = new { enabled = new { type = "BOOLEAN" } }, required = new[] { "enabled" } } },
                new { name = "web_search", description = "Open a web search in the default browser", parameters = new { type = "OBJECT", properties = new { query = new { type = "STRING" } }, required = new[] { "query" } } },
                new { name = "lock_pc", description = "Lock the Windows workstation immediately", parameters = new { type = "OBJECT", properties = new { } } }
            }
        }
    };

    private static object[] BuildOpenAiTools() => new object[]
    {
        MakeOpenAiTool("open_app", "Open a Windows application by name", new { type = "object", properties = new { name = new { type = "string" } }, required = new[] { "name" } }),
        MakeOpenAiTool("close_app", "Close a running non-critical application", new { type = "object", properties = new { name = new { type = "string" } }, required = new[] { "name" } }),
        MakeOpenAiTool("create_folder", "Create a folder in Desktop, Documents, or Downloads", new { type = "object", properties = new { name = new { type = "string" }, root = new { type = "string" } }, required = new[] { "name" } }),
        MakeOpenAiTool("set_volume", "Set master volume percentage (0-100)", new { type = "object", properties = new { percent = new { type = "integer" } }, required = new[] { "percent" } }),
        MakeOpenAiTool("media_control", "Control media: play_pause, next, previous, stop", new { type = "object", properties = new { action = new { type = "string" } }, required = new[] { "action" } }),
        MakeOpenAiTool("get_system_stats", "Read live CPU, RAM, and battery stats", new { type = "object", properties = new { } }),
        MakeOpenAiTool("set_focus_timer", "Start focus timer in minutes", new { type = "object", properties = new { minutes = new { type = "integer" } }, required = new[] { "minutes" } }),
        MakeOpenAiTool("set_keep_awake", "Toggle keep-awake", new { type = "object", properties = new { enabled = new { type = "boolean" } }, required = new[] { "enabled" } }),
        MakeOpenAiTool("web_search", "Open web search in browser", new { type = "object", properties = new { query = new { type = "string" } }, required = new[] { "query" } }),
        MakeOpenAiTool("lock_pc", "Lock Windows workstation", new { type = "object", properties = new { } }),
    };

    private static object MakeOpenAiTool(string name, string desc, object parameters) => new
    {
        type = "function",
        function = new { name, description = desc, parameters }
    };

    private void AddHistory(string role, string text)
    {
        _history.Add(new ChatBubble(role, text, DateTimeOffset.Now));
        while (_history.Count > MaxHistory)
        {
            _history.RemoveAt(0);
        }
    }
}
