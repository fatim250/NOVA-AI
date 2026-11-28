using System;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using WindowsNotchPro.Services;

namespace WindowsNotchPro;

public partial class MainWindow : Window
{
    private const double CollapsedWidth = 288;
    private const double CollapsedMediaWidth = 386;
    private const double CollapsedHeight = 44;
    private const double ExpandedWidth = 720;
    private const double ExpandedHeight = 382;
    private const int WmDpiChanged = 0x02E0;

    private readonly SettingsService _settings;
    private readonly SafeFileManager _fileManager;
    private readonly SafeAppManager _appManager;
    private readonly SecurityVault _securityVault;
    private readonly SystemTelemetryService _telemetry;
    private readonly SystemControlService _sysControl;
    private readonly AudioBrightnessService _audio;
    private readonly MediaSessionService _media;
    private readonly MediaMetadataLyricsService _mediaLyrics = new();
    private readonly AiBrainService _aiBrain;
    private readonly GeminiLiveVoiceService _liveVoice;
    private readonly CommandParser _commandParser;
    private readonly CompanionServer _companionServer;
    private readonly GlobalHotkeyService _hotkeyService = new();
    private readonly ClipboardHistoryService _clipboardService = new();
    private readonly FileShelfService _fileShelf = new();
    private readonly TrayIconService _trayIcon = new();

    private string _liveStatus = "disconnected";
    private string _liveUserBuffer = string.Empty;
    private string _liveAssistantBuffer = string.Empty;
    private bool _isExpanded;
    private bool _keepAwakeActive;
    private bool _suppressSliderEvents;
    private bool _initializingSettingsUi;
    private string _activeTab = "home";
    private int _auroraIndex;
    private CancellationTokenSource? _patrolCts;
    private MediaPlaybackState _lastMedia = new(false, false, "Nothing playing", "Spotify · YouTube · VLC", "Idle");

