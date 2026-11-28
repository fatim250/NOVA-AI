using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace WindowsNotchPro.Services;

/// <summary>
/// Native C# Gemini Multimodal Live Voice client over BidiGenerateContent WebSocket.
/// Streams 16kHz PCM mic audio to Gemini and plays Gemini's own natural voice (Kore, Zephyr, Puck, etc.)
/// at 24kHz PCM directly through Windows audio — zero built-in PC SAPI voice.
/// </summary>
public sealed class GeminiLiveVoiceService : IDisposable
{
    public static readonly string[] AvailableVoices =
    {
        "Kore", "Zephyr", "Puck", "Charon", "Fenrir", "Aoede"
    };

    private readonly SettingsService _settings;
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;
    private PcmAudioRecorder? _recorder;
    private PcmAudioPlayer? _player;
    private volatile bool _setupCompleted;

    public bool IsActive => _ws is { State: WebSocketState.Open };
    public string ActiveVoice => string.IsNullOrWhiteSpace(_settings.Current.GeminiVoice) ? "Kore" : _settings.Current.GeminiVoice;

    public event Action<string>? StatusChanged;        // "connecting" | "live" | "speaking" | "disconnected"
    public event Action<string>? InputTranscriptDelta;
    public event Action<string>? OutputTranscriptDelta;
    public event Action<double>? AudioLevelChanged;    // 0.0 - 1.0 real-time voice amplitude for Siri-style orb
    public event Action? TurnCompleted;
    public event Action<string>? ErrorOccurred;

    /// <summary>
    /// Optional tool executor so Gemini Live Voice (Kore) can directly control the entire Windows PC!
    /// </summary>
    public Func<string, JsonElement, Task<string>>? ToolExecutor { get; set; }

    public GeminiLiveVoiceService(SettingsService settings)
    {
        _settings = settings;
    }

    public async Task<bool> StartLiveAsync()
    {
        if (IsActive) return true;

        var apiKey = _settings.GetApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            ErrorOccurred?.Invoke("Add your Gemini API key in Settings to use Gemini Live Voice.");
            return false;
        }

        StatusChanged?.Invoke("connecting");
        _cts = new CancellationTokenSource();
        _setupCompleted = false;

        var primaryModel = string.IsNullOrWhiteSpace(_settings.Current.GeminiLiveModel)
            ? "gemini-3.8-live"
            : _settings.Current.GeminiLiveModel.Trim();

        string[] modelsToTry =
        {
            primaryModel,
            "gemini-2.5-flash-native-audio-preview-12-2025",
            "gemini-2.0-flash-exp"
        };

        Exception? lastError = null;
        foreach (var model in modelsToTry)
        {
            try
            {
                var ok = await ConnectWithModelAsync(apiKey, model, _cts.Token);
                if (ok) return true;
            }
            catch (Exception ex)
            {
                lastError = ex;
                CleanupConnectionOnly();
            }
        }

