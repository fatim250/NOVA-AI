using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace WindowsNotchPro.Services;

public sealed record MediaPlaybackState(
    bool HasMedia,
    bool IsPlaying,
    string Title,
    string Artist,
    string SourceApp)
{
    public string Album { get; init; } = string.Empty;
    public TimeSpan Position { get; init; }
    public TimeSpan Duration { get; init; }
    public DateTimeOffset CapturedAt { get; init; } = DateTimeOffset.Now;

    /// <summary>Raw thumbnail bytes published by the playing app (album art, YouTube video thumbnail, ...).</summary>
    public byte[]? Thumbnail { get; init; }

    /// <summary>Bumps whenever the session publishes a different thumbnail image.</summary>
    public int ThumbnailVersion { get; init; }

    public bool FromSystemSession { get; init; }
    public bool HasTimeline => Duration > TimeSpan.FromSeconds(1);
    public string TrackKey => $"{Title}|{Artist}";

    /// <summary>Position projected forward from the last poll while playing.</summary>
    public TimeSpan LivePosition
    {
        get
        {
            if (!HasTimeline) return TimeSpan.Zero;
            var pos = IsPlaying ? Position + (DateTimeOffset.Now - CapturedAt) : Position;
            if (pos < TimeSpan.Zero) pos = TimeSpan.Zero;
            return pos > Duration ? Duration : pos;
        }
    }
}

/// <summary>
/// Detects what is playing through the Windows System Media Transport Controls (SMTC) session:
/// real title / artist / album, true play state, timeline and the actual thumbnail the app publishes.
/// Falls back to window-title sniffing when no SMTC session is available.
/// </summary>
public sealed class MediaSessionService
{
    private const byte VkMediaNextTrack = 0xB0;
    private const byte VkMediaPrevTrack = 0xB1;
    private const byte VkMediaStop = 0xB2;
    private const byte VkMediaPlayPause = 0xB3;
    private const uint KeyEventKeyUp = 0x0002;

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    private GlobalSystemMediaTransportControlsSessionManager? _manager;
    private bool _managerFailed;
    private GlobalSystemMediaTransportControlsSession? _activeSession;
    private string _thumbKey = string.Empty;
    private byte[]? _thumbBytes;
    private int _thumbVersion;
    private DateTimeOffset _thumbTrackStarted;

    private static bool SameBytes(byte[] a, byte[] b) => a.Length == b.Length && a.AsSpan().SequenceEqual(b);

    public void PlayPause() => _ = RunSessionOrKey(s => s.TryTogglePlayPauseAsync().AsTask(), VkMediaPlayPause);
    public void NextTrack() => _ = RunSessionOrKey(s => s.TrySkipNextAsync().AsTask(), VkMediaNextTrack);
    public void PreviousTrack() => _ = RunSessionOrKey(s => s.TrySkipPreviousAsync().AsTask(), VkMediaPrevTrack);
    public void Stop() => _ = RunSessionOrKey(s => s.TryStopAsync().AsTask(), VkMediaStop);

    /// <summary>Seeks the active session to a fraction (0..1) of the track.</summary>
    public async Task<bool> SeekAsync(double fraction)
    {
        var session = _activeSession;
        if (session is null) return false;
        try
        {
            var tl = session.GetTimelineProperties();
            var span = tl.EndTime - tl.StartTime;
            if (span <= TimeSpan.Zero) return false;
            var target = tl.StartTime + TimeSpan.FromTicks((long)(span.Ticks * Math.Clamp(fraction, 0, 1)));
            return await session.TryChangePlaybackPositionAsync(target.Ticks);
        }
        catch
        {
            return false;
        }
    }

    private async Task RunSessionOrKey(Func<GlobalSystemMediaTransportControlsSession, Task<bool>> action, byte fallbackKey)
    {
        var session = _activeSession;
        if (session is not null)
        {
            try
            {
                if (await action(session)) return;
            }
            catch { }
        }
        SendMediaKey(fallbackKey);
    }

    private readonly System.Threading.SemaphoreSlim _detectGate = new(1, 1);

    public async Task<MediaPlaybackState> DetectNowPlayingAsync()
    {
        // Serialised: may be called from the UI poller and from AI tools at the same time.
        await _detectGate.WaitAsync().ConfigureAwait(false);
        try
        {
            var fromSession = await TryDetectFromSystemSessionAsync().ConfigureAwait(false);
            return fromSession ?? DetectNowPlaying();
        }
        finally
        {
            _detectGate.Release();
        }
    }

    private async Task<GlobalSystemMediaTransportControlsSessionManager?> GetManagerAsync()
    {
        if (_manager is not null || _managerFailed) return _manager;
        try
        {
            _manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        }
        catch
        {
            _managerFailed = true;
        }
        return _manager;
    }

