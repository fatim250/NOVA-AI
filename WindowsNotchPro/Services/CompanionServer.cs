using System;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace WindowsNotchPro.Services;

public sealed class CompanionServer : IDisposable
{
    private const int MaxPayloadBytes = 16 * 1024;

    private readonly CommandParser _parser;
    private readonly SecurityVault _vault;
    private readonly AuditLogger _audit;
    private readonly HttpListener _listener = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly byte[] _authTokenBytes;

    public string ListenUrl { get; }
    public string PairingToken { get; }
    public event Action<string>? OnCommandExecuted;

    public CompanionServer(CommandParser parser, SecurityVault vault, AuditLogger audit, int port = 17420)
    {
        _parser = parser;
        _vault = vault;
        _audit = audit;
        ListenUrl = $"http://127.0.0.1:{port}/";

        // Generate a cryptographically strong 256-bit runtime pairing token (or read NOTCH_COMPANION_TOKEN)
        var envToken = Environment.GetEnvironmentVariable("NOTCH_COMPANION_TOKEN");
        PairingToken = !string.IsNullOrWhiteSpace(envToken) && envToken.Length >= 24
            ? envToken.Trim()
            : Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

        _authTokenBytes = Encoding.UTF8.GetBytes(PairingToken);
        _listener.Prefixes.Add(ListenUrl);
    }

    public void Start()
    {
        try
        {
            _listener.Start();
            _ = Task.Run(() => AcceptLoopAsync(_cts.Token));
        }
        catch (Exception ex)
        {
            _audit.Log("system", "companion_start_failed", "warning", ex.Message);
        }
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener.IsListening)
        {
            try
            {
                var ctx = await _listener.GetContextAsync();
                _ = Task.Run(() => HandleContextAsync(ctx, ct), ct);
            }
            catch (HttpListenerException)
            {
                break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }
        }
    }

    private bool IsAuthorized(HttpListenerRequest req)
    {
        var header = req.Headers["Authorization"];
        if (string.IsNullOrWhiteSpace(header) || !header.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            return false;
        }

        var suppliedBytes = Encoding.UTF8.GetBytes(header["Bearer ".Length..].Trim());
        try
        {
            return suppliedBytes.Length == _authTokenBytes.Length &&
                   CryptographicOperations.FixedTimeEquals(suppliedBytes, _authTokenBytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(suppliedBytes);
        }
    }

    private async Task HandleContextAsync(HttpListenerContext ctx, CancellationToken ct)
    {
        if (!IsAuthorized(ctx.Request))
        {
            _audit.Log("security", "companion_auth_rejected", "blocked", $"Rejected unauthorized request from {ctx.Request.RemoteEndPoint}");
            ctx.Response.StatusCode = 401;
            await WriteJsonAsync(ctx.Response, new { ok = false, error = "Unauthorized Bearer token" });
            return;
        }

        if (ctx.Request.IsWebSocketRequest && ctx.Request.Url?.AbsolutePath == "/ws")
        {
            var wsCtx = await ctx.AcceptWebSocketAsync(subProtocol: null);
            await HandleWebSocketAsync(wsCtx.WebSocket, ct);
            return;
        }

        var path = ctx.Request.Url?.AbsolutePath ?? "/";
        if (ctx.Request.HttpMethod == "GET" && path == "/api/status")
        {
            await WriteJsonAsync(ctx.Response, new
            {
                ok = true,
                assistantName = _parser.AssistantName,
                vaultEnrolled = _vault.IsEnrolled,
                lockoutSeconds = _vault.LockoutSecondsRemaining
            });
            return;
        }

        if (ctx.Request.HttpMethod == "POST" && path == "/api/command")
        {
            using var reader = new StreamReader(ctx.Request.InputStream, Encoding.UTF8);
            var body = await reader.ReadToEndAsync(ct);
            if (body.Length > MaxPayloadBytes)
            {
                ctx.Response.StatusCode = 413;
                await WriteJsonAsync(ctx.Response, new { ok = false, error = "Payload exceeds 16 KB limit" });
                return;
            }

            var responseJson = await DispatchJsonPayloadAsync(body);
            await WriteRawJsonAsync(ctx.Response, responseJson);
            return;
        }

        ctx.Response.StatusCode = 404;
        await WriteJsonAsync(ctx.Response, new { ok = false, error = "Unknown companion endpoint" });
    }

    private async Task HandleWebSocketAsync(WebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[MaxPayloadBytes];
        try
        {
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await ws.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", ct);
                    break;
                }

                if (result.Count > 0 && result.EndOfMessage)
                {
                    var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    var replyJson = await DispatchJsonPayloadAsync(text);
                    var outBytes = Encoding.UTF8.GetBytes(replyJson);
                    await ws.SendAsync(outBytes, WebSocketMessageType.Text, endOfMessage: true, ct);
                }
            }
        }
        finally
        {
            ws.Dispose();
        }
    }

    private async Task<string> DispatchJsonPayloadAsync(string rawJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(rawJson);
            var root = doc.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : "command";

            if (type == "unlock_challenge")
            {
                var pass = root.TryGetProperty("passphrase", out var p) ? p.GetString() ?? string.Empty : string.Empty;
                var vec = root.TryGetProperty("voiceprint", out var v) && v.ValueKind == JsonValueKind.Array
                    ? JsonSerializer.Deserialize<double[]>(v.GetRawText()) ?? Array.Empty<double>()
                    : Array.Empty<double>();

                var verify = _vault.VerifyTwoFactor(pass, vec);
                return JsonSerializer.Serialize(new
                {
                    ok = verify.Verified,
                    similarity = verify.Similarity,
                    reply = verify.Message
                });
            }

            var prompt = root.TryGetProperty("prompt", out var pr) ? pr.GetString() ?? string.Empty : string.Empty;
            var res = await _parser.ExecuteAsync(prompt);
            OnCommandExecuted?.Invoke(res.Reply);

            if (res.TriggerLockWorkstation)
            {
                NativeInterop.LockWorkstation();
            }

            return JsonSerializer.Serialize(new { ok = res.Succeeded, reply = res.Reply });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { ok = false, reply = $"Invalid request: {ex.Message}" });
        }
    }

    private static Task WriteJsonAsync(HttpListenerResponse resp, object payload) =>
        WriteRawJsonAsync(resp, JsonSerializer.Serialize(payload));

    private static async Task WriteRawJsonAsync(HttpListenerResponse resp, string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        resp.ContentType = "application/json; charset=utf-8";
        resp.ContentLength64 = bytes.Length;
        await resp.OutputStream.WriteAsync(bytes);
        resp.Close();
    }

    public void Dispose()
    {
        _cts.Cancel();
        if (_listener.IsListening) _listener.Stop();
        _listener.Close();
        CryptographicOperations.ZeroMemory(_authTokenBytes);
        _cts.Dispose();
    }
}
