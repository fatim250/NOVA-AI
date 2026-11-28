using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace WindowsNotchPro.Services;

public sealed class TrayIconService : IDisposable
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    private readonly NotifyIcon _notifyIcon;
    private readonly IntPtr _iconHandle;

    public event Action? ToggleNotchRequested;
    public event Action<string>? OpenTabRequested;
    public event Action? ToggleKeepAwakeRequested;
    public event Action? LockPcRequested;
    public event Action? ExitRequested;

    public TrayIconService()
    {
        var (icon, handle) = CreateOrbIcon();
        _iconHandle = handle;

        var menu = new ContextMenuStrip();
        menu.Items.Add("Toggle NOVA Notch", null, (_, _) => ToggleNotchRequested?.Invoke());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("AI Assistant", null, (_, _) => OpenTabRequested?.Invoke("ai"));
        menu.Items.Add("Media & Audio Hub", null, (_, _) => OpenTabRequested?.Invoke("media"));
        menu.Items.Add("System Monitor", null, (_, _) => OpenTabRequested?.Invoke("system"));
        menu.Items.Add("File Shelf & Clipboard", null, (_, _) => OpenTabRequested?.Invoke("shelf"));
        menu.Items.Add("Settings", null, (_, _) => OpenTabRequested?.Invoke("settings"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Toggle Keep-Awake", null, (_, _) => ToggleKeepAwakeRequested?.Invoke());
        menu.Items.Add("Lock Workstation", null, (_, _) => LockPcRequested?.Invoke());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit NOVA", null, (_, _) => ExitRequested?.Invoke());

        _notifyIcon = new NotifyIcon
        {
            Icon = icon,
            Text = "NOVA Dynamic Island",
            Visible = true,
            ContextMenuStrip = menu
        };

        _notifyIcon.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left)
            {
                ToggleNotchRequested?.Invoke();
            }
        };
    }

    public void ShowBalloon(string title, string message)
    {
        try
        {
            _notifyIcon.ShowBalloonTip(2500, title, message, ToolTipIcon.None);
        }
        catch
        {
            // Ignore shell notification failures
        }
    }

    private static (Icon Icon, IntPtr Handle) CreateOrbIcon()
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            using var bgBrush = new SolidBrush(Color.FromArgb(230, 15, 23, 42));
            g.FillEllipse(bgBrush, 1, 1, 30, 30);

            using var path = new GraphicsPath();
            path.AddEllipse(5, 5, 22, 22);
            using var orbBrush = new PathGradientBrush(path)
            {
                CenterColor = Color.FromArgb(255, 224, 242, 254),
                SurroundColors = new[] { Color.FromArgb(255, 56, 189, 248) }
            };
            g.FillEllipse(orbBrush, 5, 5, 22, 22);

            using var ringPen = new Pen(Color.FromArgb(200, 139, 92, 246), 2f);
            g.DrawEllipse(ringPen, 3, 3, 26, 26);
        }

        IntPtr hIcon = bmp.GetHicon();
        return (Icon.FromHandle(hIcon), hIcon);
    }

    public void Dispose()
    {
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        if (_iconHandle != IntPtr.Zero)
        {
            DestroyIcon(_iconHandle);
        }
    }
}
