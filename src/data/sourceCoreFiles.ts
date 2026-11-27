import type { SourceFileEntry } from "../types/notch";

export const SOURCE_CORE_FILES: SourceFileEntry[] = [
  {
    path: "WindowsNotchPro.csproj",
    group: "WPF Desktop Overlay (.NET 8)",
    language: "xml",
    summary:
      "Self-contained .NET 8 WPF x64 project targeting Windows 10 & 11 with unsafe interop, System.Speech, and NotchNative.dll bundling.",
    content: String.raw`<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <UseWPF>true</UseWPF>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <ApplicationManifest>app.manifest</ApplicationManifest>
    <AssemblyName>WindowsNotchPro</AssemblyName>
    <RootNamespace>WindowsNotchPro</RootNamespace>
    <Version>2.0.0</Version>
    <Company>NOVA Systems</Company>
    <Product>NOVA / WindowsNotch Pro</Product>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>true</SelfContained>
    <PublishSingleFile>true</PublishSingleFile>
    <IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
    <EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
  </PropertyGroup>

  <ItemGroup>
    <!-- Windows Speech Recognition & Text-to-Speech Talk-Back -->
    <PackageReference Include="System.Speech" Version="8.0.0" />
    <!-- Managed Windows DPAPI fallback when NotchNative.dll is not pre-built -->
    <PackageReference Include="System.Security.Cryptography.ProtectedData" Version="8.0.0" />
  </ItemGroup>

  <ItemGroup>
    <!-- Bundle compiled native C Win32 engine beside the executable -->
    <None Include="native\NotchNative.dll" Condition="Exists('native\NotchNative.dll')">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
      <CopyToPublishDirectory>PreserveNewest</CopyToPublishDirectory>
      <Link>NotchNative.dll</Link>
    </None>
  </ItemGroup>

</Project>
`,
  },
  {
    path: "app.manifest",
    group: "WPF Desktop Overlay (.NET 8)",
    language: "xml",
    summary:
      "Per-Monitor V2 DPI awareness, Windows 10 & 11 compatibility GUIDs, and least-privilege asInvoker execution level.",
    content: String.raw`<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="2.0.0.0" name="WindowsNotchPro.app" />

  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2">
    <security>
      <requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
        <!-- Standard user privilege: no unnecessary UAC prompts -->
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>

  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- Windows 10 and Windows 11 -->
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
    </application>
  </compatibility>

  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <!-- Per-Monitor V2 DPI awareness for crisp scaling on 4K & multi-monitor setups -->
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
    </windowsSettings>
  </application>
</assembly>
`,
  },
  {
    path: "App.xaml",
    group: "WPF Desktop Overlay (.NET 8)",
    language: "xaml",
    summary:
      "WPF application theme resources with dark frosted-glass surfaces, crisp Segoe UI Variable typography, and minimal button styles.",
    content: String.raw`<Application x:Class="WindowsNotchPro.App"
             xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
             StartupUri="MainWindow.xaml"
             ShutdownMode="OnMainWindowClose">
    <Application.Resources>
        <SolidColorBrush x:Key="GlassSurfaceBrush" Color="#DE12141C" />
        <SolidColorBrush x:Key="GlassTileBrush" Color="#18FFFFFF" />
        <SolidColorBrush x:Key="GlassBorderBrush" Color="#26FFFFFF" />
        <SolidColorBrush x:Key="PrimaryTextBrush" Color="#F8FAFC" />
        <SolidColorBrush x:Key="MutedTextBrush" Color="#94A3B8" />
        <SolidColorBrush x:Key="AccentCyanBrush" Color="#38BDF8" />
        <SolidColorBrush x:Key="AccentEmeraldBrush" Color="#34D399" />

        <Style x:Key="NotchIconButtonStyle" TargetType="Button">
            <Setter Property="Background" Value="#14FFFFFF" />
            <Setter Property="Foreground" Value="#E2E8F0" />
            <Setter Property="BorderBrush" Value="#20FFFFFF" />
            <Setter Property="BorderThickness" Value="1" />
            <Setter Property="Padding" Value="10,5" />
            <Setter Property="FontSize" Value="11.5" />
            <Setter Property="FontFamily" Value="Segoe UI Variable Text, Segoe UI" />
            <Setter Property="Cursor" Value="Hand" />
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border x:Name="Bd"
                                Background="{TemplateBinding Background}"
                                BorderBrush="{TemplateBinding BorderBrush}"
                                BorderThickness="{TemplateBinding BorderThickness}"
                                CornerRadius="10"
                                Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter TargetName="Bd" Property="Background" Value="#26FFFFFF" />
                                <Setter Property="Foreground" Value="#FFFFFF" />
                            </Trigger>
                            <Trigger Property="IsPressed" Value="True">
                                <Setter TargetName="Bd" Property="Background" Value="#33FFFFFF" />
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>

        <Style x:Key="AuroraDotButtonStyle" TargetType="Button">
            <Setter Property="Width" Value="12" />
            <Setter Property="Height" Value="12" />
            <Setter Property="Cursor" Value="Hand" />
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border x:Name="Dot"
                                Width="10"
                                Height="10"
                                CornerRadius="5"
                                Background="{TemplateBinding Background}"
                                BorderBrush="#66FFFFFF"
                                BorderThickness="1" />
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter TargetName="Dot" Property="Width" Value="12" />
                                <Setter TargetName="Dot" Property="Height" Value="12" />
                                <Setter TargetName="Dot" Property="CornerRadius" Value="6" />
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Application.Resources>
</Application>
`,
  },
  {
    path: "App.xaml.cs",
    group: "WPF Desktop Overlay (.NET 8)",
    language: "csharp",
    summary:
      "Single-instance Mutex guard, unhandled exception auditing, and clean shutdown teardown.",
    content: String.raw`using System;
using System.Threading;
using System.Windows;
using WindowsNotchPro.Services;

namespace WindowsNotchPro;

public partial class App : Application
{
    private Mutex? _singleInstanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        bool createdNew;
        _singleInstanceMutex = new Mutex(true, @"Local\WindowsNotchPro_SingleInstance", out createdNew);

        if (!createdNew)
        {
            MessageBox.Show(
                "NOVA / WindowsNotch Pro is already running at the top of your desktop.",
                "WindowsNotch Pro",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown();
            return;
        }

        DispatcherUnhandledException += (_, args) =>
        {
            AuditLogger.Instance.Log("system", "unhandled_exception", "blocked", args.Exception.Message);
            NativeInterop.TriggerEmergencyStop();
            args.Handled = true;
        };

        base.OnStartup(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        NativeInterop.TriggerEmergencyStop();
        _singleInstanceMutex?.ReleaseMutex();
        _singleInstanceMutex?.Dispose();
        base.OnExit(e);
    }
}
`,
  },
  {
    path: "MainWindow.xaml",
    group: "WPF Desktop Overlay (.NET 8)",
    language: "xaml",
    summary:
      "Frameless, transparent, always-on-top Dynamic Island (248x48 idle pill expanding to dark frosted-glass Bento & conversational AI card with aurora themes).",
    content: String.raw`<Window x:Class="WindowsNotchPro.MainWindow"
        xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="NOVA"
        Width="248"
        Height="48"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        Topmost="True"
        ShowInTaskbar="False"
        ResizeMode="NoResize"
        Loaded="Window_Loaded"
        Closing="Window_Closing"
        KeyDown="Window_KeyDown"
        MouseEnter="Window_MouseEnter"
        MouseLeave="Window_MouseLeave">

    <!-- Outer Padding holds subtle glow without clipping -->
    <Grid Margin="6">
        <Border x:Name="NotchShell"
                CornerRadius="22"
                Background="{StaticResource GlassSurfaceBrush}"
                BorderBrush="{StaticResource GlassBorderBrush}"
                BorderThickness="1"
                SnapsToDevicePixels="True"
                ClipToBounds="True">
            <Border.Effect>
                <DropShadowEffect BlurRadius="22" ShadowDepth="6" Opacity="0.58" Color="#000000" />
            </Border.Effect>

            <Grid>
                <!-- Animated Aurora Ambient Background Glow -->
                <Border x:Name="AuroraBackdrop" Opacity="0.42" IsHitTestVisible="False">
                    <Border.Background>
                        <RadialGradientBrush Center="0.22,0.12" GradientOrigin="0.22,0.12" RadiusX="0.95" RadiusY="1.15">
                            <GradientStop x:Name="AuroraStopPrimary" Color="#38BDF8" Offset="0.0" />
                            <GradientStop x:Name="AuroraStopSecondary" Color="#8B5CF6" Offset="0.48" />
                            <GradientStop Color="#0012141C" Offset="1.0" />
                        </RadialGradientBrush>
                    </Border.Background>
                </Border>

                <!-- 1. COLLAPSED IDLE PILL (248x48) -->
                <Grid x:Name="CollapsedPillView"
                      Height="36"
                      Margin="10,0"
                      VerticalAlignment="Center"
                      Cursor="Hand"
                      MouseLeftButtonUp="CollapsedPill_Click">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="Auto" />
                        <ColumnDefinition Width="*" />
                        <ColumnDefinition Width="Auto" />
                    </Grid.ColumnDefinitions>

                    <!-- Glowing Optical AI Orb -->
                    <Grid Grid.Column="0" Width="22" Height="22" VerticalAlignment="Center">
                        <Ellipse x:Name="CollapsedOrbGlow" Fill="#6638BDF8" Width="22" Height="22">
                            <Ellipse.Effect>
                                <BlurEffect Radius="8" />
                            </Ellipse.Effect>
                        </Ellipse>
                        <Ellipse Width="12" Height="12" Stroke="#99FFFFFF" StrokeThickness="1">
                            <Ellipse.Fill>
                                <RadialGradientBrush>
                                    <GradientStop Color="#FFFFFF" Offset="0.0" />
                                    <GradientStop x:Name="CollapsedOrbCore" Color="#38BDF8" Offset="0.65" />
                                    <GradientStop Color="#0F172A" Offset="1.0" />
                                </RadialGradientBrush>
                            </Ellipse.Fill>
                        </Ellipse>
                    </Grid>

                    <TextBlock x:Name="CollapsedStatusText"
                               Grid.Column="1"
                               Margin="9,0,8,0"
                               VerticalAlignment="Center"
                               Text="NOVA · Armed"
                               Foreground="{StaticResource PrimaryTextBrush}"
                               FontFamily="Segoe UI Variable Text, Segoe UI"
                               FontSize="12"
                               FontWeight="SemiBold"
                               TextTrimming="CharacterEllipsis" />

                    <TextBlock x:Name="CollapsedClockText"
                               Grid.Column="2"
                               VerticalAlignment="Center"
                               Text="12:00"
                               Foreground="{StaticResource MutedTextBrush}"
                               FontFamily="Cascadia Mono, Consolas"
                               FontSize="11" />
                </Grid>

                <!-- 2. EXPANDED FROSTED-GLASS BENTO & CONVERSATIONAL AI CARD -->
                <Grid x:Name="ExpandedCardView" Visibility="Collapsed" Margin="18,14">
                    <Grid.RowDefinitions>
                        <RowDefinition Height="Auto" />
                        <RowDefinition Height="Auto" />
                        <RowDefinition Height="*" />
                        <RowDefinition Height="Auto" />
                    </Grid.RowDefinitions>

                    <!-- Header: Glowing Orb + Name + Aurora Theme Switcher + Voice + Collapse -->
                    <Grid Grid.Row="0" Margin="0,0,0,12">
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="Auto" />
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="Auto" />
                        </Grid.ColumnDefinitions>

                        <StackPanel Grid.Column="0" Orientation="Horizontal" VerticalAlignment="Center">
                            <Grid Width="24" Height="24" Margin="0,0,10,0">
                                <Ellipse x:Name="ExpandedOrbGlow" Fill="#7738BDF8" Width="24" Height="24">
                                    <Ellipse.Effect>
                                        <BlurEffect Radius="10" />
                                    </Ellipse.Effect>
                                </Ellipse>
                                <Ellipse Width="13" Height="13" Stroke="#B3FFFFFF" StrokeThickness="1">
                                    <Ellipse.Fill>
                                        <RadialGradientBrush>
                                            <GradientStop Color="#FFFFFF" Offset="0.0" />
                                            <GradientStop x:Name="ExpandedOrbCore" Color="#38BDF8" Offset="0.7" />
                                            <GradientStop Color="#0F172A" Offset="1.0" />
                                        </RadialGradientBrush>
                                    </Ellipse.Fill>
                                </Ellipse>
                            </Grid>

                            <StackPanel VerticalAlignment="Center">
                                <TextBlock x:Name="AssistantNameText"
                                           Text="NOVA"
                                           Foreground="#FFFFFF"
                                           FontFamily="Segoe UI Variable Display, Segoe UI"
                                           FontSize="13.5"
                                           FontWeight="SemiBold" />
                                <TextBlock x:Name="VoiceStateSubtitle"
                                           Text="Native Win32 · Ready"
                                           Foreground="{StaticResource MutedTextBrush}"
                                           FontSize="10.5" />
                            </StackPanel>
                        </StackPanel>

                        <!-- Aurora Theme Dots + Mic + Collapse -->
                        <StackPanel Grid.Column="2" Orientation="Horizontal" VerticalAlignment="Center">
                            <StackPanel Orientation="Horizontal" VerticalAlignment="Center" Margin="0,0,12,0">
                                <Button Style="{StaticResource AuroraDotButtonStyle}" Background="#38BDF8" ToolTip="Aurora Cyan-Violet" Tag="0" Click="ThemeDot_Click" Margin="0,0,5,0" />
                                <Button Style="{StaticResource AuroraDotButtonStyle}" Background="#EC4899" ToolTip="Rose-Magenta" Tag="1" Click="ThemeDot_Click" Margin="0,0,5,0" />
                                <Button Style="{StaticResource AuroraDotButtonStyle}" Background="#34D399" ToolTip="Emerald Pulse" Tag="2" Click="ThemeDot_Click" Margin="0,0,5,0" />
                                <Button Style="{StaticResource AuroraDotButtonStyle}" Background="#F59E0B" ToolTip="Solar Amber" Tag="3" Click="ThemeDot_Click" Margin="0,0,6,0" />
                                <Button x:Name="AutoAuroraButton"
                                        Style="{StaticResource NotchIconButtonStyle}"
                                        Content="Auto"
                                        Padding="7,2"
                                        FontSize="10"
                                        Click="AutoAurora_Click" />
                            </StackPanel>

                            <Button x:Name="VoiceListenButton"
                                    Style="{StaticResource NotchIconButtonStyle}"
                                    Content="Mic"
                                    Click="VoiceListen_Click"
                                    Margin="0,0,6,0" />

                            <Button Style="{StaticResource NotchIconButtonStyle}"
                                    Content="Hide"
                                    Click="CollapseNotch_Click" />
                        </StackPanel>
                    </Grid>

                    <!-- Clean Conversational Prompt Bar -->
                    <Border Grid.Row="1"
                            CornerRadius="14"
                            Background="#24000000"
                            BorderBrush="#22FFFFFF"
                            BorderThickness="1"
                            Padding="12,6"
                            Margin="0,0,0,12">
                        <Grid>
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="*" />
                                <ColumnDefinition Width="Auto" />
                            </Grid.ColumnDefinitions>

                            <TextBox x:Name="CommandInputBox"
                                     Grid.Column="0"
                                     Background="Transparent"
                                     BorderThickness="0"
                                     Foreground="#FFFFFF"
                                     CaretBrush="#38BDF8"
                                     FontFamily="Segoe UI Variable Text, Segoe UI"
                                     FontSize="13"
                                     VerticalContentAlignment="Center"
                                     KeyDown="CommandInputBox_KeyDown" />

                            <TextBlock x:Name="CommandPlaceholder"
                                       Grid.Column="0"
                                       Text="Ask Notch AI anything..."
                                       Foreground="#64748B"
                                       FontSize="13"
                                       VerticalAlignment="Center"
                                       IsHitTestVisible="False" />

                            <Button Grid.Column="1"
                                    Style="{StaticResource NotchIconButtonStyle}"
                                    Content="Ask"
                                    Padding="12,5"
                                    Background="#2E38BDF8"
                                    BorderBrush="#5538BDF8"
                                    Foreground="#FFFFFF"
                                    Click="SubmitCommand_Click" />
                        </Grid>
                    </Border>

                    <!-- Conversational Spoken Reply Panel -->
                    <Border Grid.Row="2"
                            CornerRadius="14"
                            Background="#14FFFFFF"
                            BorderBrush="#18FFFFFF"
                            BorderThickness="1"
                            Padding="13,10"
                            Margin="0,0,0,12">
                        <ScrollViewer VerticalScrollBarVisibility="Auto">
                            <TextBlock x:Name="AssistantReplyText"
                                       Text="Ready. Ask me to open or close apps, manage Desktop/Documents/Downloads folders, keep your PC awake, or lock your workstation."
                                       Foreground="#E2E8F0"
                                       FontFamily="Segoe UI Variable Text, Segoe UI"
                                       FontSize="12.5"
                                       LineHeight="19"
                                       TextWrapping="Wrap" />
                        </ScrollViewer>
                    </Border>

                    <!-- Compact Bento Telemetry & Essential Controls (No Cluttered Icon Rows) -->
                    <Grid Grid.Row="3">
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="Auto" />
                            <ColumnDefinition Width="Auto" />
                            <ColumnDefinition Width="Auto" />
                        </Grid.ColumnDefinitions>

                        <Border Grid.Column="0"
                                CornerRadius="11"
                                Background="#12FFFFFF"
                                Padding="10,6"
                                Margin="0,0,8,0">
                            <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
                                <TextBlock x:Name="FocusTimerText"
                                           Text="25:00"
                                           Foreground="{StaticResource AccentEmeraldBrush}"
                                           FontFamily="Cascadia Mono, Consolas"
                                           FontWeight="SemiBold"
                                           FontSize="12"
                                           VerticalAlignment="Center"
                                           Margin="0,0,8,0" />
                                <Button x:Name="FocusTimerToggleBtn"
                                        Style="{StaticResource NotchIconButtonStyle}"
                                        Content="Focus"
                                        Padding="8,3"
                                        FontSize="10.5"
                                        Click="FocusTimerToggle_Click" />
                            </StackPanel>
                        </Border>

                        <Button x:Name="KeepAwakeButton"
                                Grid.Column="1"
                                Style="{StaticResource NotchIconButtonStyle}"
                                Content="Coffee: Off"
                                Click="KeepAwake_Click"
                                Margin="0,0,8,0" />

                        <Button x:Name="MuteTtsButton"
                                Grid.Column="2"
                                Style="{StaticResource NotchIconButtonStyle}"
                                Content="Voice: On"
                                Click="MuteTts_Click"
                                Margin="0,0,8,0" />

                        <Button Grid.Column="3"
                                Style="{StaticResource NotchIconButtonStyle}"
                                Content="Lock PC"
                                Background="#26F43F5E"
                                BorderBrush="#44F43F5E"
                                Click="LockPc_Click" />
                    </Grid>
                </Grid>
            </Grid>
        </Border>
    </Grid>
</Window>
`,
  },
  {
    path: "MainWindow.xaml.cs",
    group: "WPF Desktop Overlay (.NET 8)",
    language: "csharp",
    summary:
      "Top-center DPI-aware anchoring, smooth pill-to-Bento animation, auto-cycling aurora colors, two-way System.Speech voice talk-back, and local Companion Server wiring.",
    content: String.raw`using System;
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
`,
  },
  {
    path: "native/notch_native.h",
    group: "Native C Win32 Engine (NotchNative.dll)",
    language: "c",
    summary:
      "C ABI header for NotchNative.dll exporting Win32 smooth mouse control, emergency stop, LockWorkStation, DWM rounded corners, DPAPI, and restricted Named Pipe helpers.",
    content: String.raw`#ifndef NOTCH_NATIVE_H
#define NOTCH_NATIVE_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stddef.h>
#include <stdint.h>

#ifdef NOTCH_NATIVE_EXPORTS
#define NOTCH_API __declspec(dllexport)
#else
#define NOTCH_API __declspec(dllimport)
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* Status codes */
#define NOTCH_OK                0
#define NOTCH_ERR_INVALID_ARG  -1
#define NOTCH_ERR_STOPPED      -2
#define NOTCH_ERR_WIN32        -3
#define NOTCH_ERR_BUFFER_SMALL -4

/* Mouse buttons */
#define NOTCH_MOUSE_LEFT        0
#define NOTCH_MOUSE_RIGHT       1
#define NOTCH_MOUSE_DOUBLE_LEFT 2

/* DWM corner preferences (Windows 11 DWMWA_WINDOW_CORNER_PREFERENCE = 33) */
#define NOTCH_DWMWCP_DEFAULT    0
#define NOTCH_DWMWCP_DONOTROUND 1
#define NOTCH_DWMWCP_ROUND      2
#define NOTCH_DWMWCP_ROUNDSMALL 3

/* Smooth ease-in-out mouse movement & clicks with atomic emergency stop */
NOTCH_API int  notch_mouse_move_smooth(int target_x, int target_y, int duration_ms);
NOTCH_API int  notch_mouse_click(int button);
NOTCH_API void notch_mouse_emergency_stop(void);
NOTCH_API void notch_mouse_reset_stop(void);
NOTCH_API int  notch_mouse_is_stopped(void);

/* Workstation lock & Windows 11 DWM rounded corners */
NOTCH_API int  notch_lock_workstation(void);
NOTCH_API int  notch_set_window_rounded_corners(HWND hwnd, int preference);

/* Windows DPAPI (CryptProtectData / CryptUnprotectData) */
NOTCH_API int  notch_dpapi_protect(
    const uint8_t* plaintext,
    uint32_t plaintext_len,
    uint8_t** out_cipher,
    uint32_t* out_cipher_len);

NOTCH_API int  notch_dpapi_unprotect(
    const uint8_t* cipher,
    uint32_t cipher_len,
    uint8_t** out_plaintext,
    uint32_t* out_plaintext_len);

NOTCH_API void notch_dpapi_free(uint8_t* buffer, uint32_t length);

/* Restricted Named Pipe (\\.\pipe\WindowsNotchUnlock) for Session-0 Unlock */
NOTCH_API int  notch_pipe_create_restricted_server(const wchar_t* pipe_name, HANDLE* out_handle);
NOTCH_API int  notch_pipe_send_unlock_request(
    const wchar_t* pipe_name,
    const char* payload,
    uint32_t payload_len,
    char* response_buf,
    uint32_t response_cap,
    uint32_t* out_response_len);

#ifdef __cplusplus
}
#endif

#endif /* NOTCH_NATIVE_H */
`,
  },
  {
    path: "native/notch_native.c",
    group: "Native C Win32 Engine (NotchNative.dll)",
    language: "c",
    summary:
      "Native C11 Win32 implementation of SendInput smooth mouse control, DWMWA_WINDOW_CORNER_PREFERENCE, CryptProtectData DPAPI sealing, and SDDL-protected Named Pipes.",
    content: String.raw`#define NOTCH_NATIVE_EXPORTS
#include "notch_native.h"

#include <wincrypt.h>
#include <sddl.h>
#include <math.h>
#include <string.h>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "advapi32.lib")

/* Atomic emergency stop flag polled on every mouse interpolation frame */
static volatile LONG g_emergency_stop = 0;

static double ease_in_out_cubic(double t)
{
    if (t < 0.5)
    {
        return 4.0 * t * t * t;
    }
    double f = -2.0 * t + 2.0;
    return 1.0 - (f * f * f) / 2.0;
}

NOTCH_API void notch_mouse_emergency_stop(void)
{
    InterlockedExchange(&g_emergency_stop, 1);
}

NOTCH_API void notch_mouse_reset_stop(void)
{
    InterlockedExchange(&g_emergency_stop, 0);
}

NOTCH_API int notch_mouse_is_stopped(void)
{
    return (int)InterlockedCompareExchange(&g_emergency_stop, 0, 0);
}

NOTCH_API int notch_mouse_move_smooth(int target_x, int target_y, int duration_ms)
{
    if (notch_mouse_is_stopped())
    {
        return NOTCH_ERR_STOPPED;
    }

    POINT start = {0, 0};
    if (!GetCursorPos(&start))
    {
        return NOTCH_ERR_WIN32;
    }

    if (duration_ms <= 0)
    {
        duration_ms = 240;
    }

    const int step_ms = 8;
    int steps = duration_ms / step_ms;
    if (steps < 1) steps = 1;
    if (steps > 400) steps = 400;

    for (int i = 1; i <= steps; ++i)
    {
        if (notch_mouse_is_stopped())
        {
            return NOTCH_ERR_STOPPED;
        }

        double progress = (double)i / (double)steps;
        double eased = ease_in_out_cubic(progress);

        int next_x = start.x + (int)llround((double)(target_x - start.x) * eased);
        int next_y = start.y + (int)llround((double)(target_y - start.y) * eased);

        SetCursorPos(next_x, next_y);
        Sleep((DWORD)step_ms);
    }

    return NOTCH_OK;
}

static int send_single_click(DWORD down_flag, DWORD up_flag)
{
    INPUT inputs[2];
    ZeroMemory(inputs, sizeof(inputs));

    inputs[0].type = INPUT_MOUSE;
    inputs[0].mi.dwFlags = down_flag;

    inputs[1].type = INPUT_MOUSE;
    inputs[1].mi.dwFlags = up_flag;

    UINT sent = SendInput(2, inputs, sizeof(INPUT));
    return (sent == 2) ? NOTCH_OK : NOTCH_ERR_WIN32;
}

NOTCH_API int notch_mouse_click(int button)
{
    if (notch_mouse_is_stopped())
    {
        return NOTCH_ERR_STOPPED;
    }

    switch (button)
    {
        case NOTCH_MOUSE_LEFT:
            return send_single_click(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);

        case NOTCH_MOUSE_RIGHT:
            return send_single_click(MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP);

        case NOTCH_MOUSE_DOUBLE_LEFT:
        {
            int rc = send_single_click(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
            if (rc != NOTCH_OK) return rc;
            Sleep(45);
            if (notch_mouse_is_stopped()) return NOTCH_ERR_STOPPED;
            return send_single_click(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
        }

        default:
            return NOTCH_ERR_INVALID_ARG;
    }
}

NOTCH_API int notch_lock_workstation(void)
{
    return LockWorkStation() ? NOTCH_OK : NOTCH_ERR_WIN32;
}

typedef HRESULT (WINAPI *PFN_DwmSetWindowAttribute)(HWND, DWORD, LPCVOID, DWORD);

NOTCH_API int notch_set_window_rounded_corners(HWND hwnd, int preference)
{
    if (!hwnd)
    {
        return NOTCH_ERR_INVALID_ARG;
    }

    /* Dynamically load dwmapi.dll so Windows 10 gracefully skips DWMWA_WINDOW_CORNER_PREFERENCE */
    HMODULE dwm = LoadLibraryW(L"dwmapi.dll");
    if (!dwm)
    {
        return NOTCH_ERR_WIN32;
    }

    PFN_DwmSetWindowAttribute pDwmSetAttr =
        (PFN_DwmSetWindowAttribute)GetProcAddress(dwm, "DwmSetWindowAttribute");

    int status = NOTCH_ERR_WIN32;
    if (pDwmSetAttr)
    {
        const DWORD DWMWA_WINDOW_CORNER_PREFERENCE_ID = 33;
        DWORD pref = (DWORD)preference;
        HRESULT hr = pDwmSetAttr(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE_ID, &pref, sizeof(pref));
        status = SUCCEEDED(hr) ? NOTCH_OK : NOTCH_ERR_WIN32;
    }

    FreeLibrary(dwm);
    return status;
}

NOTCH_API int notch_dpapi_protect(
    const uint8_t* plaintext,
    uint32_t plaintext_len,
    uint8_t** out_cipher,
    uint32_t* out_cipher_len)
{
    if (!plaintext || plaintext_len == 0 || !out_cipher || !out_cipher_len)
    {
        return NOTCH_ERR_INVALID_ARG;
    }

    DATA_BLOB input_blob;
    input_blob.pbData = (BYTE*)plaintext;
    input_blob.cbData = plaintext_len;

    DATA_BLOB output_blob = {0, NULL};
    BOOL ok = CryptProtectData(
        &input_blob,
        L"WindowsNotchPro_Vault",
        NULL,
        NULL,
        NULL,
        CRYPTPROTECT_UI_FORBIDDEN,
        &output_blob);

    if (!ok)
    {
        return NOTCH_ERR_WIN32;
    }

    *out_cipher = (uint8_t*)output_blob.pbData;
    *out_cipher_len = (uint32_t)output_blob.cbData;
    return NOTCH_OK;
}

NOTCH_API int notch_dpapi_unprotect(
    const uint8_t* cipher,
    uint32_t cipher_len,
    uint8_t** out_plaintext,
    uint32_t* out_plaintext_len)
{
    if (!cipher || cipher_len == 0 || !out_plaintext || !out_plaintext_len)
    {
        return NOTCH_ERR_INVALID_ARG;
    }

    DATA_BLOB input_blob;
    input_blob.pbData = (BYTE*)cipher;
    input_blob.cbData = cipher_len;

    DATA_BLOB output_blob = {0, NULL};
    BOOL ok = CryptUnprotectData(
        &input_blob,
        NULL,
        NULL,
        NULL,
        NULL,
        CRYPTPROTECT_UI_FORBIDDEN,
        &output_blob);

    if (!ok)
    {
        return NOTCH_ERR_WIN32;
    }

    *out_plaintext = (uint8_t*)output_blob.pbData;
    *out_plaintext_len = (uint32_t)output_blob.cbData;
    return NOTCH_OK;
}

NOTCH_API void notch_dpapi_free(uint8_t* buffer, uint32_t length)
{
    if (buffer)
    {
        if (length > 0)
        {
            SecureZeroMemory(buffer, length);
        }
        LocalFree(buffer);
    }
}

NOTCH_API int notch_pipe_create_restricted_server(const wchar_t* pipe_name, HANDLE* out_handle)
{
    if (!pipe_name || !out_handle)
    {
        return NOTCH_ERR_INVALID_ARG;
    }

    /* Strict DACL: LocalSystem (SY), Administrators (BA), Interactive User (IU) only */
    const wchar_t* sddl = L"D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)";
    PSECURITY_DESCRIPTOR sd = NULL;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl,
            SDDL_REVISION_1,
            &sd,
            NULL))
    {
        return NOTCH_ERR_WIN32;
    }

    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(SECURITY_ATTRIBUTES);
    sa.lpSecurityDescriptor = sd;
    sa.bInheritHandle = FALSE;

    HANDLE pipe = CreateNamedPipeW(
        pipe_name,
        PIPE_ACCESS_DUPLEX,
        PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
        1,
        4096,
        4096,
        2000,
        &sa);

    LocalFree(sd);

    if (pipe == INVALID_HANDLE_VALUE)
    {
        return NOTCH_ERR_WIN32;
    }

    *out_handle = pipe;
    return NOTCH_OK;
}

NOTCH_API int notch_pipe_send_unlock_request(
    const wchar_t* pipe_name,
    const char* payload,
    uint32_t payload_len,
    char* response_buf,
    uint32_t response_cap,
    uint32_t* out_response_len)
{
    if (!pipe_name || !payload || payload_len == 0 || !response_buf || response_cap == 0 || !out_response_len)
    {
        return NOTCH_ERR_INVALID_ARG;
    }

    if (!WaitNamedPipeW(pipe_name, 1500))
    {
        return NOTCH_ERR_WIN32;
    }

    HANDLE pipe = CreateFileW(
        pipe_name,
        GENERIC_READ | GENERIC_WRITE,
        0,
        NULL,
        OPEN_EXISTING,
        0,
        NULL);

    if (pipe == INVALID_HANDLE_VALUE)
    {
        return NOTCH_ERR_WIN32;
    }

    DWORD mode = PIPE_READMODE_MESSAGE;
    SetNamedPipeHandleState(pipe, &mode, NULL, NULL);

    DWORD written = 0;
    BOOL ok = WriteFile(pipe, payload, payload_len, &written, NULL);
    if (!ok || written != payload_len)
    {
        CloseHandle(pipe);
        return NOTCH_ERR_WIN32;
    }

    DWORD bytes_read = 0;
    ok = ReadFile(pipe, response_buf, response_cap - 1, &bytes_read, NULL);
    CloseHandle(pipe);

    if (!ok)
    {
        return NOTCH_ERR_WIN32;
    }

    response_buf[bytes_read] = '\0';
    *out_response_len = (uint32_t)bytes_read;
    return NOTCH_OK;
}
`,
  },
  {
    path: "native/credential_provider_skeleton.cpp",
    group: "Native C Win32 Engine (NotchNative.dll)",
    language: "cpp",
    summary:
      "Session-0 Winlogon ICredentialProvider COM DLL skeleton consuming \\\\.\\pipe\\WindowsNotchUnlock and zeroing plaintext credentials via SecureZeroMemory.",
    content: String.raw`// WindowsNotchPro Session-0 ICredentialProvider COM Skeleton (x64)
// Register CLSID under:
//   HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\Credential Providers\{YOUR-GUID}
//
// Security Architecture:
//   1. Never stores plaintext passwords on disk.
//   2. Listens on restricted SDDL Named Pipe \\.\pipe\WindowsNotchUnlock created via notch_native.h.
//   3. Receives verified 2FA unlock assertion from LocalSystem companion service,
//      unseals DPAPI envelope, serializes KERB_INTERACTIVE_UNLOCK_LOGON, and wipes memory.

#include <windows.h>
#include <credentialprovider.h>
#include <ntsecapi.h>
#include <shlwapi.h>
#include <strsafe.h>
#include "notch_native.h"

static const wchar_t* kUnlockPipeName = L"\\\\.\\pipe\\WindowsNotchUnlock";

class CNotchVoiceCredential final : public ICredentialProviderCredential
{
public:
    CNotchVoiceCredential() : _refCount(1) {}

    // IUnknown
    IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&_refCount); }
    IFACEMETHODIMP_(ULONG) Release() override
    {
        LONG c = InterlockedDecrement(&_refCount);
        if (c == 0) delete this;
        return c;
    }

    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override
    {
        static const QITAB qit[] = {
            QITABENT(CNotchVoiceCredential, ICredentialProviderCredential),
            {0}
        };
        return QISearch(this, qit, riid, ppv);
    }

    // Minimal ICredentialProviderCredential contract
    IFACEMETHODIMP Advise(ICredentialProviderCredentialEvents*) override { return S_OK; }
    IFACEMETHODIMP UnAdvise() override { return S_OK; }
    IFACEMETHODIMP SetSelected(BOOL* pbAutoLogon) override { *pbAutoLogon = FALSE; return S_OK; }
    IFACEMETHODIMP SetDeselected() override { return S_OK; }
    IFACEMETHODIMP GetFieldState(DWORD, CREDENTIAL_PROVIDER_FIELD_STATE* pfs, CREDENTIAL_PROVIDER_FIELD_INTERACTIVE_STATE* pfis) override
    {
        *pfs = CPFS_DISPLAY_IN_BOTH;
        *pfis = CPFIS_NONE;
        return S_OK;
    }
    IFACEMETHODIMP GetStringValue(DWORD, PWSTR* ppwsz) override
    {
        return SHStrDupW(L"NOVA 2FA Voice Unlock", ppwsz);
    }
    IFACEMETHODIMP GetBitmapValue(DWORD, HBITMAP* phbmp) override { *phbmp = nullptr; return E_NOTIMPL; }
    IFACEMETHODIMP GetCheckboxValue(DWORD, BOOL*, PWSTR*) override { return E_NOTIMPL; }
    IFACEMETHODIMP GetSubmitButtonValue(DWORD, DWORD* pdwAdjacentTo) override { *pdwAdjacentTo = 0; return S_OK; }
    IFACEMETHODIMP GetComboBoxValueCount(DWORD, DWORD*, DWORD*) override { return E_NOTIMPL; }
    IFACEMETHODIMP GetComboBoxValueAt(DWORD, DWORD, PWSTR*) override { return E_NOTIMPL; }
    IFACEMETHODIMP SetStringValue(DWORD, PCWSTR) override { return S_OK; }
    IFACEMETHODIMP SetCheckboxValue(DWORD, BOOL) override { return E_NOTIMPL; }
    IFACEMETHODIMP SetComboBoxSelectedValue(DWORD, DWORD) override { return E_NOTIMPL; }
    IFACEMETHODIMP CommandLinkClicked(DWORD) override { return E_NOTIMPL; }
    IFACEMETHODIMP ReportResult(NTSTATUS, NTSTATUS, PWSTR*, CREDENTIAL_PROVIDER_STATUS_ICON*) override { return S_OK; }

    IFACEMETHODIMP GetSerialization(
        CREDENTIAL_PROVIDER_GET_SERIALIZATION_RESPONSE* pcpgsr,
        CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION* pcpcs,
        PWSTR* ppwszOptionalStatusText,
        CREDENTIAL_PROVIDER_STATUS_ICON* pcpsiOptionalStatusIcon) override
    {
        *pcpgsr = CPGSR_NO_CREDENTIAL_NOT_FINISHED;
        *ppwszOptionalStatusText = nullptr;
        *pcpsiOptionalStatusIcon = CPSI_NONE;

        // Query Session-0 service via restricted SDDL Named Pipe
        const char* probe = "{\"cmd\":\"fetch_verified_unlock_blob\"}";
        char resp[2048] = {0};
        uint32_t respLen = 0;

        int rc = notch_pipe_send_unlock_request(
            kUnlockPipeName,
            probe,
            (uint32_t)lstrlenA(probe),
            resp,
            sizeof(resp),
            &respLen);

        if (rc != NOTCH_OK || respLen == 0)
        {
            SHStrDupW(L"Waiting for 2FA voice & passphrase verification...", ppwszOptionalStatusText);
            return S_OK;
        }

        // Production builds pack KERB_INTERACTIVE_UNLOCK_LOGON here via CredPackAuthenticationBufferW
        // using the DPAPI-unsealed domain/user/password, then immediately scrub memory:
        SecureZeroMemory(resp, sizeof(resp));
        (void)pcpcs;
        *pcpgsr = CPGSR_NO_CREDENTIAL_FINISHED;
        return S_OK;
    }

private:
    LONG _refCount;
};
`,
  },
];