        var msg = lastError?.Message ?? "Could not connect to Gemini Live Voice.";
        AuditLogger.Instance.Log("voice", "gemini_live_failed", "warning", msg);
        ErrorOccurred?.Invoke(msg);
        Stop();
        return false;
    }

    private async Task<bool> ConnectWithModelAsync(string apiKey, string model, CancellationToken ct)
    {
        _ws = new ClientWebSocket();
        var uri = new Uri($"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={Uri.EscapeDataString(apiKey)}");
        await _ws.ConnectAsync(uri, ct);

        var voiceName = ActiveVoice;
        var modelPath = model.StartsWith("models/", StringComparison.OrdinalIgnoreCase) ? model : $"models/{model}";

        var setupPayload = new
        {
            setup = new
            {
                model = modelPath,
                generationConfig = new
                {
                    responseModalities = new[] { "AUDIO" },
                    speechConfig = new
                    {
                        voiceConfig = new
                        {
                            prebuiltVoiceConfig = new { voiceName }
                        }
                    }
                },
                inputAudioTranscription = new { },
                outputAudioTranscription = new { },
                tools = SystemControlService.BuildGeminiToolDeclarations(),
                systemInstruction = new
                {
                    parts = new[]
                    {
                        new
                        {
                            text = $"You are {_settings.Current.AssistantName}, an advanced real-time Windows OS voice assistant with full computer control. Whenever the user asks to open/close/focus apps, control windows, volume, brightness, media, screenshots, settings, clipboard, files, folders, typing, hotkeys, mouse, web search, focus timer, keep-awake, or power actions, call the appropriate tool immediately and confirm concisely in 1 to 2 spoken sentences."
                        }
                    }
                }
            }
        };

        await SendJsonAsync(setupPayload, ct);

        // Wait for setupComplete acknowledgment (up to 6s)
        using var setupTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        setupTimeout.CancelAfter(TimeSpan.FromSeconds(6));

        var firstMsg = await ReceiveSingleMessageAsync(_ws, setupTimeout.Token);
        if (firstMsg is null)
        {
            throw new InvalidOperationException($"Gemini Live closed during setup for model '{model}'.");
        }

        using (var doc = JsonDocument.Parse(firstMsg))
        {
            if (doc.RootElement.TryGetProperty("error", out var err))
            {
                throw new InvalidOperationException(err.ToString());
            }
        }

        _setupCompleted = true;

        // Start 24kHz PCM playback and 16kHz PCM mic capture
        _player = new PcmAudioPlayer();
        _player.Open(24000);
        _player.PlaybackDrained += () =>
        {
            if (IsActive) StatusChanged?.Invoke("live");
        };

        _recorder = new PcmAudioRecorder();
        _recorder.AudioChunkAvailable += OnMicAudioChunk;
        if (!_recorder.Start(16000))
        {
            ErrorOccurred?.Invoke("Microphone could not be opened. You can still type to hear Gemini speak.");
        }

        StatusChanged?.Invoke("live");
        AuditLogger.Instance.Log("voice", "gemini_live_connected", "allowed", $"Model={model}, Voice={voiceName}");

        _ = Task.Run(() => ReceiveLoopAsync(_ws, ct), ct);
        return true;
    }

    public async Task SendTextMessageAsync(string text)
    {
        if (!IsActive || !_setupCompleted || string.IsNullOrWhiteSpace(text) || _cts is null) return;

        var payload = new
        {
            clientContent = new
            {
                turns = new[]
                {
                    new
                    {
                        role = "user",
                        parts = new[] { new { text = text.Trim() } }
                    }
                },
                turnComplete = true
            }
        };

        try
        {
            await SendJsonAsync(payload, _cts.Token);
        }
        catch (Exception ex)
        {
            ErrorOccurred?.Invoke($"Failed to send live message: {ex.Message}");
        }
    }

    private void OnMicAudioChunk(byte[] pcm16k)
    {
        if (!IsActive || !_setupCompleted || _cts is null || _cts.IsCancellationRequested) return;
        AudioLevelChanged?.Invoke(ComputePcm16Level(pcm16k));

        var b64 = Convert.ToBase64String(pcm16k);
        var payload = new
        {
            realtimeInput = new
            {
                audio = new
                {
                    mimeType = "audio/pcm;rate=16000",
                    data = b64
                }
            }
        };

        _ = Task.Run(async () =>
        {
            try
            {
                if (IsActive && _cts is not null)
                {
                    await SendJsonAsync(payload, _cts.Token);
                }
            }
            catch { }
        });
    }

    private async Task ReceiveLoopAsync(ClientWebSocket ws, CancellationToken ct)
    {
        try
        {
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var raw = await ReceiveSingleMessageAsync(ws, ct);
                if (raw is null) break;

                HandleServerJson(raw);
            }
        }
        catch (OperationCanceledException)
        {
            // Normal stop
        }
        catch (Exception ex)
        {
            if (!ct.IsCancellationRequested)
            {
                ErrorOccurred?.Invoke($"Gemini Live disconnected: {ex.Message}");
            }
        }
        finally
        {
            Stop();
        }
    }

    private void HandleServerJson(string rawJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(rawJson);
            var root = doc.RootElement;

            // Handle real-time Gemini Live Tool Calls (full Windows OS control by voice!)
            if (root.TryGetProperty("toolCall", out var toolCall) &&
                toolCall.TryGetProperty("functionCalls", out var fnCalls) &&
                fnCalls.ValueKind == JsonValueKind.Array &&
                ToolExecutor is not null)
            {
                var callsCopy = fnCalls.Clone();
                _ = Task.Run(() => ExecuteLiveToolCallsAsync(callsCopy));
                return;
            }

            if (!root.TryGetProperty("serverContent", out var content)) return;

            if (content.TryGetProperty("interrupted", out var interrupted) && interrupted.ValueKind == JsonValueKind.True)
            {
                _player?.Flush();
                StatusChanged?.Invoke("live");
            }

            if (content.TryGetProperty("inputTranscription", out var inTr) &&
                inTr.TryGetProperty("text", out var inText))
            {
                var delta = inText.GetString();
                if (!string.IsNullOrEmpty(delta)) InputTranscriptDelta?.Invoke(delta);
            }

            if (content.TryGetProperty("outputTranscription", out var outTr) &&
                outTr.TryGetProperty("text", out var outText))
            {
                var delta = outText.GetString();
                if (!string.IsNullOrEmpty(delta)) OutputTranscriptDelta?.Invoke(delta);
            }

            if (content.TryGetProperty("modelTurn", out var modelTurn) &&
                modelTurn.TryGetProperty("parts", out var parts) &&
                parts.ValueKind == JsonValueKind.Array)
            {
                foreach (var part in parts.EnumerateArray())
                {
                    if (part.TryGetProperty("inlineData", out var inlineData) &&
                        inlineData.TryGetProperty("data", out var dataProp))
                    {
                        var b64 = dataProp.GetString();
                        if (!string.IsNullOrEmpty(b64))
                        {
                            var pcmBytes = Convert.FromBase64String(b64);
                            StatusChanged?.Invoke("speaking");
                            AudioLevelChanged?.Invoke(ComputePcm16Level(pcmBytes));
                            _player?.Enqueue(pcmBytes);
                        }
                    }
                }
            }

            if (content.TryGetProperty("turnComplete", out var tc) && tc.ValueKind == JsonValueKind.True)
            {
                TurnCompleted?.Invoke();
                if (_player is not { IsPlaying: true })
                {
                    StatusChanged?.Invoke("live");
                }
            }
        }
        catch
        {
            // Ignore malformed frames
        }
    }

    private async Task ExecuteLiveToolCallsAsync(JsonElement fnCalls)
    {
        if (ToolExecutor is null || _cts is null || !IsActive) return;

        var responses = new System.Collections.Generic.List<object>();
        foreach (var call in fnCalls.EnumerateArray())
        {
            var id = call.TryGetProperty("id", out var idProp) ? idProp.GetString() ?? Guid.NewGuid().ToString("N") : Guid.NewGuid().ToString("N");
            var name = call.TryGetProperty("name", out var nameProp) ? nameProp.GetString() ?? string.Empty : string.Empty;
            var args = call.TryGetProperty("args", out var argsProp) ? argsProp.Clone() : JsonDocument.Parse("{}").RootElement;

            string result;
            try
            {
                result = await ToolExecutor(name, args);
            }
            catch (Exception ex)
            {
                result = $"Tool error: {ex.Message}";
            }

            AuditLogger.Instance.Log("voice_tool", name, "allowed", result);
            responses.Add(new
            {
                id,
                name,
                response = new { result }
            });
        }

        if (responses.Count > 0 && IsActive && _cts is not null)
        {
            try
            {
                await SendJsonAsync(new { toolResponse = new { functionResponses = responses } }, _cts.Token);
            }
            catch { }
        }
    }

    private async Task SendJsonAsync(object obj, CancellationToken ct)
    {
        if (_ws is not { State: WebSocketState.Open }) return;
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(obj));
        await _sendLock.WaitAsync(ct);
        try
        {
            if (_ws is { State: WebSocketState.Open })
            {
                await _ws.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, ct);
            }
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private static async Task<string?> ReceiveSingleMessageAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[16384];
        using var ms = new MemoryStream();
        while (true)
        {
            var res = await ws.ReceiveAsync(buffer, ct);
            if (res.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }
            ms.Write(buffer, 0, res.Count);
            if (res.EndOfMessage)
            {
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }
    }

    private static double ComputePcm16Level(byte[] pcm)
    {
        if (pcm.Length < 4) return 0;
        double sumSq = 0;
        int samples = pcm.Length / 2;
        int step = Math.Max(1, samples / 120);
        int count = 0;
        for (int i = 0; i < samples; i += step)
        {
            short s = BitConverter.ToInt16(pcm, i * 2);
            double norm = s / 32768.0;
            sumSq += norm * norm;
            count++;
        }
        if (count == 0) return 0;
        return Math.Clamp(Math.Sqrt(sumSq / count) * 4.5, 0.0, 1.0);
    }

    private void CleanupConnectionOnly()
    {
        try { _ws?.Abort(); } catch { }
        try { _ws?.Dispose(); } catch { }
        _ws = null;
    }

    public void Stop()
    {
        _setupCompleted = false;
        try { _cts?.Cancel(); } catch { }
        _recorder?.Dispose();
        _recorder = null;
        _player?.Dispose();
        _player = null;
        CleanupConnectionOnly();
        try { _cts?.Dispose(); } catch { }
        _cts = null;
        StatusChanged?.Invoke("disconnected");
    }

    public void Dispose()
    {
        Stop();
        _sendLock.Dispose();
    }
}
