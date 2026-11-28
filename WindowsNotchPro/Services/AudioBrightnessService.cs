using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace WindowsNotchPro.Services;

public sealed class AudioBrightnessService
{
    private const int ERender = 0;
    private const int ERoleMultimedia = 1;
    private const uint ClsctxAll = 23;
    private static readonly Guid ClsidMmDeviceEnumerator = new("BCDE0395-E52F-467C-8E3D-C4579291692E");
    private static readonly Guid IidIAudioEndpointVolume = new("5CDF2C82-841E-4546-9722-0CF74078229A");

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        int NotImpl1();
        [PreserveSig]
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig]
        int Activate(ref Guid iid, uint dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [ComImport]
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out uint pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
        [PreserveSig]
        int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
        int GetMasterVolumeLevel(out float pfLevelDB);
        [PreserveSig]
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
        int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
        int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
        int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
        [PreserveSig]
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
        [PreserveSig]
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
    }

    // DDC/CI monitor brightness P/Invoke
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct PhysicalMonitor
    {
        public IntPtr hPhysicalMonitor;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szPhysicalMonitorDescription;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, out uint pdwNumberOfPhysicalMonitors);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, uint dwPhysicalMonitorArraySize, [Out] PhysicalMonitor[] pPhysicalMonitorArray);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool DestroyPhysicalMonitors(uint dwPhysicalMonitorArraySize, [In] PhysicalMonitor[] pPhysicalMonitorArray);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetMonitorBrightness(IntPtr hMonitor, out uint pdwMinimumBrightness, out uint pdwCurrentBrightness, out uint pdwMaximumBrightness);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool SetMonitorBrightness(IntPtr hMonitor, uint dwNewBrightness);

    private int _cachedBrightness = 75;

    public (int VolumePercent, bool IsMuted) GetAudioState()
    {
        IAudioEndpointVolume? vol = null;
        try
        {
            vol = GetEndpointVolume();
            if (vol is null) return (50, false);

            vol.GetMasterVolumeLevelScalar(out float level);
            vol.GetMute(out bool muted);
            return (Math.Clamp((int)Math.Round(level * 100f), 0, 100), muted);
        }
        catch
        {
            return (50, false);
        }
        finally
        {
            if (vol is not null) Marshal.ReleaseComObject(vol);
        }
    }

    public bool SetMasterVolume(int percent)
    {
        IAudioEndpointVolume? vol = null;
        try
        {
            vol = GetEndpointVolume();
            if (vol is null) return false;
            float scalar = Math.Clamp(percent, 0, 100) / 100f;
            return vol.SetMasterVolumeLevelScalar(scalar, Guid.Empty) == 0;
        }
        catch
        {
            return false;
        }
        finally
        {
            if (vol is not null) Marshal.ReleaseComObject(vol);
        }
    }

    public bool SetMute(bool muted)
    {
        IAudioEndpointVolume? vol = null;
        try
        {
            vol = GetEndpointVolume();
            if (vol is null) return false;
            return vol.SetMute(muted, Guid.Empty) == 0;
        }
        catch
        {
            return false;
        }
        finally
        {
            if (vol is not null) Marshal.ReleaseComObject(vol);
        }
    }

    public bool ToggleMute()
    {
        var (_, muted) = GetAudioState();
        SetMute(!muted);
        return !muted;
    }

    public int GetBrightness(IntPtr hwnd)
    {
        try
        {
            var hMon = MonitorFromWindow(hwnd, 2); // MONITOR_DEFAULTTONEAREST
            if (GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out uint count) && count > 0)
            {
                var monitors = new PhysicalMonitor[count];
                if (GetPhysicalMonitorsFromHMONITOR(hMon, count, monitors))
                {
                    try
                    {
                        if (GetMonitorBrightness(monitors[0].hPhysicalMonitor, out uint min, out uint cur, out uint max) && max > min)
                        {
                            _cachedBrightness = (int)Math.Round((cur - min) * 100.0 / (max - min));
                            return Math.Clamp(_cachedBrightness, 0, 100);
                        }
                    }
                    finally
                    {
                        DestroyPhysicalMonitors(count, monitors);
                    }
                }
            }
        }
        catch
        {
            // Fall through to cached brightness
        }
        return _cachedBrightness;
    }

    public void SetBrightnessAsync(IntPtr hwnd, int percent)
    {
        int clamped = Math.Clamp(percent, 5, 100);
        _cachedBrightness = clamped;

        _ = Task.Run(() =>
        {
            // Try hardware DDC/CI first (external monitors)
            try
            {
                var hMon = MonitorFromWindow(hwnd, 2);
                if (GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out uint count) && count > 0)
                {
                    var monitors = new PhysicalMonitor[count];
                    if (GetPhysicalMonitorsFromHMONITOR(hMon, count, monitors))
                    {
                        try
                        {
                            if (GetMonitorBrightness(monitors[0].hPhysicalMonitor, out uint min, out _, out uint max) && max > min)
                            {
                                uint target = min + (uint)Math.Round((max - min) * (clamped / 100.0));
                                if (SetMonitorBrightness(monitors[0].hPhysicalMonitor, target))
                                {
                                    return;
                                }
                            }
                        }
                        finally
                        {
                            DestroyPhysicalMonitors(count, monitors);
                        }
                    }
                }
            }
            catch
            {
                // Fallback to WMI for internal laptop panels
            }

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -NonInteractive -WindowStyle Hidden -Command \"(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,{clamped})\"",
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                using var proc = Process.Start(psi);
                proc?.WaitForExit(1500);
            }
            catch
            {
                // Ignore if display does not expose WMI brightness
            }
        });
    }

    private static IAudioEndpointVolume? GetEndpointVolume()
    {
        var enumType = Type.GetTypeFromCLSID(ClsidMmDeviceEnumerator);
        if (enumType is null) return null;

        var enumeratorObj = Activator.CreateInstance(enumType);
        if (enumeratorObj is not IMMDeviceEnumerator enumerator) return null;

        IMMDevice? device = null;
        try
        {
            if (enumerator.GetDefaultAudioEndpoint(ERender, ERoleMultimedia, out device) != 0 || device is null)
            {
                return null;
            }

            var iid = IidIAudioEndpointVolume;
            if (device.Activate(ref iid, ClsctxAll, IntPtr.Zero, out var volObj) != 0)
            {
                return null;
            }

            return volObj as IAudioEndpointVolume;
        }
        finally
        {
            if (device is not null) Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
        }
    }
}