    [StructLayout(LayoutKind.Sequential)]
    private struct Win32Point
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Win32Point lpPoint);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    private readonly DispatcherTimer _clockTimer = new();
    private readonly DispatcherTimer _auroraTimer = new();
    private readonly DispatcherTimer _focusTimer = new();
    private readonly DispatcherTimer _telemetryTimer = new();
    private readonly DispatcherTimer _hoverWatchTimer = new();
    private readonly DispatcherTimer _equalizerTimer = new();
    private readonly DispatcherTimer _lyricCycleTimer = new();
    private readonly Random _eqRng = new();
    private MediaEnrichment? _currentMediaEnrichment;
    private string _currentArtworkUrl = string.Empty;
    private int _currentLyricIndex;
    private int _outsideTicks;
    private int _focusSecondsRemaining = 25 * 60;
    private bool _focusRunning;

    // Media: real session thumbnails, artwork-derived accent, live progress & synced lyrics
    private readonly DispatcherTimer _progressTimer = new();
    private bool _mediaPollBusy;
    private string _currentThumbKey = string.Empty;
    private (Color Primary, Color Secondary)? _artworkAccent;
    private int _syncedLyricIndex = int.MinValue;
    private double _artworkScaleTarget = 1.0;

    // AI: "thinking" state shown across chat, header orb and the collapsed pill
    private bool _aiThinking;
    private Border? _thinkingBubble;
    private readonly DispatcherTimer _thinkingTimer = new();
    private DateTime _thinkingStartedAt;
    private int _thinkingFrame;

    private static readonly (Color Primary, Color Secondary)[] AuroraThemes =
    {
        (Color.FromRgb(56, 189, 248), Color.FromRgb(139, 92, 246)),  // Aurora Cyan-Violet
        (Color.FromRgb(236, 72, 153), Color.FromRgb(168, 85, 247)),  // Rose-Magenta
        (Color.FromRgb(52, 211, 153), Color.FromRgb(20, 184, 166)),  // Emerald Pulse
        (Color.FromRgb(245, 158, 11), Color.FromRgb(249, 115, 22)),  // Solar Amber
    };

    public MainWindow()
    {
        InitializeComponent();

        _settings = new SettingsService();
        _fileManager = new SafeFileManager(AuditLogger.Instance);
        _appManager = new SafeAppManager(AuditLogger.Instance);
        _securityVault = new SecurityVault(AuditLogger.Instance);
        _telemetry = new SystemTelemetryService();
        _sysControl = new SystemControlService(AuditLogger.Instance);
        _audio = new AudioBrightnessService();
        _media = new MediaSessionService();
        _aiBrain = new AiBrainService(_settings);
        _liveVoice = new GeminiLiveVoiceService(_settings);
        _commandParser = new CommandParser(
            _fileManager,
            _appManager,
            _securityVault,
            AuditLogger.Instance,
            _audio,
            _media,
            _telemetry,
            _sysControl,
            _fileShelf,
            _aiBrain,
            _settings);
        _commandParser.WindowHandleProvider = () => Dispatcher.Invoke(() => new WindowInteropHelper(this).Handle);
        _commandParser.OnKeepAwakeChanged = enabled => Dispatcher.Invoke(() => SetKeepAwake(enabled));
        _commandParser.OnStartFocusTimer = mins => Dispatcher.Invoke(() => StartFocusTimer(mins));
        _liveVoice.ToolExecutor = (name, args) => Task.FromResult(_commandParser.ExecuteSystemTool(name, args));
        _companionServer = new CompanionServer(_commandParser, _securityVault, AuditLogger.Instance);

        _auroraIndex = Math.Clamp(_settings.Current.AuroraThemeIndex, 0, AuroraThemes.Length - 1);
        _focusSecondsRemaining = Math.Clamp(_settings.Current.FocusMinutes, 1, 180) * 60;
        UpdateFocusTimerDisplays();

        CommandInputBox.TextChanged += (_, _) =>
        {
            CommandPlaceholder.Visibility = string.IsNullOrEmpty(CommandInputBox.Text)
                ? Visibility.Visible
                : Visibility.Collapsed;
        };

        HomeQuickInputBox.TextChanged += (_, _) =>
        {
            HomeQuickPlaceholder.Visibility = string.IsNullOrEmpty(HomeQuickInputBox.Text)
                ? Visibility.Visible
                : Visibility.Collapsed;
        };

        _fileShelf.ShelfChanged += () => Dispatcher.Invoke(() =>
        {
            RenderFileShelf();
            UpdateHomeShelfSummary();
        });
        _clipboardService.HistoryChanged += () => Dispatcher.Invoke(() =>
        {
            RenderClipboardHistory();
            UpdateHomeShelfSummary();
        });

        WireTrayIcon();
        WireLiveVoice();
        ConfigureTimers();
        PopulateSettingsUi();
    }

    private void WireLiveVoice()
    {
        _liveVoice.StatusChanged += status => Dispatcher.Invoke(() =>
        {
            _liveStatus = status;
            var voice = _liveVoice.ActiveVoice;
            switch (status)
            {
                case "connecting":
                    VoiceStateSubtitle.Text = $"Connecting {voice}...";
                    SiriStatusLabel.Text = $"{voice.ToUpperInvariant()} · CONNECTING";
                    SiriLiveTranscriptText.Text = "Connecting live voice...";
                    SiriToggleButton.Content = "Connecting...";
                    StartSiriRingSpin();
                    break;
                case "live":
                    VoiceListenButton.Background = new SolidColorBrush(Color.FromArgb(72, 244, 63, 94));
                    VoiceListenButton.BorderBrush = new SolidColorBrush(Color.FromArgb(130, 244, 63, 94));
                    VoiceStateSubtitle.Text = $"Live · {voice}";
                    SiriStatusLabel.Text = $"{voice.ToUpperInvariant()} · LISTENING";
                    SiriLiveTranscriptText.Text = "Listening to your mic...";
                    SiriToggleButton.Content = "End Live Talk";
                    SiriToggleButton.Background = new SolidColorBrush(Color.FromArgb(55, 244, 63, 94));
                    SiriToggleButton.BorderBrush = new SolidColorBrush(Color.FromArgb(110, 244, 63, 94));
                    ApplyAuroraTheme(Color.FromRgb(52, 211, 153), Color.FromRgb(56, 189, 248));
                    break;
                case "speaking":
                    VoiceStateSubtitle.Text = $"Speaking · {voice}";
                    SiriStatusLabel.Text = $"{voice.ToUpperInvariant()} · SPEAKING";
                    SiriToggleButton.Content = "End Live Talk";
                    ApplyAuroraTheme(Color.FromRgb(56, 189, 248), Color.FromRgb(168, 85, 247));
                    break;
                default:
                    VoiceListenButton.Background = new SolidColorBrush(Color.FromArgb(36, 52, 211, 153));
                    VoiceListenButton.BorderBrush = new SolidColorBrush(Color.FromArgb(85, 52, 211, 153));
                    SiriStatusLabel.Text = $"{voice.ToUpperInvariant()} · TAP TO TALK";
                    SiriLiveTranscriptText.Text = "Live Voice Ready";
                    SiriToggleButton.Content = "Start Live Talk";
                    SiriToggleButton.Background = new SolidColorBrush(Color.FromArgb(51, 56, 189, 248));
                    SiriToggleButton.BorderBrush = new SolidColorBrush(Color.FromArgb(102, 56, 189, 248));
                    SiriRingRotate.BeginAnimation(RotateTransform.AngleProperty, null);
                    UpdateHeaderBadges();
                    break;
            }
            UpdateCollapsedPillTicker();
        });

        _liveVoice.AudioLevelChanged += level => Dispatcher.Invoke(() =>
        {
            if (!_liveVoice.IsActive) return;
            double core = 1.0 + level * 0.28;
            double ring = 1.0 + level * 0.36;
            double halo = 1.0 + level * 0.48;
            var dur = TimeSpan.FromMilliseconds(95);
            SiriCoreScale.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(core, dur));
            SiriCoreScale.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(core, dur));
            SiriRingScale.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(ring, dur));
            SiriRingScale.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(ring, dur));
            SiriHaloScale.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(halo, dur));
            SiriHaloScale.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(halo, dur));
        });

        _liveVoice.InputTranscriptDelta += delta => Dispatcher.Invoke(() =>
        {
            _liveUserBuffer += delta;
            var txt = $"You: {_liveUserBuffer.Trim()}";
            HomeLastReplyText.Text = txt;
            SiriLiveTranscriptText.Text = txt;
        });

        _liveVoice.OutputTranscriptDelta += delta => Dispatcher.Invoke(() =>
        {
            _liveAssistantBuffer += delta;
            var txt = _liveAssistantBuffer.Trim();
            HomeLastReplyText.Text = txt;
            SiriLiveTranscriptText.Text = txt;
        });

        _liveVoice.TurnCompleted += () => Dispatcher.Invoke(() =>
        {
            var u = string.IsNullOrWhiteSpace(_liveUserBuffer) ? "(Voice)" : _liveUserBuffer.Trim();
            var a = _liveAssistantBuffer.Trim();
            if (!string.IsNullOrEmpty(a))
            {
                _aiBrain.AppendExternalTurn(u, a);
                RenderChatHistory();
            }
            _liveUserBuffer = string.Empty;
            _liveAssistantBuffer = string.Empty;
        });

        _liveVoice.ErrorOccurred += err => Dispatcher.Invoke(() =>
        {
            HomeLastReplyText.Text = err;
            SiriLiveTranscriptText.Text = err;
            _aiBrain.AppendExternalTurn("Live Voice", err);
            RenderChatHistory();
        });
    }

    private void StartSiriRingSpin()
    {
        var spin = new DoubleAnimation(0, 360, TimeSpan.FromSeconds(4.2))
        {
            RepeatBehavior = RepeatBehavior.Forever
        };
        SiriRingRotate.BeginAnimation(RotateTransform.AngleProperty, spin);
    }

    private void WireTrayIcon()
    {
        _trayIcon.ToggleNotchRequested += () => Dispatcher.Invoke(() => SetExpanded(!_isExpanded));
        _trayIcon.OpenTabRequested += tab => Dispatcher.Invoke(() =>
        {
            SwitchTab(tab);
            SetExpanded(true);
        });
        _trayIcon.ToggleKeepAwakeRequested += () => Dispatcher.Invoke(() => SetKeepAwake(!_keepAwakeActive));
        _trayIcon.LockPcRequested += () => Dispatcher.Invoke(() => LockPc_Click(this, new RoutedEventArgs()));
        _trayIcon.ExitRequested += () => Dispatcher.Invoke(Close);
    }

    private void Window_Loaded(object sender, RoutedEventArgs e)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        // Note: Do NOT call DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE) on a transparent WPF window,
        // otherwise Windows 11 DWM draws an unwanted faint rectangular border around the outer HWND bounds.

        var source = HwndSource.FromHwnd(hwnd);
        source?.AddHook(WndProc);

        _hotkeyService.Attach(hwnd, _settings.Current.HotkeyCombo);
        _hotkeyService.HotkeyPressed += () => Dispatcher.Invoke(() => SetExpanded(!_isExpanded));

        _clipboardService.Attach(hwnd);

        AnchorTopCenter(CollapsedWidth);
        ApplyAuroraTheme(AuroraThemes[_auroraIndex].Primary, AuroraThemes[_auroraIndex].Secondary);
        SyncAudioAndBrightnessUi();
        RefreshRunningAppsUi();
        RenderFileShelf();
        RenderClipboardHistory();
        UpdateHomeShelfSummary();
        UpdateHeaderBadges();

        _companionServer.OnCommandExecuted += reply =>
        {
            Dispatcher.Invoke(() =>
            {
                HomeLastReplyText.Text = reply;
                RenderChatHistory();
            });
        };
        _companionServer.Start();

        AuditLogger.Instance.Log(
            "system",
            "notch_started",
            "allowed",
            $"NOVA v3 Bento active · Hotkey {_hotkeyService.ActiveCombo} · Companion {_companionServer.ListenUrl}");
    }

    private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        StopKeepAwakePatrol();
        _liveVoice.Dispose();
        _hotkeyService.Dispose();
        _clipboardService.Dispose();
        _trayIcon.Dispose();
        _companionServer.Dispose();
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WmDpiChanged)
        {
            Dispatcher.BeginInvoke(() => AnchorTopCenter(_isExpanded ? ExpandedWidth : CollapsedWidth));
        }
        return IntPtr.Zero;
    }

    private Rect GetTargetMonitorWorkArea()
    {
        var screens = System.Windows.Forms.Screen.AllScreens;
        if (screens.Length == 0) return SystemParameters.WorkArea;

        int idx = Math.Clamp(_settings.Current.MonitorIndex, 0, screens.Length - 1);
        var wa = screens[idx].WorkingArea;

        var source = PresentationSource.FromVisual(this);
        double scaleX = source?.CompositionTarget?.TransformFromDevice.M11 ?? 1.0;
        double scaleY = source?.CompositionTarget?.TransformFromDevice.M22 ?? 1.0;

        return new Rect(wa.Left * scaleX, wa.Top * scaleY, wa.Width * scaleX, wa.Height * scaleY);
    }

    private void AnchorTopCenter(double targetWidth)
    {
        var area = GetTargetMonitorWorkArea();
        Left = area.Left + (area.Width - targetWidth) / 2.0;
        Top = area.Top + 4;
    }

    private void ConfigureTimers()
    {
        _clockTimer.Interval = TimeSpan.FromSeconds(1);
        _clockTimer.Tick += (_, _) => CollapsedClockText.Text = DateTime.Now.ToString("HH:mm");
        _clockTimer.Start();
        CollapsedClockText.Text = DateTime.Now.ToString("HH:mm");

        _auroraTimer.Interval = TimeSpan.FromSeconds(5.0);
        _auroraTimer.Tick += (_, _) =>
        {
            if (!_settings.Current.AutoAurora) return;
            // While a track with artwork plays, the notch keeps the artwork's colours instead of cycling.
            if (_artworkAccent is not null && _lastMedia.HasMedia && _lastMedia.IsPlaying) return;
            if (_liveStatus is "live" or "speaking" || _aiThinking) return;
            _auroraIndex = (_auroraIndex + 1) % AuroraThemes.Length;
            ApplyAuroraTheme(AuroraThemes[_auroraIndex].Primary, AuroraThemes[_auroraIndex].Secondary);
        };
        _auroraTimer.Start();

        _focusTimer.Interval = TimeSpan.FromSeconds(1);
        _focusTimer.Tick += (_, _) =>
        {
            if (!_focusRunning) return;
            if (_focusSecondsRemaining > 0)
            {
                _focusSecondsRemaining--;
                UpdateFocusTimerDisplays();
                UpdateCollapsedPillTicker();
            }
            else
            {
                _focusRunning = false;
                UpdateFocusToggleLabels();
                UpdateCollapsedPillTicker();
                _trayIcon.ShowBalloon("NOVA Focus", "Focus session complete!");
            }
        };
        _focusTimer.Start();

        _telemetryTimer.Interval = TimeSpan.FromSeconds(1.5);
        _telemetryTimer.Tick += (_, _) => RefreshLiveTelemetryAndMedia();
        _telemetryTimer.Start();

        // Rock-solid Win32 cursor-bounds hover tracker (prevents stuck height or accidental self-hide)
        _hoverWatchTimer.Interval = TimeSpan.FromMilliseconds(140);
        _hoverWatchTimer.Tick += (_, _) =>
        {
            if (!_isExpanded)
            {
                _outsideTicks = 0;
                return;
            }
            if (!CanAutoCollapse())
            {
                _outsideTicks = 0;
                return;
            }
            if (IsCursorInsideNotchBounds())
            {
                _outsideTicks = 0;
            }
            else
            {
                _outsideTicks++;
                if (_outsideTicks >= 2)
                {
                    _outsideTicks = 0;
                    SetExpanded(false);
                }
            }
        };
        _hoverWatchTimer.Start();

        // Fluid 4-bar equalizer animation for active media or Gemini Live voice
        _equalizerTimer.Interval = TimeSpan.FromMilliseconds(150);
        _equalizerTimer.Tick += (_, _) =>
        {
            bool active = _liveStatus is "live" or "speaking" || (_lastMedia.HasMedia && _lastMedia.IsPlaying);
            PillEqualizer.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
            if (!active || _isExpanded) return;

            var dur = TimeSpan.FromMilliseconds(130);
            EqBar1.BeginAnimation(HeightProperty, new DoubleAnimation(_eqRng.Next(4, 14), dur));
            EqBar2.BeginAnimation(HeightProperty, new DoubleAnimation(_eqRng.Next(5, 14), dur));
            EqBar3.BeginAnimation(HeightProperty, new DoubleAnimation(_eqRng.Next(4, 13), dur));
            EqBar4.BeginAnimation(HeightProperty, new DoubleAnimation(_eqRng.Next(5, 14), dur));
        };
        _equalizerTimer.Start();

        // Smoothly cycle lyrics lines in the collapsed pill & Media tab while playing
        _lyricCycleTimer.Interval = TimeSpan.FromSeconds(3.6);
        _lyricCycleTimer.Tick += (_, _) =>
        {
            var enr = _currentMediaEnrichment;
            // Synced lyrics are driven by the progress timer; this only rotates plain (unsynced) lyrics.
            if (!_lastMedia.HasMedia || !_lastMedia.IsPlaying || enr is null || enr.LyricLines.Count == 0)
            {
                return;
            }
            if (enr.IsSynced && _lastMedia.HasTimeline) return;
            _currentLyricIndex = (_currentLyricIndex + 1) % enr.LyricLines.Count;
            UpdateCollapsedPillTicker();
            SetLyricText(MediaLyricPreviewText, $"♪ {enr.LyricLines[_currentLyricIndex]}");
            MediaLyricNextText.Text = enr.LyricLines.Count > 1 ? enr.LyricLines[(_currentLyricIndex + 1) % enr.LyricLines.Count] : string.Empty;
        };
        _lyricCycleTimer.Start();

        // Smooth 5 fps progress interpolation between media polls
        _progressTimer.Interval = TimeSpan.FromMilliseconds(200);
        _progressTimer.Tick += (_, _) =>
        {
            if (_lastMedia.HasMedia && _lastMedia.HasTimeline) UpdateMediaProgress();
        };
        _progressTimer.Start();

        // Animated "thinking" dots + elapsed seconds while the AI works
        _thinkingTimer.Interval = TimeSpan.FromMilliseconds(380);
        _thinkingTimer.Tick += (_, _) => TickThinkingIndicator();
    }

    private void UpdateFocusTimerDisplays()
    {
        string formatted = TimeSpan.FromSeconds(_focusSecondsRemaining).ToString(@"mm\:ss");
        FocusTimerText.Text = formatted;
        HomeFocusTimerText.Text = formatted;
    }

    private void UpdateFocusToggleLabels()
    {
        string label = _focusRunning ? "Pause" : "Start";
        FocusTimerToggleBtn.Content = label;
        HomeFocusToggleBtn.Content = label;
    }

    private void UpdateHomeShelfSummary()
    {
        HomeShelfSummaryText.Text = $"{_fileShelf.Count} {(_fileShelf.Count == 1 ? "file" : "files")} held · {_clipboardService.Entries.Count} clips";
    }

    private void RefreshLiveTelemetryAndMedia()
    {
        var snap = _telemetry.Capture();
        PillCpuText.Text = $"{snap.CpuPercent:F0}%";

        // Home Bento Vitals
        HomeCpuText.Text = $"{snap.CpuPercent:F0}%";
        HomeCpuBar.Width = Math.Clamp(snap.CpuPercent / 100.0 * 140.0, 4, 140);
        HomeRamText.Text = $"{snap.RamPercent:F0}%";
        HomeRamBar.Width = Math.Clamp(snap.RamPercent / 100.0 * 140.0, 4, 140);
        HomeBatteryText.Text = snap.HasBattery
            ? $"{snap.BatteryPercent}%{(snap.IsCharging ? " ⚡" : "")}"
            : "AC";

        // Full System View
        if (_isExpanded && _activeTab == "system")
        {
            SysCpuText.Text = $"{snap.CpuPercent:F0}%";
            SysRamPctText.Text = $"{snap.RamPercent:F0}%";
            SysRamDetailText.Text = $"{snap.RamUsedGb:F1} / {snap.RamTotalGb:F1} GB";
            SysRamBar.Width = Math.Clamp(snap.RamPercent / 100.0 * 180.0, 6, 180);
            SysBatteryText.Text = snap.HasBattery
                ? $"{snap.BatteryPercent}%{(snap.IsCharging ? " ⚡" : "")}"
                : "AC Power";
            SysNetText.Text = snap.IsNetworkConnected
                ? $"↓ {snap.NetDownMbps:F1} · ↑ {snap.NetUpMbps:F1} Mbps"
                : "Offline";
            SysUptimeText.Text = $"Up {(int)snap.Uptime.TotalHours}h {snap.Uptime.Minutes}m";

            var pts = new PointCollection();
            double w = CpuSparklineCanvas.ActualWidth > 10 ? CpuSparklineCanvas.ActualWidth : 180;
            double h = CpuSparklineCanvas.ActualHeight > 10 ? CpuSparklineCanvas.ActualHeight : 28;
            int count = snap.CpuHistory.Count;
            if (count > 1)
            {
                for (int i = 0; i < count; i++)
                {
                    double x = i * (w / (count - 1));
                    double y = h - (Math.Clamp(snap.CpuHistory[i], 0, 100) / 100.0 * (h - 4)) - 2;
                    pts.Add(new Point(x, y));
                }
            }
            CpuSparkline.Points = pts;
        }

        _ = RefreshMediaAsync();
    }

    private static readonly Geometry PlayGlyph = Geometry.Parse("M7,5 L19,12 L7,19 Z");
    private static readonly Geometry PauseGlyph = Geometry.Parse("M6,5 H10 V19 H6 Z M14,5 H18 V19 H14 Z");

    private async Task RefreshMediaAsync()
    {
        if (_mediaPollBusy) return;
        _mediaPollBusy = true;
        try
        {
            var prevKey = _lastMedia.TrackKey;
            // SMTC + window enumeration are cross-process calls; keep them off the UI thread so
            // the notch never hitches while a browser or player is busy.
            var now = await Task.Run(() => _media.DetectNowPlayingAsync());
            _lastMedia = now;
            bool trackChanged = !string.Equals(prevKey, now.TrackKey, StringComparison.OrdinalIgnoreCase);

            if (now.HasMedia)
            {
                if (trackChanged)
                {
                    _currentLyricIndex = 0;
                    _syncedLyricIndex = int.MinValue;
                    _currentMediaEnrichment = null;
                    MediaLyricPreviewText.Text = string.Empty;
                    MediaLyricNextText.Text = string.Empty;
                    var fetchTitle = now.Title;
                    var fetchArtist = now.Artist;
                    _ = Task.Run(async () =>
                    {
                        var enriched = await _mediaLyrics.FetchAsync(fetchTitle, fetchArtist);
                        if (enriched is not null)
                        {
                            Dispatcher.Invoke(() =>
                            {
                                if (string.Equals(_lastMedia.Title, fetchTitle, StringComparison.OrdinalIgnoreCase))
                                {
                                    ApplyMediaEnrichment(enriched);
                                }
                            });
                        }
                    });
                }
                else if (_currentMediaEnrichment is null && _mediaLyrics.TryGetCached(now.Title, now.Artist, out var cached) && cached is not null)
                {
                    ApplyMediaEnrichment(cached);
                }

                // The real thumbnail published by the playing app wins over looked-up artwork.
                var smtcKey = $"{now.TrackKey}#smtc{now.ThumbnailVersion}";
                if (now.Thumbnail is { Length: > 0 } && !string.Equals(_currentThumbKey, smtcKey, StringComparison.Ordinal))
                {
                    var bmp = DecodeImage(now.Thumbnail);
                    if (bmp is not null)
                    {
                        _currentThumbKey = smtcKey;
                        _currentArtworkUrl = string.Empty;
                        ApplyArtwork(bmp);
                    }
                }
                else if (trackChanged && now.Thumbnail is null)
                {
                    ClearArtwork();
                }
            }
            else
            {
                _currentMediaEnrichment = null;
                if (trackChanged) ClearArtwork();
                MediaLyricPreviewText.Text = string.Empty;
                MediaLyricNextText.Text = string.Empty;
            }

            UpdateMediaTexts();
            UpdateMediaProgress();
            UpdateCollapsedPillTicker();
            UpdateCollapsedPillWidth();
        }
        catch
        {
            // Media polling must never take the notch down.
        }
        finally
        {
            _mediaPollBusy = false;
        }
    }

    private void UpdateMediaTexts()
    {
        var m = _lastMedia;
        string source = m.SourceApp.ToUpperInvariant();
        HomeMediaSourceText.Text = m.HasMedia ? (m.IsPlaying ? $"● {source}" : $"PAUSED · {source}") : "IDLE";
        HomeMediaTitleText.Text = m.Title;
        HomeMediaArtistText.Text = m.Artist;

        var glyph = m.HasMedia && m.IsPlaying ? PauseGlyph : PlayGlyph;
        HomePlayPauseIcon.Data = glyph;
        MediaPlayPauseIcon.Data = glyph;

        MediaSourceBadge.Text = m.HasMedia ? source : "IDLE";
        MediaStatusLabel.Text = !m.HasMedia ? "  Waiting for audio..." : m.IsPlaying ? "  Now Playing" : "  Paused";
        MediaTitleText.Text = m.Title;
        MediaArtistText.Text = m.Artist;
        MediaAlbumText.Text = m.Album;
        MediaAlbumText.Visibility = string.IsNullOrWhiteSpace(m.Album) ? Visibility.Collapsed : Visibility.Visible;

        // The big artwork "breathes" down slightly while paused
        double target = m.HasMedia && m.IsPlaying ? 1.0 : 0.94;
        if (Math.Abs(_artworkScaleTarget - target) > 0.001)
        {
            _artworkScaleTarget = target;
            var anim = new DoubleAnimation(target, TimeSpan.FromMilliseconds(320)) { EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.3 } };
            MediaArtworkScale.BeginAnimation(ScaleTransform.ScaleXProperty, anim);
            MediaArtworkScale.BeginAnimation(ScaleTransform.ScaleYProperty, anim);
        }
    }

    private static string FormatTime(TimeSpan t) =>
        t.TotalHours >= 1 ? t.ToString(@"h\:mm\:ss") : $"{(int)t.TotalMinutes}:{t.Seconds:00}";

    /// <summary>Runs on a fast timer: smooth progress bars and time-synced lyrics.</summary>
    private void UpdateMediaProgress()
    {
        var m = _lastMedia;
        bool show = m.HasMedia && m.HasTimeline;
        double frac = show ? Math.Clamp(m.LivePosition.TotalMilliseconds / m.Duration.TotalMilliseconds, 0, 1) : 0;
        string elapsed = show ? FormatTime(m.LivePosition) : "0:00";

        HomeMediaElapsedText.Text = elapsed;
        HomeMediaDurationText.Text = show ? FormatTime(m.Duration) : "0:00";
        HomeProgressFill.Width = HomeProgressTrack.ActualWidth * frac;
        MediaElapsedText.Text = elapsed;
        MediaDurationText.Text = show ? $"-{FormatTime(m.Duration - m.LivePosition)}" : "0:00";
        MediaProgressFill.Width = MediaProgressTrack.ActualWidth * frac;

        PillProgressTrack.Visibility = !_isExpanded && show && m.IsPlaying ? Visibility.Visible : Visibility.Collapsed;
        PillProgressFill.Width = PillProgressTrack.ActualWidth * frac;

        // Time-synced lyrics (LRC) follow the real playback position
        if (_currentMediaEnrichment is { IsSynced: true } enr && show)
        {
            int idx = enr.IndexAt(m.LivePosition + TimeSpan.FromMilliseconds(250));
            if (idx != _syncedLyricIndex)
            {
                _syncedLyricIndex = idx;
                var next = idx + 1 < enr.TimedLines.Count ? enr.TimedLines[idx + 1].Text : string.Empty;
                SetLyricText(MediaLyricPreviewText, idx >= 0 ? $"♪ {enr.TimedLines[idx].Text}" : "♪ ...");
                MediaLyricNextText.Text = next;
                UpdateCollapsedPillTicker();
            }
        }
    }

    private static void SetLyricText(TextBlock target, string text)
    {
        if (target.Text == text) return;
        target.Text = text;
        target.BeginAnimation(OpacityProperty, new DoubleAnimation(0.25, 1, TimeSpan.FromMilliseconds(260)));
    }

    private string? CurrentLyricLine()
    {
        var enr = _currentMediaEnrichment;
        if (enr is null) return null;
        if (enr.IsSynced && _lastMedia.HasTimeline)
        {
            return _syncedLyricIndex >= 0 && _syncedLyricIndex < enr.TimedLines.Count
                ? enr.TimedLines[_syncedLyricIndex].Text
                : null;
        }
        if (enr.LyricLines.Count == 0) return null;
        return enr.LyricLines[_currentLyricIndex % enr.LyricLines.Count];
    }

    private static BitmapSource? DecodeImage(byte[] bytes)
    {
        try
        {
            using var ms = new System.IO.MemoryStream(bytes);
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.DecodePixelWidth = 320;
            bmp.StreamSource = ms;
            bmp.EndInit();
            bmp.Freeze();
            return bmp;
        }
        catch
        {
            return null;
        }
    }

    private void ApplyArtwork(BitmapSource bmp)
    {
        PillArtworkBrush.ImageSource = bmp;
        HomeArtworkBrush.ImageSource = bmp;
        MediaArtworkBrush.ImageSource = bmp;
        MediaBackdropBrush.ImageSource = bmp;

        PillArtworkBorder.Visibility = Visibility.Visible;
        PillOrbHost.Visibility = Visibility.Collapsed;
        HomeArtworkImageHost.Visibility = Visibility.Visible;
        HomeArtworkGlyph.Visibility = Visibility.Collapsed;
        MediaArtworkImageHost.Visibility = Visibility.Visible;
        MediaArtworkGlyph.Visibility = Visibility.Collapsed;

        var fade = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(420)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
        HomeArtworkImageHost.BeginAnimation(OpacityProperty, fade);
        MediaArtworkImageHost.BeginAnimation(OpacityProperty, fade);
        MediaBackdrop.BeginAnimation(OpacityProperty, new DoubleAnimation(0.55, TimeSpan.FromMilliseconds(600)));

        // Theme the whole notch from the artwork's dominant colour
        var (primary, secondary) = ExtractAccentColors(bmp);
        _artworkAccent = (primary, secondary);
        ApplyAccentToMediaChrome(primary, secondary);
        ApplyAuroraTheme(primary, secondary);
    }

    private void ClearArtwork()
    {
        _currentThumbKey = string.Empty;
        _currentArtworkUrl = string.Empty;
        _artworkAccent = null;
        PillArtworkBorder.Visibility = Visibility.Collapsed;
        PillOrbHost.Visibility = Visibility.Visible;
        HomeArtworkImageHost.Visibility = Visibility.Collapsed;
        HomeArtworkGlyph.Visibility = Visibility.Visible;
        MediaArtworkImageHost.Visibility = Visibility.Collapsed;
        MediaArtworkGlyph.Visibility = Visibility.Visible;
        MediaBackdrop.BeginAnimation(OpacityProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(400)));
        ApplyAccentToMediaChrome(Color.FromRgb(56, 189, 248), Color.FromRgb(168, 85, 247));
    }

    private void ApplyAccentToMediaChrome(Color primary, Color secondary)
    {
        var dur = TimeSpan.FromMilliseconds(900);
        foreach (var stop in new[] { HomeProgressStopA, MediaProgressStopA, PillProgressStopA })
            stop.BeginAnimation(GradientStop.ColorProperty, new ColorAnimation(primary, dur));
        foreach (var stop in new[] { HomeProgressStopB, MediaProgressStopB, PillProgressStopB })
            stop.BeginAnimation(GradientStop.ColorProperty, new ColorAnimation(secondary, dur));
        MediaProgressGlow.BeginAnimation(System.Windows.Media.Effects.DropShadowEffect.ColorProperty, new ColorAnimation(primary, dur));
        PillArtworkGlow.BeginAnimation(System.Windows.Media.Effects.DropShadowEffect.ColorProperty, new ColorAnimation(primary, dur));
    }

    /// <summary>Averages a downscaled copy of the artwork, weighting vivid pixels, for a pleasant accent pair.</summary>
    private static (Color Primary, Color Secondary) ExtractAccentColors(BitmapSource source)
    {
        try
        {
            var scaled = new TransformedBitmap(source, new ScaleTransform(24.0 / source.PixelWidth, 24.0 / source.PixelHeight));
            var bgra = new FormatConvertedBitmap(scaled, PixelFormats.Bgra32, null, 0);
            int w = bgra.PixelWidth, h = bgra.PixelHeight, stride = w * 4;
            var px = new byte[h * stride];
            bgra.CopyPixels(px, stride, 0);

            double r = 0, g = 0, b = 0, total = 0;
            for (int i = 0; i + 2 < px.Length; i += 4)
            {
                double pb = px[i], pg = px[i + 1], pr = px[i + 2];
                double max = Math.Max(pr, Math.Max(pg, pb)), min = Math.Min(pr, Math.Min(pg, pb));
                double sat = max <= 0 ? 0 : (max - min) / max;
                double lum = max / 255.0;
                double weight = 0.05 + sat * sat * 3 * (lum > 0.15 && lum < 0.97 ? 1 : 0.15);
                r += pr * weight; g += pg * weight; b += pb * weight; total += weight;
            }
            if (total <= 0) throw new InvalidOperationException();
            var baseColor = Color.FromRgb((byte)(r / total), (byte)(g / total), (byte)(b / total));
            return (Vivid(baseColor, 0.62, 0.72), Vivid(RotateHue(baseColor, 38), 0.55, 0.62));
        }
        catch
        {
            return (Color.FromRgb(56, 189, 248), Color.FromRgb(168, 85, 247));
        }
    }

    private static void ToHsv(Color c, out double hue, out double sat, out double val)
    {
        double r = c.R / 255.0, g = c.G / 255.0, b = c.B / 255.0;
        double max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b)), d = max - min;
        hue = d == 0 ? 0 : max == r ? 60 * (((g - b) / d) % 6) : max == g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
        if (hue < 0) hue += 360;
        sat = max == 0 ? 0 : d / max;
        val = max;
    }

    private static Color FromHsv(double hue, double sat, double val)
    {
        double c = val * sat, x = c * (1 - Math.Abs(hue / 60 % 2 - 1)), m = val - c;
        (double r, double g, double b) = hue switch
        {
            < 60 => (c, x, 0d),
            < 120 => (x, c, 0d),
            < 180 => (0d, c, x),
            < 240 => (0d, x, c),
            < 300 => (x, 0d, c),
            _ => (c, 0d, x)
        };
        return Color.FromRgb((byte)Math.Clamp((r + m) * 255, 0, 255), (byte)Math.Clamp((g + m) * 255, 0, 255), (byte)Math.Clamp((b + m) * 255, 0, 255));
    }

    private static Color Vivid(Color c, double minSat, double minVal)
    {
        ToHsv(c, out var h, out var s, out var v);
        return FromHsv(h, Math.Max(s, minSat), Math.Min(1, Math.Max(v, minVal)));
    }

    private static Color RotateHue(Color c, double degrees)
    {
        ToHsv(c, out var h, out var s, out var v);
        return FromHsv((h + degrees) % 360, s, v);
    }

    private void ApplyMediaEnrichment(MediaEnrichment enriched)
    {
        _currentMediaEnrichment = enriched;
        _syncedLyricIndex = int.MinValue;

        // Looked-up artwork (iTunes) is only used when the app published no thumbnail of its own.
        bool hasSessionThumb = _currentThumbKey.Contains("#smtc", StringComparison.Ordinal);
        if (!hasSessionThumb && !string.IsNullOrWhiteSpace(enriched.ArtworkUrl) && !string.Equals(_currentArtworkUrl, enriched.ArtworkUrl, StringComparison.Ordinal))
        {
            try
            {
                var url = enriched.ArtworkUrl;
                _currentArtworkUrl = url;
                _currentThumbKey = _lastMedia.TrackKey + "#itunes";
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.UriSource = new Uri(url);
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.DecodePixelWidth = 320;
                bmp.EndInit();
                if (bmp.IsDownloading)
                {
                    bmp.DownloadCompleted += (_, _) =>
                    {
                        if (string.Equals(_currentArtworkUrl, url, StringComparison.Ordinal)) ApplyArtwork(bmp);
                    };
                }
                else
                {
                    ApplyArtwork(bmp);
                }
            }
            catch { }
        }

        if (!enriched.IsSynced)
        {
            if (enriched.LyricLines.Count > 0)
            {
                var line = enriched.LyricLines[_currentLyricIndex % enriched.LyricLines.Count];
                SetLyricText(MediaLyricPreviewText, $"♪ {line}");
                MediaLyricNextText.Text = enriched.LyricLines.Count > 1
                    ? enriched.LyricLines[(_currentLyricIndex + 1) % enriched.LyricLines.Count]
                    : string.Empty;
            }
            else
            {
                MediaLyricPreviewText.Text = string.Empty;
                MediaLyricNextText.Text = string.Empty;
            }
        }
        UpdateMediaProgress();
        UpdateCollapsedPillTicker();
    }

    private void UpdateCollapsedPillWidth()
    {
        if (_isExpanded) return;
        double desiredW = (_lastMedia.HasMedia && _lastMedia.IsPlaying) ? CollapsedMediaWidth : CollapsedWidth;
        if (Math.Abs(Width - desiredW) < 2) return;

        var area = GetTargetMonitorWorkArea();
        var targetLeft = area.Left + (area.Width - desiredW) / 2.0;
        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        var dur = TimeSpan.FromMilliseconds(240);
        double startW = ActualWidth > 0 ? ActualWidth : Width;
        double startL = Left;
        Width = desiredW;
        Height = CollapsedHeight;
        Left = targetLeft;
        BeginAnimation(WidthProperty, new DoubleAnimation(startW, desiredW, dur) { EasingFunction = ease, FillBehavior = FillBehavior.Stop });
        BeginAnimation(LeftProperty, new DoubleAnimation(startL, targetLeft, dur) { EasingFunction = ease, FillBehavior = FillBehavior.Stop });
    }

    private void UpdateCollapsedPillTicker()
    {
        if (_liveStatus == "speaking")
        {
            CollapsedStatusText.Text = $"♪ {_liveVoice.ActiveVoice} speaking...";
        }
        else if (_liveStatus == "live")
        {
            CollapsedStatusText.Text = $"● Live · {_liveVoice.ActiveVoice}";
        }
        else if (_liveStatus == "connecting")
        {
            CollapsedStatusText.Text = "Connecting Live...";
        }
        else if (_aiThinking)
        {
            var dots = new string('.', _thinkingFrame % 3 + 1);
            CollapsedStatusText.Text = $"{_commandParser.AssistantName} is thinking{dots}";
        }
        else if (_focusRunning)
        {
            CollapsedStatusText.Text = $"Focus · {TimeSpan.FromSeconds(_focusSecondsRemaining):mm\\:ss}";
        }
        else if (_lastMedia.HasMedia && _lastMedia.IsPlaying)
        {
            var line = CurrentLyricLine();
            CollapsedStatusText.Text = !string.IsNullOrWhiteSpace(line)
                ? line
                : $"♪ {_lastMedia.Title} · {_lastMedia.Artist}";
        }
        else
        {
            CollapsedStatusText.Text = _keepAwakeActive
                ? $"{_commandParser.AssistantName} · Awake"
                : _commandParser.AssistantName;
        }
    }

    private void UpdateHeaderBadges()
    {
        AssistantNameText.Text = _commandParser.AssistantName;
        VoiceStateSubtitle.Text = _aiBrain.ProviderBadge;
        UpdateCollapsedPillTicker();
    }

    private void ApplyAuroraTheme(Color primary, Color secondary)
    {
        var duration = TimeSpan.FromMilliseconds(1200);
        AuroraStopPrimary.BeginAnimation(GradientStop.ColorProperty, new ColorAnimation(primary, duration));
        AuroraStopSecondary.BeginAnimation(GradientStop.ColorProperty, new ColorAnimation(secondary, duration));
        CollapsedOrbCore.BeginAnimation(GradientStop.ColorProperty, new ColorAnimation(primary, duration));
        ExpandedOrbCore.BeginAnimation(GradientStop.ColorProperty, new ColorAnimation(primary, duration));
    }

    private bool IsCursorInsideNotchBounds()
    {
        if (!GetCursorPos(out var pt)) return true;
        var source = PresentationSource.FromVisual(this);
        double scaleX = source?.CompositionTarget?.TransformFromDevice.M11 ?? 1.0;
        double scaleY = source?.CompositionTarget?.TransformFromDevice.M22 ?? 1.0;
        double dipX = pt.X * scaleX;
        double dipY = pt.Y * scaleY;
        return dipX >= Left - 14 && dipX <= Left + ActualWidth + 14 &&
               dipY >= Top - 8 && dipY <= Top + ActualHeight + 16;
    }

    private void SetExpanded(bool expand)
    {
        _outsideTicks = 0;
        if (_isExpanded == expand) return;
        _isExpanded = expand;

        var collapsedTargetW = (_lastMedia.HasMedia && _lastMedia.IsPlaying) ? CollapsedMediaWidth : CollapsedWidth;
        var targetW = expand ? ExpandedWidth : collapsedTargetW;
        var targetH = expand ? ExpandedHeight : CollapsedHeight;
        var area = GetTargetMonitorWorkArea();
        var targetLeft = area.Left + (area.Width - targetW) / 2.0;

        // Cancel any previous held animations before starting a clean transition
        double startW = ActualWidth > 0 ? ActualWidth : Width;
        double startH = ActualHeight > 0 ? ActualHeight : Height;
        double startLeft = Left;

        IEasingFunction ease = expand
            ? new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.12 }
            : new CubicEase { EasingMode = EasingMode.EaseOut };
        var duration = TimeSpan.FromMilliseconds(expand ? 280 : 210);

        var animW = new DoubleAnimation(startW, targetW, duration) { EasingFunction = ease, FillBehavior = FillBehavior.Stop };
        var animH = new DoubleAnimation(startH, targetH, duration) { EasingFunction = ease, FillBehavior = FillBehavior.Stop };
        var animL = new DoubleAnimation(startLeft, targetLeft, duration) { EasingFunction = ease, FillBehavior = FillBehavior.Stop };

        Width = targetW;
        Height = targetH;
        Left = targetLeft;

        BeginAnimation(WidthProperty, animW);
        BeginAnimation(HeightProperty, animH);
        BeginAnimation(LeftProperty, animL);

        NotchShell.CornerRadius = new CornerRadius(expand ? 26 : 21);
        if (expand) PillProgressTrack.Visibility = Visibility.Collapsed;
        Dispatcher.BeginInvoke(new Action(UpdateMediaProgress), DispatcherPriority.Loaded);

        if (expand)
        {
            CollapsedPillView.Visibility = Visibility.Collapsed;
            ExpandedCardView.Visibility = Visibility.Visible;
            ExpandedCardView.Opacity = 0;
            ExpandedScaleTransform.ScaleX = 0.96;
            ExpandedScaleTransform.ScaleY = 0.94;

            var fadeDur = TimeSpan.FromMilliseconds(200);
            var cubicOut = new CubicEase { EasingMode = EasingMode.EaseOut };
            ExpandedCardView.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, fadeDur) { EasingFunction = cubicOut });
            ExpandedScaleTransform.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(0.96, 1.0, fadeDur) { EasingFunction = cubicOut });
            ExpandedScaleTransform.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(0.94, 1.0, fadeDur) { EasingFunction = cubicOut });

            Activate();
            if (_activeTab == "home")
            {
                SyncAudioAndBrightnessUi();
                HomeQuickInputBox.Focus();
            }
            else if (_activeTab == "ai") CommandInputBox.Focus();
            else if (_activeTab == "media") SyncAudioAndBrightnessUi();
            else if (_activeTab == "system") RefreshRunningAppsUi();
            else if (_activeTab == "shelf") { RenderFileShelf(); RenderClipboardHistory(); }
        }
        else
        {
            ExpandedCardView.Visibility = Visibility.Collapsed;
            CollapsedPillView.Visibility = Visibility.Visible;
            CollapsedPillView.Opacity = 0;
            CollapsedPillView.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(160)));
        }
    }

    private void SwitchTab(string tab)
    {
        _activeTab = tab;
        ViewHome.Visibility = tab == "home" ? Visibility.Visible : Visibility.Collapsed;
        ViewAi.Visibility = tab == "ai" ? Visibility.Visible : Visibility.Collapsed;
        ViewMedia.Visibility = tab == "media" ? Visibility.Visible : Visibility.Collapsed;
        ViewSystem.Visibility = tab == "system" ? Visibility.Visible : Visibility.Collapsed;
        ViewShelf.Visibility = tab == "shelf" ? Visibility.Visible : Visibility.Collapsed;
        ViewSettings.Visibility = tab == "settings" ? Visibility.Visible : Visibility.Collapsed;

        TabHomeBtn.Tag = tab == "home" ? "Active" : null;
        TabAiBtn.Tag = tab == "ai" ? "Active" : null;
        TabMediaBtn.Tag = tab == "media" ? "Active" : null;
        TabSystemBtn.Tag = tab == "system" ? "Active" : null;
        TabShelfBtn.Tag = tab == "shelf" ? "Active" : null;
        TabSettingsBtn.Tag = tab == "settings" ? "Active" : null;

        StageTitleText.Text = tab switch
        {
            "home" => "· Overview",
            "ai" => "· AI Assistant",
            "media" => "· Media & Audio",
            "system" => "· System Monitor",
            "shelf" => "· Drop Shelf",
            "settings" => "· Settings",
            _ => "· Overview"
        };

        // Smooth macOS cross-fade + subtle upward slide transition for the active view
        Grid activeView = tab switch
        {
            "ai" => ViewAi,
            "media" => ViewMedia,
            "system" => ViewSystem,
            "shelf" => ViewShelf,
            "settings" => ViewSettings,
            _ => ViewHome
        };
        AnimateViewEntrance(activeView);

        if (tab == "home") { SyncAudioAndBrightnessUi(); HomeQuickInputBox.Focus(); }
        else if (tab == "ai") CommandInputBox.Focus();
        else if (tab == "media") { SyncAudioAndBrightnessUi(); RefreshLiveTelemetryAndMedia(); }
        else if (tab == "system") { RefreshRunningAppsUi(); RefreshLiveTelemetryAndMedia(); }
        else if (tab == "shelf") { RenderFileShelf(); RenderClipboardHistory(); }
        else if (tab == "settings") PopulateSettingsUi();
    }

    private static void AnimateViewEntrance(UIElement view)
    {
        var slide = new TranslateTransform(0, 8);
        view.RenderTransform = slide;
        view.Opacity = 0;
        var dur = TimeSpan.FromMilliseconds(200);
        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        view.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, dur) { EasingFunction = ease });
        slide.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(8, 0, dur) { EasingFunction = ease });
    }

    private async Task ExecuteUserPromptAsync(string prompt)
    {
        if (string.IsNullOrWhiteSpace(prompt)) return;
        if (_aiThinking) return; // ignore double-submits while a request is in flight

        // If Gemini Live Voice is active, typed messages go straight into the live conversation.
        if (_liveVoice.IsActive)
        {
            _liveUserBuffer = prompt;
            HomeLastReplyText.Text = $"You: {prompt}";
            await _liveVoice.SendTextMessageAsync(prompt);
            return;
        }

        BeginThinking(prompt);
        CommandResult result;
        try
        {
            result = await _commandParser.ExecuteAsync(prompt);
        }
        catch (Exception ex)
        {
            result = new CommandResult(false, $"Something went wrong: {ex.Message}");
        }
        var elapsed = DateTime.Now - _thinkingStartedAt;
        EndThinking();

        UpdateHeaderBadges();
        HomeLastReplyText.Text = result.Reply;
        VoiceStateSubtitle.Text = $"{_aiBrain.ProviderBadge} · {elapsed.TotalSeconds:0.0}s";
        RenderChatHistory();

        if (result.TriggerLockWorkstation)
        {
            StopKeepAwakePatrol();
            NativeInterop.LockWorkstation();
        }
        else if (result.ToggleKeepAwake.HasValue)
        {
            SetKeepAwake(result.ToggleKeepAwake.Value);
        }
        else if (result.StartFocusMinutes.HasValue)
        {
            StartFocusTimer(result.StartFocusMinutes.Value);
        }

        if (!string.IsNullOrEmpty(result.SwitchToTab))
        {
            SwitchTab(result.SwitchToTab);
        }
    }

    private void BeginThinking(string prompt)
    {
        _aiThinking = true;
        _thinkingStartedAt = DateTime.Now;
        _thinkingFrame = 0;

        SendCommandBtn.IsEnabled = false;
        HomeRunBtn.IsEnabled = false;
        VoiceStateSubtitle.Text = "Thinking...";
        HomeLastReplyText.Text = $"Working on \"{Truncate(prompt, 60)}\"...";

        // Show the user's message immediately, then a live typing bubble under it.
        RenderChatHistory(pendingUserText: prompt);
        _thinkingBubble = BuildThinkingBubble();
        ChatMessagesPanel.Children.Add(_thinkingBubble);
        ChatScrollViewer.ScrollToEnd();

        // Pulse the header orb + collapsed orb while working
        var pulse = new DoubleAnimation(0.35, 1.0, TimeSpan.FromMilliseconds(620))
        {
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
        };
        ExpandedOrbGlow.BeginAnimation(OpacityProperty, pulse);
        CollapsedOrbGlow.BeginAnimation(OpacityProperty, pulse);
        ApplyAuroraTheme(Color.FromRgb(168, 85, 247), Color.FromRgb(56, 189, 248));

        _thinkingTimer.Start();
        UpdateCollapsedPillTicker();
    }

    private void EndThinking()
    {
        _aiThinking = false;
        _thinkingTimer.Stop();
        SendCommandBtn.IsEnabled = true;
        HomeRunBtn.IsEnabled = true;
        if (_thinkingBubble is not null)
        {
            ChatMessagesPanel.Children.Remove(_thinkingBubble);
            _thinkingBubble = null;
        }
        ExpandedOrbGlow.BeginAnimation(OpacityProperty, null);
        CollapsedOrbGlow.BeginAnimation(OpacityProperty, null);
        if (_artworkAccent is { } accent && _lastMedia.HasMedia && _lastMedia.IsPlaying)
            ApplyAuroraTheme(accent.Primary, accent.Secondary);
        else
            ApplyAuroraTheme(AuroraThemes[_auroraIndex].Primary, AuroraThemes[_auroraIndex].Secondary);
        UpdateCollapsedPillTicker();
    }

    private void TickThinkingIndicator()
    {
        if (!_aiThinking) return;
        _thinkingFrame++;
        var secs = (DateTime.Now - _thinkingStartedAt).TotalSeconds;
        string phase = secs < 2 ? "Thinking" : secs < 6 ? "Working on it" : secs < 15 ? "Running tools" : "Still working";
        var dots = new string('.', _thinkingFrame % 3 + 1);
        VoiceStateSubtitle.Text = $"{phase}{dots} {secs:0}s";

        if (_thinkingBubble?.Child is StackPanel sp && sp.Children.Count == 2 && sp.Children[1] is TextBlock label)
        {
            label.Text = $"{phase} · {secs:0}s";
            if (sp.Children[0] is StackPanel dotRow)
            {
                for (int i = 0; i < dotRow.Children.Count; i++)
                {
                    if (dotRow.Children[i] is System.Windows.Shapes.Ellipse e)
                        e.Opacity = i == _thinkingFrame % dotRow.Children.Count ? 1.0 : 0.3;
                }
            }
        }
        UpdateCollapsedPillTicker();
    }

    private static Border BuildThinkingBubble()
    {
        var dotRow = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 9, 0) };
        var dotColors = new[] { Color.FromRgb(56, 189, 248), Color.FromRgb(168, 85, 247), Color.FromRgb(52, 211, 153) };
        for (int i = 0; i < 3; i++)
        {
            dotRow.Children.Add(new System.Windows.Shapes.Ellipse
            {
                Width = 6,
                Height = 6,
                Margin = new Thickness(0, 0, 4, 0),
                Fill = new SolidColorBrush(dotColors[i]),
                Opacity = i == 0 ? 1 : 0.3
            });
        }
        var panel = new StackPanel { Orientation = Orientation.Horizontal };
        panel.Children.Add(dotRow);
        panel.Children.Add(new TextBlock
        {
            Text = "Thinking · 0s",
            Foreground = new SolidColorBrush(Color.FromRgb(148, 163, 184)),
            FontSize = 11,
            VerticalAlignment = VerticalAlignment.Center
        });
        return new Border
        {
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(11, 7, 12, 7),
            Margin = new Thickness(0, 2, 0, 7),
            HorizontalAlignment = HorizontalAlignment.Left,
            Background = new SolidColorBrush(Color.FromArgb(24, 255, 255, 255)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(40, 168, 85, 247)),
            BorderThickness = new Thickness(1),
            Child = panel
        };
    }

    private static string Truncate(string text, int max) =>
        text.Length <= max ? text : text[..(max - 1)] + "…";

    private void RenderChatHistory(string? pendingUserText = null)
    {
        ChatMessagesPanel.Children.Clear();
        if (_aiBrain.History.Count == 0 && pendingUserText is null)
        {
            ChatMessagesPanel.Children.Add(new TextBlock
            {
                Text = $"{_commandParser.AssistantName} is ready. Connect Gemini, OpenAI, or local Ollama in Settings for full tool-calling intelligence, or use instant local commands like \"= 24*17\", \"open chrome\", \"what's playing\".",
                Foreground = new SolidColorBrush(Color.FromRgb(148, 163, 184)),
                FontSize = 12,
                LineHeight = 18,
                TextWrapping = TextWrapping.Wrap
            });
            return;
        }

        foreach (var msg in _aiBrain.History)
        {
            ChatMessagesPanel.Children.Add(BuildChatBubble(msg.Role, msg.Text, msg.TimeLabel));
        }
        if (pendingUserText is not null)
        {
            ChatMessagesPanel.Children.Add(BuildChatBubble("user", pendingUserText, DateTime.Now.ToString("HH:mm")));
        }
        ChatScrollViewer.ScrollToEnd();
    }

    private UIElement BuildChatBubble(string role, string text, string timeLabel)
    {
        bool isUser = role == "user";
        bool isTool = role == "tool";

        if (isTool)
        {
            // Tool calls render as a compact monospace trace chip
            return new Border
            {
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(8, 4, 8, 4),
                Margin = new Thickness(0, 0, 60, 6),
                HorizontalAlignment = HorizontalAlignment.Left,
                Background = new SolidColorBrush(Color.FromArgb(26, 251, 191, 36)),
                BorderBrush = new SolidColorBrush(Color.FromArgb(60, 251, 191, 36)),
                BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = $"⚙ {text}",
                    Foreground = new SolidColorBrush(Color.FromRgb(253, 230, 138)),
                    FontFamily = new FontFamily("Cascadia Mono, Consolas"),
                    FontSize = 10.5,
                    TextWrapping = TextWrapping.Wrap
                }
            };
        }

        var header = new TextBlock
        {
            Text = isUser ? $"You · {timeLabel}" : $"{_commandParser.AssistantName} · {timeLabel}",
            Foreground = isUser
                ? new SolidColorBrush(Color.FromRgb(125, 211, 252))
                : new SolidColorBrush(Color.FromRgb(196, 181, 253)),
            FontSize = 9.5,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 3),
            HorizontalAlignment = isUser ? HorizontalAlignment.Right : HorizontalAlignment.Left
        };

        // Read-only TextBox so replies can be selected and copied
        var body = new TextBox
        {
            Text = text,
            IsReadOnly = true,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            Foreground = Brushes.White,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            CaretBrush = Brushes.Transparent,
            SelectionBrush = new SolidColorBrush(Color.FromArgb(120, 56, 189, 248)),
            Cursor = Cursors.IBeam
        };

        var stack = new StackPanel();
        stack.Children.Add(header);
        stack.Children.Add(body);

        var bubble = new Border
        {
            CornerRadius = isUser ? new CornerRadius(14, 14, 4, 14) : new CornerRadius(14, 14, 14, 4),
            Padding = new Thickness(11, 7, 11, 8),
            Margin = isUser ? new Thickness(72, 0, 0, 8) : new Thickness(0, 0, 44, 8),
            HorizontalAlignment = isUser ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            BorderThickness = new Thickness(1),
            Child = stack
        };
        if (isUser)
        {
            bubble.Background = new LinearGradientBrush(Color.FromArgb(80, 56, 189, 248), Color.FromArgb(60, 99, 102, 241), 45);
            bubble.BorderBrush = new SolidColorBrush(Color.FromArgb(95, 56, 189, 248));
        }
        else
        {
            bubble.Background = new SolidColorBrush(Color.FromArgb(24, 255, 255, 255));
            bubble.BorderBrush = new SolidColorBrush(Color.FromArgb(34, 255, 255, 255));
        }
        return bubble;
    }

    private BitmapSource? ExtractIconBitmap(string? filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath) || !System.IO.File.Exists(filePath)) return null;
        try
        {
            using var icon = System.Drawing.Icon.ExtractAssociatedIcon(filePath);
            if (icon is null) return null;
            using var bmp = icon.ToBitmap();
            IntPtr hBitmap = bmp.GetHbitmap();
            try
            {
                return Imaging.CreateBitmapSourceFromHBitmap(
                    hBitmap,
                    IntPtr.Zero,
                    Int32Rect.Empty,
                    BitmapSizeOptions.FromEmptyOptions());
            }
            finally
            {
                DeleteObject(hBitmap);
            }
        }
        catch
        {
            return null;
        }
    }

    private void RenderFileShelf()
    {
        FileShelfPanel.Children.Clear();
        PillShelfBadge.Visibility = _fileShelf.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        PillShelfBadgeText.Text = _fileShelf.Count.ToString();

        if (_fileShelf.Count == 0)
        {
            FileShelfPanel.Children.Add(new TextBlock
            {
                Text = "No files staged yet. Drag items out to any app once added.",
                Foreground = new SolidColorBrush(Color.FromRgb(100, 116, 139)),
                FontSize = 11,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(2, 10, 2, 10)
            });
            return;
        }

        foreach (var item in _fileShelf.Items)
        {
            var card = new Border
            {
                Width = 94,
                Height = 76,
                Margin = new Thickness(0, 0, 7, 7),
                CornerRadius = new CornerRadius(12),
                Background = new SolidColorBrush(Color.FromArgb(24, 255, 255, 255)),
                BorderBrush = new SolidColorBrush(Color.FromArgb(36, 167, 139, 250)),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(6),
                Cursor = Cursors.Hand,
                ToolTip = $"{item.FullPath}\nClick to open · Drag out to another app"
            };

            var root = new Grid();
            var content = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };

            var iconSrc = item.IsDirectory ? null : ExtractIconBitmap(item.FullPath);
            if (iconSrc is not null)
            {
                content.Children.Add(new Image { Source = iconSrc, Width = 26, Height = 26, Margin = new Thickness(0, 0, 0, 4) });
            }
            else
            {
                content.Children.Add(new TextBlock
                {
                    Text = item.IsDirectory ? "📁" : "📄",
                    FontSize = 20,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    Margin = new Thickness(0, 0, 0, 2)
                });
            }

            content.Children.Add(new TextBlock
            {
                Text = item.Name.Length > 12 ? item.Name[..11] + "…" : item.Name,
                Foreground = Brushes.White,
                FontSize = 10,
                FontWeight = FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis
            });

            content.Children.Add(new TextBlock
            {
                Text = item.SizeLabel,
                Foreground = new SolidColorBrush(Color.FromRgb(148, 163, 184)),
                FontSize = 9,
                HorizontalAlignment = HorizontalAlignment.Center
            });

            var rmBtn = new Button
            {
                Content = "×",
                Width = 16,
                Height = 16,
                FontSize = 10,
                Padding = new Thickness(0),
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Background = new SolidColorBrush(Color.FromArgb(50, 0, 0, 0)),
                Foreground = new SolidColorBrush(Color.FromRgb(203, 213, 225)),
                BorderThickness = new Thickness(0),
                Cursor = Cursors.Hand
            };
            rmBtn.Click += (_, e) =>
            {
                e.Handled = true;
                _fileShelf.Remove(item.FullPath);
            };

            root.Children.Add(content);
            root.Children.Add(rmBtn);
            card.Child = root;

            card.MouseLeftButtonUp += (_, _) => FileShelfService.OpenItem(item.FullPath);
            card.PreviewMouseMove += (_, e) =>
            {
                if (e.LeftButton == MouseButtonState.Pressed)
                {
                    var data = new DataObject(DataFormats.FileDrop, new[] { item.FullPath });
                    DragDrop.DoDragDrop(card, data, DragDropEffects.Copy);
                }
            };

            FileShelfPanel.Children.Add(card);
        }
    }

    private void RenderClipboardHistory()
    {
        ClipboardHistoryPanel.Children.Clear();
        if (_clipboardService.Entries.Count == 0)
        {
            ClipboardHistoryPanel.Children.Add(new TextBlock
            {
                Text = "Copied text appears here automatically. Click any entry to re-copy.",
                Foreground = new SolidColorBrush(Color.FromRgb(100, 116, 139)),
                FontSize = 11.5,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(2, 18, 2, 18)
            });
            return;
        }

        foreach (var entry in _clipboardService.Entries)
        {
            var row = new Grid { Margin = new Thickness(0, 0, 0, 5) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var copyBtn = new Button
            {
                Style = (Style)FindResource("QuickChipButtonStyle"),
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Content = $"{(entry.IsPinned ? "📌 " : "")}{entry.Preview}",
                ToolTip = $"Copied at {entry.TimeLabel} — click to copy"
            };
            copyBtn.Click += (_, _) => _clipboardService.CopyEntry(entry.Id);

            var pinBtn = new Button
            {
                Style = (Style)FindResource("QuickChipButtonStyle"),
                Content = entry.IsPinned ? "Unpin" : "Pin",
                Margin = new Thickness(4, 0, 4, 0)
            };
            pinBtn.Click += (_, _) => _clipboardService.TogglePin(entry.Id);

            var delBtn = new Button
            {
                Style = (Style)FindResource("QuickChipButtonStyle"),
                Content = "×"
            };
            delBtn.Click += (_, _) => _clipboardService.Remove(entry.Id);

            Grid.SetColumn(copyBtn, 0);
            Grid.SetColumn(pinBtn, 1);
            Grid.SetColumn(delBtn, 2);
            row.Children.Add(copyBtn);
            row.Children.Add(pinBtn);
            row.Children.Add(delBtn);
            ClipboardHistoryPanel.Children.Add(row);
        }
    }

    private void RefreshRunningAppsUi()
    {
        RunningAppsPanel.Children.Clear();
        var apps = _appManager.ListRunningApps(12);
        foreach (var app in apps)
        {
            var shortName = app.Name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                ? app.Name[..^4]
                : app.Name;

            var tile = new Border
            {
                Width = 96,
                Height = 76,
                Margin = new Thickness(0, 0, 8, 8),
                CornerRadius = new CornerRadius(14),
                Background = new SolidColorBrush(Color.FromArgb(22, 255, 255, 255)),
                BorderBrush = new SolidColorBrush(Color.FromArgb(32, 255, 255, 255)),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(6),
                Cursor = Cursors.Hand,
                ToolTip = $"{app.WindowTitle}\n{app.Name} · {app.MemoryMb} MB (Click to focus)"
            };

            var grid = new Grid();
            var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };

            var iconBmp = ExtractIconBitmap(app.ExecutablePath);
            if (iconBmp is not null)
            {
                stack.Children.Add(new Image
                {
                    Source = iconBmp,
                    Width = 28,
                    Height = 28,
                    Margin = new Thickness(0, 0, 0, 5)
                });
            }
            else
            {
                var badge = new Border
                {
                    Width = 28,
                    Height = 28,
                    CornerRadius = new CornerRadius(8),
                    Background = new SolidColorBrush(Color.FromArgb(55, 56, 189, 248)),
                    Margin = new Thickness(0, 0, 0, 5),
                    Child = new TextBlock
                    {
                        Text = shortName.Length > 0 ? shortName[..1].ToUpperInvariant() : "A",
                        Foreground = Brushes.White,
                        FontSize = 13,
                        FontWeight = FontWeights.Bold,
                        HorizontalAlignment = HorizontalAlignment.Center,
                        VerticalAlignment = VerticalAlignment.Center
                    }
                };
                stack.Children.Add(badge);
            }

            stack.Children.Add(new TextBlock
            {
                Text = shortName.Length > 11 ? shortName[..10] + "…" : shortName,
                Foreground = Brushes.White,
                FontSize = 10.5,
                FontWeight = FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Center
            });

            stack.Children.Add(new TextBlock
            {
                Text = $"{app.MemoryMb} MB",
                Foreground = new SolidColorBrush(Color.FromRgb(148, 163, 184)),
                FontFamily = new FontFamily("Cascadia Mono, Consolas"),
                FontSize = 9,
                HorizontalAlignment = HorizontalAlignment.Center
            });

            grid.Children.Add(stack);

            if (!app.IsProtected)
            {
                var closeBtn = new Button
                {
                    Content = "×",
                    Width = 17,
                    Height = 17,
                    FontSize = 10,
                    Padding = new Thickness(0),
                    HorizontalAlignment = HorizontalAlignment.Right,
                    VerticalAlignment = VerticalAlignment.Top,
                    Background = new SolidColorBrush(Color.FromArgb(55, 244, 63, 94)),
                    Foreground = new SolidColorBrush(Color.FromRgb(253, 164, 175)),
                    BorderThickness = new Thickness(0),
                    Cursor = Cursors.Hand,
                    ToolTip = $"Close {shortName}"
                };
                closeBtn.Click += (_, e) =>
                {
                    e.Handled = true;
                    _appManager.CloseApp(app.Name);
                    RefreshRunningAppsUi();
                };
                grid.Children.Add(closeBtn);
            }

            tile.Child = grid;
            tile.MouseLeftButtonUp += (_, _) => _appManager.FocusApp(app.Pid);
            RunningAppsPanel.Children.Add(tile);
        }
    }

    private void SyncAudioAndBrightnessUi()
    {
        _suppressSliderEvents = true;
        try
        {
            var (vol, muted) = _audio.GetAudioState();
            VolumeSlider.Value = vol;
            HomeVolumeSlider.Value = vol;
            string volText = muted ? "Mute" : $"{vol}%";
            VolumeValueText.Text = muted ? "Muted" : $"{vol}%";
            HomeVolumeText.Text = volText;
            VolumeMuteBtn.Content = muted ? "Unmute Audio" : "Mute Audio";

            var hwnd = new WindowInteropHelper(this).Handle;
            int bright = _audio.GetBrightness(hwnd);
            BrightnessSlider.Value = bright;
            BrightnessValueText.Text = $"{bright}%";
        }
        finally
        {
            _suppressSliderEvents = false;
        }
    }

    private void PopulateSettingsUi()
    {
        _initializingSettingsUi = true;
        try
        {
            SelectComboByText(AiProviderCombo, _settings.Current.AiProvider);
            AiModelBox.Text = _settings.Current.AiModel;
            AiEndpointBox.Text = _settings.Current.AiEndpoint;
            GeminiLiveModelBox.Text = _settings.Current.GeminiLiveModel;
            SelectComboByText(GeminiVoiceCombo, _settings.Current.GeminiVoice);
            AiApiKeyBox.Password = string.Empty;

            SelectComboByText(HotkeyCombo, _settings.Current.HotkeyCombo);

            MonitorCombo.Items.Clear();
            var screens = System.Windows.Forms.Screen.AllScreens;
            for (int i = 0; i < screens.Length; i++)
            {
                var s = screens[i];
                MonitorCombo.Items.Add($"Display {i + 1} ({s.Bounds.Width}×{s.Bounds.Height}){(s.Primary ? " ★" : "")}");
            }
            if (MonitorCombo.Items.Count > 0)
            {
                MonitorCombo.SelectedIndex = Math.Clamp(_settings.Current.MonitorIndex, 0, MonitorCombo.Items.Count - 1);
            }

            AutoAuroraCheck.IsChecked = _settings.Current.AutoAurora;
            StartupCheck.IsChecked = _settings.Current.StartWithWindows;
            MousePatrolCheck.IsChecked = _settings.Current.KeepAwakeUseMousePatrol;
        }
        finally
        {
            _initializingSettingsUi = false;
        }
    }

    private static void SelectComboByText(ComboBox combo, string text)
    {
        foreach (ComboBoxItem item in combo.Items)
        {
            if (string.Equals(item.Content?.ToString(), text, StringComparison.OrdinalIgnoreCase))
            {
                combo.SelectedItem = item;
                return;
            }
        }
        if (combo.Items.Count > 0) combo.SelectedIndex = 0;
    }

    private void SetKeepAwake(bool enabled)
    {
        if (enabled == _keepAwakeActive) return;
        _keepAwakeActive = enabled;
        string label = enabled ? "Coffee: On" : "Coffee: Off";
        KeepAwakeButton.Content = label;
        QuickKeepAwakeBtn.Content = label;
        UpdateCollapsedPillTicker();

        SystemTelemetryService.SetKeepAwakeExecutionState(enabled);

        if (enabled && _settings.Current.KeepAwakeUseMousePatrol)
        {
            NativeInterop.ResetEmergencyStop();
            _patrolCts = new CancellationTokenSource();
            var ct = _patrolCts.Token;
            _ = Task.Run(async () =>
            {
                var rng = new Random();
                while (!ct.IsCancellationRequested && !NativeInterop.IsEmergencyStopped())
                {
                    int x = rng.Next(260, 920);
                    int y = rng.Next(200, 620);
                    NativeInterop.MoveMouseSmooth(x, y, 420);
                    await Task.Delay(TimeSpan.FromSeconds(18), ct);
                }
            }, ct);
        }
        else if (!enabled)
        {
            StopKeepAwakePatrol();
        }
    }

    private void StopKeepAwakePatrol()
    {
        _keepAwakeActive = false;
        KeepAwakeButton.Content = "Coffee: Off";
        QuickKeepAwakeBtn.Content = "Coffee: Off";
        SystemTelemetryService.SetKeepAwakeExecutionState(false);
        NativeInterop.TriggerEmergencyStop();
        _patrolCts?.Cancel();
        _patrolCts?.Dispose();
        _patrolCts = null;
        UpdateCollapsedPillTicker();
    }

    private void StartFocusTimer(int minutes)
    {
        _settings.Current.FocusMinutes = minutes;
        _settings.Save();
        _focusSecondsRemaining = minutes * 60;
        UpdateFocusTimerDisplays();
        _focusRunning = true;
        UpdateFocusToggleLabels();
        UpdateCollapsedPillTicker();
    }

    // ==================== EVENT HANDLERS ====================

    private bool CanAutoCollapse() =>
        !CommandInputBox.IsKeyboardFocused &&
        !HomeQuickInputBox.IsKeyboardFocused &&
        !AiModelBox.IsKeyboardFocused &&
        !AiEndpointBox.IsKeyboardFocused &&
        !GeminiLiveModelBox.IsKeyboardFocused &&
        !AiApiKeyBox.IsKeyboardFocused &&
        !AiProviderCombo.IsDropDownOpen &&
        !GeminiVoiceCombo.IsDropDownOpen &&
        !HotkeyCombo.IsDropDownOpen &&
        !MonitorCombo.IsDropDownOpen;

    private void Window_MouseEnter(object sender, MouseEventArgs e)
    {
        _outsideTicks = 0;
        SetExpanded(true);
    }

    private void Window_MouseLeave(object sender, MouseEventArgs e)
    {
        // Handled reliably by _hoverWatchTimer using real Win32 GetCursorPos bounds
    }

    private void Window_DragEnter(object sender, DragEventArgs e)
    {
        if (e.Data.GetDataPresent(DataFormats.FileDrop))
        {
            e.Effects = DragDropEffects.Copy;
            SwitchTab("shelf");
            SetExpanded(true);
        }
    }

    private void Window_Drop(object sender, DragEventArgs e)
    {
        if (e.Data.GetDataPresent(DataFormats.FileDrop) &&
            e.Data.GetData(DataFormats.FileDrop) is string[] files)
        {
            _fileShelf.AddPaths(files);
            SwitchTab("shelf");
            SetExpanded(true);
        }
    }

    private void CollapsedPill_Click(object sender, MouseButtonEventArgs e) => SetExpanded(true);
    private void CollapseNotch_Click(object sender, RoutedEventArgs e) => SetExpanded(false);
    private void RailOrb_Click(object sender, MouseButtonEventArgs e) => SwitchTab("home");
    private void OpenSystemCard_Click(object sender, MouseButtonEventArgs e) => SwitchTab("system");
    private void OpenShelfCard_Click(object sender, MouseButtonEventArgs e) => SwitchTab("shelf");

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            StopKeepAwakePatrol();
            SetExpanded(false);
        }
    }

    private void TabButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.CommandParameter is string tab)
        {
            SwitchTab(tab);
        }
    }

    private async void HomeQuickInputBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            var text = HomeQuickInputBox.Text.Trim();
            HomeQuickInputBox.Clear();
            await ExecuteUserPromptAsync(text);
        }
    }

    private async void HomeQuickSubmit_Click(object sender, RoutedEventArgs e)
    {
        var text = HomeQuickInputBox.Text.Trim();
        HomeQuickInputBox.Clear();
        await ExecuteUserPromptAsync(text);
    }

    private async void CommandInputBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            var text = CommandInputBox.Text.Trim();
            CommandInputBox.Clear();
            await ExecuteUserPromptAsync(text);
        }
    }

    private async void SubmitCommand_Click(object sender, RoutedEventArgs e)
    {
        var text = CommandInputBox.Text.Trim();
        CommandInputBox.Clear();
        await ExecuteUserPromptAsync(text);
    }

    private async void QuickChip_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string cmd)
        {
            await ExecuteUserPromptAsync(cmd);
        }
    }

    private void ClearChat_Click(object sender, RoutedEventArgs e)
    {
        _aiBrain.ClearHistory();
        RenderChatHistory();
    }

    private async void SiriOrbCard_Click(object sender, MouseButtonEventArgs e)
    {
        if (_liveVoice.IsActive || _liveStatus == "connecting")
        {
            _liveVoice.Stop();
            return;
        }
        await _liveVoice.StartLiveAsync();
    }

    private async void VoiceListen_Click(object sender, RoutedEventArgs e)
    {
        if (_liveVoice.IsActive || _liveStatus == "connecting")
        {
            _liveVoice.Stop();
            return;
        }

        SwitchTab("ai");
        await _liveVoice.StartLiveAsync();
    }

    private void ThemeDot_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && int.TryParse(btn.Tag?.ToString(), out int idx))
        {
            _settings.Current.AutoAurora = false;
            _auroraIndex = Math.Clamp(idx, 0, AuroraThemes.Length - 1);
            _settings.Current.AuroraThemeIndex = _auroraIndex;
            _settings.Save();
            ApplyAuroraTheme(AuroraThemes[_auroraIndex].Primary, AuroraThemes[_auroraIndex].Secondary);
        }
    }

    private void MediaPrev_Click(object sender, RoutedEventArgs e) { _media.PreviousTrack(); RefreshMediaSoon(); }
    private void MediaPlayPause_Click(object sender, RoutedEventArgs e) { _media.PlayPause(); RefreshMediaSoon(); }
    private void MediaNext_Click(object sender, RoutedEventArgs e) { _media.NextTrack(); RefreshMediaSoon(); }
    private void MediaStop_Click(object sender, RoutedEventArgs e) { _media.Stop(); RefreshMediaSoon(); }

    /// <summary>Re-polls the media session shortly after a control press so the UI reacts instantly.</summary>
    private async void RefreshMediaSoon()
    {
        await Task.Delay(350);
        await RefreshMediaAsync();
    }

    private async void MediaProgress_Click(object sender, MouseButtonEventArgs e)
    {
        if (sender is not FrameworkElement el || el.ActualWidth <= 0 || !_lastMedia.HasTimeline) return;
        double fraction = Math.Clamp(e.GetPosition(el).X / el.ActualWidth, 0, 1);
        if (await _media.SeekAsync(fraction))
        {
            _lastMedia = _lastMedia with
            {
                Position = TimeSpan.FromTicks((long)(_lastMedia.Duration.Ticks * fraction)),
                CapturedAt = DateTimeOffset.Now
            };
            _syncedLyricIndex = int.MinValue;
            UpdateMediaProgress();
        }
    }

    private void VolumeSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (_suppressSliderEvents || !IsLoaded) return;
        _suppressSliderEvents = true;
        try
        {
            int pct = (int)Math.Round(e.NewValue);
            _audio.SetMasterVolume(pct);
            VolumeSlider.Value = pct;
            HomeVolumeSlider.Value = pct;
            VolumeValueText.Text = $"{pct}%";
            HomeVolumeText.Text = $"{pct}%";
        }
        finally
        {
            _suppressSliderEvents = false;
        }
    }

    private void VolumeMute_Click(object sender, RoutedEventArgs e)
    {
        bool muted = _audio.ToggleMute();
        SyncAudioAndBrightnessUi();
        VolumeMuteBtn.Content = muted ? "Unmute Audio" : "Mute Audio";
    }

    private void BrightnessSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (_suppressSliderEvents || !IsLoaded) return;
        int pct = (int)Math.Round(e.NewValue);
        BrightnessValueText.Text = $"{pct}%";
        _audio.SetBrightnessAsync(new WindowInteropHelper(this).Handle, pct);
    }

    private void RefreshApps_Click(object sender, RoutedEventArgs e) => RefreshRunningAppsUi();

    private void FocusTimerToggle_Click(object sender, RoutedEventArgs e)
    {
        _focusRunning = !_focusRunning;
        UpdateFocusToggleLabels();
        UpdateCollapsedPillTicker();
    }

    private void FocusTimerReset_Click(object sender, RoutedEventArgs e)
    {
        _focusRunning = false;
        _focusSecondsRemaining = _settings.Current.FocusMinutes * 60;
        UpdateFocusTimerDisplays();
        UpdateFocusToggleLabels();
        UpdateCollapsedPillTicker();
    }

    private void FocusPreset_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && int.TryParse(btn.Tag?.ToString(), out int mins))
        {
            StartFocusTimer(mins);
        }
    }

    private void KeepAwake_Click(object sender, RoutedEventArgs e) => SetKeepAwake(!_keepAwakeActive);

    private void LockPc_Click(object sender, RoutedEventArgs e)
    {
        StopKeepAwakePatrol();
        AuditLogger.Instance.Log("security", "lock_workstation", "allowed", "Manual LockWorkStation()");
        NativeInterop.LockWorkstation();
    }

    private void BrowseShelfFiles_Click(object sender, MouseButtonEventArgs e)
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Stage Files to NOVA Drop Shelf",
            Multiselect = true
        };
        if (dlg.ShowDialog() == true && dlg.FileNames.Length > 0)
        {
            _fileShelf.AddPaths(dlg.FileNames);
        }
    }

    private void ClearShelf_Click(object sender, RoutedEventArgs e) => _fileShelf.Clear();
    private void ClearClipboard_Click(object sender, RoutedEventArgs e) => _clipboardService.ClearUnpinned();

    private void AiProviderCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_initializingSettingsUi) return;
        if (AiProviderCombo.SelectedItem is ComboBoxItem item)
        {
            var provider = item.Content?.ToString() ?? "None";
            if (provider == "Gemini")
            {
                AiModelBox.Text = "gemini-3.1-flash-lite";
                AiEndpointBox.Text = "https://generativelanguage.googleapis.com";
            }
            else if (provider == "OpenAI")
            {
                AiModelBox.Text = "gpt-4o-mini";
                AiEndpointBox.Text = "https://api.openai.com/v1";
            }
            else if (provider == "Ollama")
            {
                AiModelBox.Text = "llama3.2";
                AiEndpointBox.Text = "http://localhost:11434";
            }
        }
    }

    private void SaveAiSettings_Click(object sender, RoutedEventArgs e)
    {
        var provider = (AiProviderCombo.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "None";
        _settings.Current.AiProvider = provider;
        _settings.Current.AiModel = AiModelBox.Text.Trim();
        _settings.Current.AiEndpoint = AiEndpointBox.Text.Trim();
        _settings.Current.GeminiLiveModel = string.IsNullOrWhiteSpace(GeminiLiveModelBox.Text) ? "gemini-3.8-live" : GeminiLiveModelBox.Text.Trim();
        _settings.Current.GeminiVoice = (GeminiVoiceCombo.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "Kore";
        if (!string.IsNullOrWhiteSpace(AiApiKeyBox.Password))
        {
            _settings.SetApiKey(AiApiKeyBox.Password);
            AiApiKeyBox.Password = string.Empty;
        }
        else
        {
            _settings.Save();
        }
        UpdateHeaderBadges();
        SettingsSavedStatus.Text = $"Saved ({_settings.Current.GeminiVoice})!";
    }

    private void HotkeyCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_initializingSettingsUi) return;
        if (HotkeyCombo.SelectedItem is ComboBoxItem item && item.Content is string combo)
        {
            _settings.Current.HotkeyCombo = combo;
            _settings.Save();
            _hotkeyService.Register(combo);
        }
    }

    private void MonitorCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_initializingSettingsUi || MonitorCombo.SelectedIndex < 0) return;
        _settings.Current.MonitorIndex = MonitorCombo.SelectedIndex;
        _settings.Save();
        AnchorTopCenter(_isExpanded ? ExpandedWidth : CollapsedWidth);
    }

    private void AutoAuroraCheck_Click(object sender, RoutedEventArgs e)
    {
        _settings.Current.AutoAurora = AutoAuroraCheck.IsChecked == true;
        _settings.Save();
    }

    private void StartupCheck_Click(object sender, RoutedEventArgs e)
    {
        _settings.SetStartWithWindows(StartupCheck.IsChecked == true);
    }

    private void MousePatrolCheck_Click(object sender, RoutedEventArgs e)
    {
        _settings.Current.KeepAwakeUseMousePatrol = MousePatrolCheck.IsChecked == true;
        _settings.Save();
    }

    private void CopyCompanionToken_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Clipboard.SetText(_companionServer.PairingToken);
            SettingsSavedStatus.Text = "Token copied!";
        }
        catch { }
    }

    private void QuitApp_Click(object sender, RoutedEventArgs e) => Close();
}
