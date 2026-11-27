using System;
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