    private async Task<MediaPlaybackState?> TryDetectFromSystemSessionAsync()
    {
        var manager = await GetManagerAsync();
        if (manager is null) return null;

        try
        {
            // Prefer a session that is actually playing, otherwise the system's current session.
            GlobalSystemMediaTransportControlsSession? chosen = null;
            IReadOnlyList<GlobalSystemMediaTransportControlsSession> sessions = manager.GetSessions();
            foreach (var s in sessions)
            {
                if (s.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                {
                    chosen = s;
                    break;
                }
            }
            chosen ??= manager.GetCurrentSession();
            _activeSession = chosen;
            if (chosen is null) return null;

            var props = await chosen.TryGetMediaPropertiesAsync();
            if (props is null || string.IsNullOrWhiteSpace(props.Title)) return null;

            bool playing = chosen.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;

            var timeline = chosen.GetTimelineProperties();
            var duration = timeline.EndTime - timeline.StartTime;
            var position = timeline.Position - timeline.StartTime;
            // SMTC refreshes position only occasionally, so project it forward from its last update.
            if (playing && timeline.LastUpdatedTime.Year > 2000)
            {
                var drift = DateTimeOffset.Now - timeline.LastUpdatedTime;
                if (drift > TimeSpan.Zero && drift < TimeSpan.FromHours(3)) position += drift;
            }
            if (duration > TimeSpan.Zero && position > duration) position = duration;
            if (position < TimeSpan.Zero) position = TimeSpan.Zero;

            string source = FriendlyAppName(chosen.SourceAppUserModelId);
            string title = props.Title.Trim();
            string artist = !string.IsNullOrWhiteSpace(props.Artist) ? props.Artist.Trim()
                : !string.IsNullOrWhiteSpace(props.AlbumArtist) ? props.AlbumArtist.Trim()
                : source;

            // Apps (browsers especially) often publish a placeholder icon first and the real artwork a few
            // seconds later, so keep re-reading the thumbnail during the first moments of each track.
            string key = $"{title}|{artist}";
            bool newTrack = !string.Equals(key, _thumbKey, StringComparison.Ordinal);
            if (newTrack)
            {
                _thumbKey = key;
                _thumbBytes = null;
                _thumbTrackStarted = DateTimeOffset.Now;
            }
            if (newTrack || _thumbBytes is null || DateTimeOffset.Now - _thumbTrackStarted < TimeSpan.FromSeconds(12))
            {
                var bytes = await ReadThumbnailAsync(props.Thumbnail);
                if (bytes is not null && (_thumbBytes is null || !SameBytes(bytes, _thumbBytes)))
                {
                    _thumbBytes = bytes;
                    _thumbVersion++;
                }
            }

            return new MediaPlaybackState(true, playing, title, artist, source)
            {
                Album = props.AlbumTitle ?? string.Empty,
                Position = position,
                Duration = duration > TimeSpan.Zero ? duration : TimeSpan.Zero,
                CapturedAt = DateTimeOffset.Now,
                Thumbnail = _thumbBytes,
                ThumbnailVersion = _thumbVersion,
                FromSystemSession = true
            };
        }
        catch
        {
            return null;
        }
    }

    private static async Task<byte[]?> ReadThumbnailAsync(IRandomAccessStreamReference? reference)
    {
        if (reference is null) return null;
        try
        {
            using var stream = await reference.OpenReadAsync();
            if (stream is null || stream.Size == 0 || stream.Size > 8 * 1024 * 1024) return null;
            using var reader = new DataReader(stream.GetInputStreamAt(0));
            uint size = (uint)stream.Size;
            await reader.LoadAsync(size);
            var bytes = new byte[size];
            reader.ReadBytes(bytes);
            return bytes;
        }
        catch
        {
            return null;
        }
    }

    private static string FriendlyAppName(string? aumid)
    {
        if (string.IsNullOrWhiteSpace(aumid)) return "Media";
        var id = aumid.ToLowerInvariant();
        if (id.Contains("spotify")) return "Spotify";
        if (id.Contains("chrome")) return "Chrome";
        if (id.Contains("msedge") || id.Contains("microsoftedge")) return "Edge";
        if (id.Contains("firefox")) return "Firefox";
        if (id.Contains("brave")) return "Brave";
        if (id.Contains("opera")) return "Opera";
        if (id.Contains("vlc")) return "VLC";
        if (id.Contains("zunemusic")) return "Media Player";
        if (id.Contains("applemusic")) return "Apple Music";
        if (id.Contains("tidal")) return "Tidal";
        if (id.Contains("deezer")) return "Deezer";
        if (id.Contains("youtube")) return "YouTube";

        var name = aumid;
        int bang = name.IndexOf('!');
        if (bang > 0) name = name[..bang];
        name = name.Replace(".exe", string.Empty, StringComparison.OrdinalIgnoreCase);
        int slash = Math.Max(name.LastIndexOf('\\'), name.LastIndexOf('/'));
        if (slash >= 0 && slash < name.Length - 1) name = name[(slash + 1)..];
        int dot = name.LastIndexOf('.');
        if (dot >= 0 && dot < name.Length - 1) name = name[(dot + 1)..];
        int us = name.IndexOf('_');
        if (us > 0) name = name[..us];
        return name.Length > 18 ? name[..18] : name;
    }

    private static void SendMediaKey(byte vk)
    {
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, KeyEventKeyUp, UIntPtr.Zero);
    }

