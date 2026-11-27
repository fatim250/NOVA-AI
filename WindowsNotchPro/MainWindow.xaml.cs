using System;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using WindowsNotchPro.Services;

namespace WindowsNotchPro;

public partial class MainWindow : Window
{
    private const double CollapsedWidth = 248;
    private const double CollapsedHeight = 48;
    private const double ExpandedWidth = 640;
    private const double ExpandedHeight = 296;
    private const int WmDpiChanged = 0x02E0;

    private readonly SafeFileManager _fileManager;
    private readonly SafeAppManager _appManager;
    private readonly SecurityVault _securityVault;
    private readonly CommandParser _commandParser;
    private readonly CompanionServer _companionServer;

    private readonly SpeechSynthesizer _synthesizer = new();
    private SpeechRecognitionEngine? _speechRecognizer;
    private bool _isListening;
    private bool _ttsMuted;
    private bool _isExpanded;
    private bool _autoAurora = true;
    private int _auroraIndex;
    private bool _keepAwakeActive;
    private CancellationTokenSource? _patrolCts;

    private readonly DispatcherTimer _clockTimer = new();
    private readonly DispatcherTimer _auroraTimer = new();
    private readonly DispatcherTimer _focusTimer = new();
    private int _focusSecondsRemaining = 25 * 60;
    private bool _focusRunning;

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

        _fileManager = new SafeFileManager(AuditLogger.Instance);
        _appManager = new SafeAppManager(AuditLogger.Instance);
        _securityVault = new SecurityVault(AuditLogger.Instance);
        _commandParser = new CommandParser(_fileManager, _appManager, _securityVault, AuditLogger.Instance);
        _companionServer = new CompanionServer(_commandParser, _securityVault, AuditLogger.Instance);

        CommandInputBox.TextChanged += (_, _) =>
        {
            CommandPlaceholder.Visibility = string.IsNullOrEmpty(CommandInputBox.Text)
                ? Visibility.Visible
                : Visibility.Collapsed;
        };

