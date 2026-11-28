using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace WindowsNotchPro.Services;

public sealed record TimedLyricLine(TimeSpan At, string Text);

public sealed record MediaEnrichment(
    string TrackKey,
    string? ArtworkUrl,
    IReadOnlyList<string> LyricLines)
{
    /// <summary>Time-synced lyric lines (from LRC) when available; empty for plain lyrics.</summary>
    public IReadOnlyList<TimedLyricLine> TimedLines { get; init; } = Array.Empty<TimedLyricLine>();
    public bool IsSynced => TimedLines.Count > 0;

    /// <summary>Index of the synced line active at the given playback position (-1 before the first line).</summary>
    public int IndexAt(TimeSpan position)
    {
        int idx = -1;
        for (int i = 0; i < TimedLines.Count; i++)
        {
            if (TimedLines[i].At <= position) idx = i;
            else break;
        }
        return idx;
    }
}

/// <summary>
/// Fetches real album/track artwork thumbnails (iTunes Search API) and real lyrics (LRCLIB API)
/// with caching so the collapsed Dynamic Island pill can show [Thumbnail] [Live Lyrics] [Equalizer].
/// </summary>
public sealed class MediaMetadataLyricsService
{
    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(6)
    };

    private readonly Dictionary<string, MediaEnrichment> _cache = new(StringComparer.OrdinalIgnoreCase);
    private string _inFlightKey = string.Empty;

    static MediaMetadataLyricsService()
    {
        Http.DefaultRequestHeaders.UserAgent.ParseAdd("NOVA-WindowsNotchPro/3.0");
    }

    public bool TryGetCached(string title, string artist, out MediaEnrichment? enrichment)
    {
        var key = BuildKey(title, artist);
        return _cache.TryGetValue(key, out enrichment);
    }

    public async Task<MediaEnrichment?> FetchAsync(string title, string artist)
    {
        if (string.IsNullOrWhiteSpace(title) || title.Equals("Nothing playing", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var key = BuildKey(title, artist);
        if (_cache.TryGetValue(key, out var cached)) return cached;
        if (_inFlightKey.Equals(key, StringComparison.OrdinalIgnoreCase)) return null;

        _inFlightKey = key;
        try
        {
            var cleanTitle = CleanTrackTitle(title);
            var cleanArtist = IsGenericSource(artist) ? string.Empty : artist.Trim();
            var query = string.IsNullOrEmpty(cleanArtist) ? cleanTitle : $"{cleanTitle} {cleanArtist}";

            var artTask = FetchArtworkUrlAsync(query);
            var lyricsTask = FetchLyricsLinesAsync(query);
            await Task.WhenAll(artTask, lyricsTask);

            var (plainLines, timed) = lyricsTask.Result;
            var result = new MediaEnrichment(key, artTask.Result, plainLines) { TimedLines = timed };
            _cache[key] = result;
            return result;
        }
        catch
        {
            return null;
        }
        finally
        {
            if (_inFlightKey.Equals(key, StringComparison.OrdinalIgnoreCase))
            {
                _inFlightKey = string.Empty;
            }
        }
    }

    private static async Task<string?> FetchArtworkUrlAsync(string query)
    {
        try
        {
            var url = $"https://itunes.apple.com/search?term={Uri.EscapeDataString(query)}&media=music&entity=song&limit=1";
            var json = await Http.GetStringAsync(url);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("results", out var results) && results.GetArrayLength() > 0)
            {
                var first = results[0];
                if (first.TryGetProperty("artworkUrl100", out var art100) && !string.IsNullOrWhiteSpace(art100.GetString()))
                {
                    return art100.GetString()!.Replace("100x100bb", "600x600bb", StringComparison.Ordinal);
                }
                if (first.TryGetProperty("artworkUrl60", out var art60) && !string.IsNullOrWhiteSpace(art60.GetString()))
                {
                    return art60.GetString();
                }
            }
        }
        catch { }
        return null;
    }

    private static async Task<(IReadOnlyList<string> Lines, IReadOnlyList<TimedLyricLine> Timed)> FetchLyricsLinesAsync(string query)
    {
        try
        {
            var url = $"https://lrclib.net/api/search?q={Uri.EscapeDataString(query)}";
            var json = await Http.GetStringAsync(url);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind == JsonValueKind.Array && doc.RootElement.GetArrayLength() > 0)
            {
                foreach (var item in doc.RootElement.EnumerateArray().Take(3))
                {
                    string? synced = item.TryGetProperty("syncedLyrics", out var s) ? s.GetString() : null;
                    if (!string.IsNullOrWhiteSpace(synced))
                    {
                        var timed = ParseLrcLines(synced);
                        if (timed.Count > 0) return (timed.Select(t => t.Text).ToList(), timed);
                    }

                    string? plain = item.TryGetProperty("plainLyrics", out var p) ? p.GetString() : null;
                    if (!string.IsNullOrWhiteSpace(plain))
                    {
                        var lines = plain
                            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                            .Where(l => l.Length > 2 && !l.StartsWith('['))
                            .Take(40)
                            .ToList();
                        if (lines.Count > 0) return (lines, Array.Empty<TimedLyricLine>());
                    }
                }
            }
        }
        catch { }
        return (Array.Empty<string>(), Array.Empty<TimedLyricLine>());
    }

    private static List<TimedLyricLine> ParseLrcLines(string lrc)
    {
        var lines = new List<TimedLyricLine>();
        foreach (var raw in lrc.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var stamps = Regex.Matches(raw, @"\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]");
            var cleaned = Regex.Replace(raw, @"\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]", string.Empty).Trim();
            if (cleaned.Length <= 1) continue;
            foreach (Match m in stamps)
            {
                int min = int.Parse(m.Groups[1].Value);
                int sec = int.Parse(m.Groups[2].Value);
                int ms = 0;
                if (m.Groups[3].Success)
                {
                    var frac = m.Groups[3].Value;
                    ms = int.Parse(frac) * (frac.Length == 1 ? 100 : frac.Length == 2 ? 10 : 1);
                }
                lines.Add(new TimedLyricLine(new TimeSpan(0, 0, min, sec, ms), cleaned));
            }
        }
        lines.Sort((a, b) => a.At.CompareTo(b.At));
        return lines;
    }

    private static string CleanTrackTitle(string title)
    {
        var cleaned = Regex.Replace(title, @"\s*[\(\[]\s*(?:official\s*(?:music\s*)?video|official\s*audio|lyrics?|hd|4k|mv|visualizer)\s*[\)\]]", string.Empty, RegexOptions.IgnoreCase);
        return cleaned.Trim();
    }

    private static bool IsGenericSource(string artist) =>
        string.IsNullOrWhiteSpace(artist) ||
        artist.Equals("YouTube", StringComparison.OrdinalIgnoreCase) ||
        artist.Equals("YouTube Music", StringComparison.OrdinalIgnoreCase) ||
        artist.Equals("Spotify", StringComparison.OrdinalIgnoreCase) ||
        artist.Equals("VLC Media Player", StringComparison.OrdinalIgnoreCase) ||
        artist.Equals("Twitch", StringComparison.OrdinalIgnoreCase);

    private static string BuildKey(string title, string artist) => $"{title.Trim()}|{artist.Trim()}";
}