    /// <summary>Fallback: sniff media from visible window titles (Spotify, VLC, browser tabs).</summary>
    public MediaPlaybackState DetectNowPlaying()
    {
        MediaPlaybackState? detected = null;
        int bestPriority = -1;

        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            int len = GetWindowTextLength(hwnd);
            if (len <= 0 || len > 256) return true;

            var sb = new StringBuilder(len + 1);
            GetWindowText(hwnd, sb, sb.Capacity);
            string title = sb.ToString().Trim();
            if (string.IsNullOrEmpty(title)) return true;

            GetWindowThreadProcessId(hwnd, out uint pid);
            string procName;
            try
            {
                using var proc = Process.GetProcessById((int)pid);
                procName = proc.ProcessName.ToLowerInvariant();
            }
            catch
            {
                return true;
            }

            if (procName == "spotify")
            {
                if (title.Equals("Spotify", StringComparison.OrdinalIgnoreCase) ||
                    title.Equals("Spotify Free", StringComparison.OrdinalIgnoreCase) ||
                    title.Equals("Spotify Premium", StringComparison.OrdinalIgnoreCase))
                {
                    if (bestPriority < 1)
                    {
                        bestPriority = 1;
                        detected = new MediaPlaybackState(true, false, "Paused", "Spotify", "Spotify");
                    }
                }
                else
                {
                    var parts = title.Split(" - ", 2, StringSplitOptions.TrimEntries);
                    string artist = parts.Length == 2 ? parts[0] : "Spotify";
                    string track = parts.Length == 2 ? parts[1] : title;
                    bestPriority = 10;
                    detected = new MediaPlaybackState(true, true, track, artist, "Spotify");
                    return false;
                }
            }

            if (procName == "vlc" && title.EndsWith(" - VLC media player", StringComparison.OrdinalIgnoreCase))
            {
                var track = title[..^" - VLC media player".Length].Trim();
                if (bestPriority < 8)
                {
                    bestPriority = 8;
                    detected = new MediaPlaybackState(true, true, track, "VLC Media Player", "VLC");
                }
            }

            if (procName is "applemusic" or "tidal" or "musicbee" or "foobar2000")
            {
                if (bestPriority < 8 && !title.Equals(procName, StringComparison.OrdinalIgnoreCase))
                {
                    var parts = title.Split(" - ", 2, StringSplitOptions.TrimEntries);
                    bestPriority = 8;
                    detected = new MediaPlaybackState(
                        true,
                        true,
                        parts.Length == 2 ? parts[0] : title,
                        parts.Length == 2 ? parts[1] : procName,
                        procName);
                }
            }

            if (procName is "chrome" or "msedge" or "brave" or "firefox" or "opera")
            {
                if (bestPriority < 6 && TryParseBrowserMedia(title, out var mediaTitle, out var mediaSource))
                {
                    bestPriority = 6;
                    detected = new MediaPlaybackState(true, true, mediaTitle, mediaSource, procName.ToUpperInvariant());
                }
            }

            return true;
        }, IntPtr.Zero);

        return detected ?? new MediaPlaybackState(false, false, "Nothing playing", "Play Spotify, YouTube, or VLC", "Idle");
    }

    private static bool TryParseBrowserMedia(string windowTitle, out string title, out string source)
    {
        title = string.Empty;
        source = string.Empty;

        string[] suffixes =
        {
            " - YouTube Music",
            " - YouTube",
            " - SoundCloud",
            " - Twitch",
            " · Spotify"
        };

        foreach (var suffix in suffixes)
        {
            int idx = windowTitle.IndexOf(suffix, StringComparison.OrdinalIgnoreCase);
            if (idx > 0)
            {
                title = windowTitle[..idx].Trim();
                if (title.StartsWith('('))
                {
                    int close = title.IndexOf(')');
                    if (close > 0 && close < 6)
                    {
                        title = title[(close + 1)..].Trim();
                    }
                }
                source = suffix.Trim(' ', '-', '·');
                return !string.IsNullOrWhiteSpace(title);
            }
        }

        return false;
    }
}