        ConfigureSpeechSynthesis();
        ConfigureTimers();
    }

    private void Window_Loaded(object sender, RoutedEventArgs e)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        NativeInterop.EnableRoundedCorners(hwnd);

        var source = HwndSource.FromHwnd(hwnd);
        source?.AddHook(WndProc);

        AnchorTopCenter(CollapsedWidth);
        InitializeSpeechRecognition();

        // Start loopback-only token-authenticated companion server for Kotlin client
        _companionServer.OnCommandExecuted += reply =>
        {
            Dispatcher.Invoke(() =>
            {
                AssistantReplyText.Text = reply;
                SpeakReply(reply);
            });
        };
        _companionServer.Start();

        AuditLogger.Instance.Log(
            "system",
            "notch_started",
            "allowed",
            $"Per-Monitor V2 DPI active · Companion listening on {_companionServer.ListenUrl}");
    }

    private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        StopKeepAwakePatrol();
        _companionServer.Dispose();
        _speechRecognizer?.Dispose();
        _synthesizer.Dispose();
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WmDpiChanged)
        {
            Dispatcher.BeginInvoke(() => AnchorTopCenter(_isExpanded ? ExpandedWidth : CollapsedWidth));
        }
        return IntPtr.Zero;
    }

    private void AnchorTopCenter(double targetWidth)
    {
        var area = SystemParameters.WorkArea;
        Left = area.Left + (area.Width - targetWidth) / 2.0;
        Top = area.Top + 6;
    }

    private void ConfigureSpeechSynthesis()
    {
        try
        {
            _synthesizer.SetOutputToDefaultAudioDevice();
            _synthesizer.Rate = 1;
            _synthesizer.Volume = 95;
        }
        catch (Exception ex)
        {
            AuditLogger.Instance.Log("system", "tts_init_warning", "warning", ex.Message);
        }
    }

    private void InitializeSpeechRecognition()
    {
        try
        {
            _speechRecognizer = new SpeechRecognitionEngine();
            _speechRecognizer.LoadGrammar(new DictationGrammar());
            _speechRecognizer.SetInputToDefaultAudioDevice();
            _speechRecognizer.SpeechRecognized += async (_, args) =>
            {
                if (args.Result.Confidence < 0.45f) return;
                var spoken = args.Result.Text.Trim();
                if (string.IsNullOrEmpty(spoken)) return;

                await Dispatcher.InvokeAsync(async () =>
                {
                    CommandInputBox.Text = spoken;
                    await ExecuteUserPromptAsync(spoken);
                });
            };
        }
        catch (Exception ex)
        {
            _speechRecognizer = null;
            AuditLogger.Instance.Log("system", "stt_unavailable", "info", ex.Message);
        }
    }

    private void ConfigureTimers()
    {
        _clockTimer.Interval = TimeSpan.FromSeconds(1);
        _clockTimer.Tick += (_, _) => CollapsedClockText.Text = DateTime.Now.ToString("HH:mm");
        _clockTimer.Start();
        CollapsedClockText.Text = DateTime.Now.ToString("HH:mm");

        _auroraTimer.Interval = TimeSpan.FromSeconds(4.5);
        _auroraTimer.Tick += (_, _) =>
        {
            if (!_autoAurora) return;
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
                var ts = TimeSpan.FromSeconds(_focusSecondsRemaining);
                FocusTimerText.Text = ts.ToString(@"mm\:ss");
            }
            else
            {
                _focusRunning = false;
                FocusTimerToggleBtn.Content = "Focus";
                SpeakReply("Focus session complete.");
            }
        };
        _focusTimer.Start();
    }

    private void ApplyAuroraTheme(Color primary, Color secondary)
    {
        var duration = TimeSpan.FromMilliseconds(1400);
        AuroraStopPrimary.BeginAnimation(GradientStop.ColorProperty, new ColorAnimation(primary, duration));
        AuroraStopSecondary.BeginAnimation(GradientStop.ColorProperty, new ColorAnimation(secondary, duration));
        CollapsedOrbCore.BeginAnimation(GradientStop.ColorProperty, new ColorAnimation(primary, duration));
        ExpandedOrbCore.BeginAnimation(GradientStop.ColorProperty, new ColorAnimation(primary, duration));
    }

    private void SetExpanded(bool expand)
    {
        if (_isExpanded == expand) return;
        _isExpanded = expand;

        var targetW = expand ? ExpandedWidth : CollapsedWidth;
        var targetH = expand ? ExpandedHeight : CollapsedHeight;
        var area = SystemParameters.WorkArea;
        var targetLeft = area.Left + (area.Width - targetW) / 2.0;

        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        var duration = TimeSpan.FromMilliseconds(220);

        BeginAnimation(WidthProperty, new DoubleAnimation(targetW, duration) { EasingFunction = ease });
        BeginAnimation(HeightProperty, new DoubleAnimation(targetH, duration) { EasingFunction = ease });
        BeginAnimation(LeftProperty, new DoubleAnimation(targetLeft, duration) { EasingFunction = ease });

        NotchShell.CornerRadius = new CornerRadius(expand ? 26 : 22);
        CollapsedPillView.Visibility = expand ? Visibility.Collapsed : Visibility.Visible;
        ExpandedCardView.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;

        if (expand)
        {
            Activate();
            CommandInputBox.Focus();
        }
    }

    private void SpeakReply(string reply)
    {
        if (_ttsMuted || string.IsNullOrWhiteSpace(reply)) return;
        try
        {
            _synthesizer.SpeakAsyncCancelAll();
            _synthesizer.SpeakAsync(reply);
        }
        catch
        {
            // Ignore audio device contention errors
        }
    }

    private async Task ExecuteUserPromptAsync(string prompt)
    {
        if (string.IsNullOrWhiteSpace(prompt)) return;

        VoiceStateSubtitle.Text = "Processing...";
        var result = await _commandParser.ExecuteAsync(prompt);

        AssistantNameText.Text = _commandParser.AssistantName;
        CollapsedStatusText.Text = $"{_commandParser.AssistantName} · Armed";
        AssistantReplyText.Text = result.Reply;
        VoiceStateSubtitle.Text = result.Succeeded ? "Native Win32 · Ready" : "Action blocked by policy";

        if (result.TriggerLockWorkstation)
        {
            StopKeepAwakePatrol();
            NativeInterop.LockWorkstation();
        }
        else if (result.ToggleKeepAwake.HasValue)
        {
            SetKeepAwake(result.ToggleKeepAwake.Value);
        }

        SpeakReply(result.Reply);
    }

    private void SetKeepAwake(bool enabled)
    {
        if (enabled == _keepAwakeActive) return;
        _keepAwakeActive = enabled;
        KeepAwakeButton.Content = enabled ? "Coffee: Always" : "Coffee: Off";

        if (enabled)
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
        else
        {
            StopKeepAwakePatrol();
        }
    }

    private void StopKeepAwakePatrol()
    {
        _keepAwakeActive = false;
        KeepAwakeButton.Content = "Coffee: Off";
        NativeInterop.TriggerEmergencyStop();
        _patrolCts?.Cancel();
        _patrolCts?.Dispose();
        _patrolCts = null;
    }

    // --- UI Event Handlers ---
    private void Window_MouseEnter(object sender, MouseEventArgs e) => SetExpanded(true);

    private void Window_MouseLeave(object sender, MouseEventArgs e)
    {
        if (!CommandInputBox.IsKeyboardFocused && !_isListening)
        {
            SetExpanded(false);
        }
    }

    private void CollapsedPill_Click(object sender, MouseButtonEventArgs e) => SetExpanded(true);
    private void CollapseNotch_Click(object sender, RoutedEventArgs e) => SetExpanded(false);

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            StopKeepAwakePatrol();
            SetExpanded(false);
        }
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

    private void VoiceListen_Click(object sender, RoutedEventArgs e)
    {
        if (_speechRecognizer is null)
        {
            const string msg = "Windows Speech Recognition microphone input is not available on this device.";
            AssistantReplyText.Text = msg;
            SpeakReply(msg);
            return;
        }

        if (_isListening)
        {
            _speechRecognizer.RecognizeAsyncCancel();
            _isListening = false;
            VoiceListenButton.Content = "Mic";
            VoiceStateSubtitle.Text = "Native Win32 · Ready";
        }
        else
        {
            _speechRecognizer.RecognizeAsync(RecognizeMode.Multiple);
            _isListening = true;
            VoiceListenButton.Content = "Listening";
            VoiceStateSubtitle.Text = "Listening via System.Speech...";
            ApplyAuroraTheme(Color.FromRgb(20, 184, 166), Color.FromRgb(56, 189, 248));
        }
    }

    private void ThemeDot_Click(object sender, RoutedEventArgs e)
    {
        if (sender is System.Windows.Controls.Button btn && int.TryParse(btn.Tag?.ToString(), out int idx))
        {
            _autoAurora = false;
            _auroraIndex = Math.Clamp(idx, 0, AuroraThemes.Length - 1);
            ApplyAuroraTheme(AuroraThemes[_auroraIndex].Primary, AuroraThemes[_auroraIndex].Secondary);
            AutoAuroraButton.Content = "Manual";
        }
    }

    private void AutoAurora_Click(object sender, RoutedEventArgs e)
    {
        _autoAurora = !_autoAurora;
        AutoAuroraButton.Content = _autoAurora ? "Auto" : "Manual";
    }

    private void FocusTimerToggle_Click(object sender, RoutedEventArgs e)
    {
        _focusRunning = !_focusRunning;
        FocusTimerToggleBtn.Content = _focusRunning ? "Pause" : "Focus";
    }

    private void KeepAwake_Click(object sender, RoutedEventArgs e) => SetKeepAwake(!_keepAwakeActive);

    private void MuteTts_Click(object sender, RoutedEventArgs e)
    {
        _ttsMuted = !_ttsMuted;
        MuteTtsButton.Content = _ttsMuted ? "Voice: Muted" : "Voice: On";
        if (_ttsMuted) _synthesizer.SpeakAsyncCancelAll();
    }

    private void LockPc_Click(object sender, RoutedEventArgs e)
    {
        StopKeepAwakePatrol();
        AuditLogger.Instance.Log("security", "lock_workstation", "allowed", "Manual LockWorkStation()");
        NativeInterop.LockWorkstation();
    }
}
