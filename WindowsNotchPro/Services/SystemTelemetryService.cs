using System;
using System.Collections.Generic;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;

namespace WindowsNotchPro.Services;

public sealed record SystemSnapshot(
    double CpuPercent,
    double RamPercent,
    double RamUsedGb,
    double RamTotalGb,
    int BatteryPercent,
    bool IsCharging,
    bool HasBattery,
    double NetDownMbps,
    double NetUpMbps,
    bool IsNetworkConnected,
    TimeSpan Uptime,
    IReadOnlyList<double> CpuHistory);

public sealed class SystemTelemetryService
{
    private const uint EsContinuous = 0x80000000;
    private const uint EsSystemRequired = 0x00000001;
    private const uint EsDisplayRequired = 0x00000002;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint LowDateTime;
        public uint HighDateTime;
        public ulong ToUInt64() => ((ulong)HighDateTime << 32) | LowDateTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MemoryStatusEx
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SystemPowerStatus
    {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte SystemStatusFlag;
        public int BatteryLifeTime;
        public int BatteryFullLifeTime;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemTimes(out FileTime idleTime, out FileTime kernelTime, out FileTime userTime);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx lpBuffer);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemPowerStatus(out SystemPowerStatus lpSystemPowerStatus);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SetThreadExecutionState(uint esFlags);

    private ulong _prevIdle;
    private ulong _prevKernel;
    private ulong _prevUser;
    private bool _hasCpuBaseline;

    private long _prevBytesReceived;
    private long _prevBytesSent;
    private DateTime _prevNetTime = DateTime.UtcNow;
    private bool _hasNetBaseline;

    private readonly Queue<double> _cpuHistory = new();
    private const int HistoryCapacity = 24;

    public SystemSnapshot Capture()
    {
        double cpu = SampleCpu();
        if (_cpuHistory.Count >= HistoryCapacity) _cpuHistory.Dequeue();
        _cpuHistory.Enqueue(cpu);

        var (ramPct, ramUsed, ramTotal) = SampleMemory();
        var (batPct, charging, hasBattery) = SampleBattery();
        var (downMbps, upMbps, connected) = SampleNetwork();
        var uptime = TimeSpan.FromMilliseconds(Environment.TickCount64);

        return new SystemSnapshot(
            cpu,
            ramPct,
            ramUsed,
            ramTotal,
            batPct,
            charging,
            hasBattery,
            downMbps,
            upMbps,
            connected,
            uptime,
            new List<double>(_cpuHistory));
    }

    public static void SetKeepAwakeExecutionState(bool enabled)
    {
        try
        {
            if (enabled)
            {
                SetThreadExecutionState(EsContinuous | EsSystemRequired | EsDisplayRequired);
            }
            else
            {
                SetThreadExecutionState(EsContinuous);
            }
        }
        catch
        {
            // Ignore execution state errors
        }
    }

    private double SampleCpu()
    {
        if (!GetSystemTimes(out var idle, out var kernel, out var user)) return 0;

        ulong idleVal = idle.ToUInt64();
        ulong kernelVal = kernel.ToUInt64();
        ulong userVal = user.ToUInt64();

        if (!_hasCpuBaseline)
        {
            _prevIdle = idleVal;
            _prevKernel = kernelVal;
            _prevUser = userVal;
            _hasCpuBaseline = true;
            return 0;
        }

        ulong idleDelta = idleVal - _prevIdle;
        ulong kernelDelta = kernelVal - _prevKernel;
        ulong userDelta = userVal - _prevUser;

        _prevIdle = idleVal;
        _prevKernel = kernelVal;
        _prevUser = userVal;

        ulong total = kernelDelta + userDelta;
        if (total == 0) return 0;

        double usage = (double)(total - idleDelta) * 100.0 / total;
        return Math.Clamp(Math.Round(usage, 1), 0, 100);
    }

    private static (double Percent, double UsedGb, double TotalGb) SampleMemory()
    {
        var mem = new MemoryStatusEx { dwLength = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        if (!GlobalMemoryStatusEx(ref mem) || mem.ullTotalPhys == 0)
        {
            return (0, 0, 0);
        }

        double totalGb = mem.ullTotalPhys / (1024.0 * 1024.0 * 1024.0);
        double availGb = mem.ullAvailPhys / (1024.0 * 1024.0 * 1024.0);
        double usedGb = Math.Max(0, totalGb - availGb);
        double pct = mem.dwMemoryLoad;
        return (pct, Math.Round(usedGb, 1), Math.Round(totalGb, 1));
    }

    private static (int Percent, bool Charging, bool HasBattery) SampleBattery()
    {
        if (!GetSystemPowerStatus(out var status))
        {
            return (100, true, false);
        }

        bool hasBattery = (status.BatteryFlag & 128) == 0 && status.BatteryLifePercent <= 100;
        bool charging = status.ACLineStatus == 1;
        int pct = hasBattery ? status.BatteryLifePercent : 100;
        return (pct, charging, hasBattery);
    }

    private (double DownMbps, double UpMbps, bool Connected) SampleNetwork()
    {
        long totalRx = 0;
        long totalTx = 0;
        bool connected = false;

        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;

                connected = true;
                var stats = ni.GetIPv4Statistics();
                totalRx += stats.BytesReceived;
                totalTx += stats.BytesSent;
            }
        }
        catch
        {
            return (0, 0, false);
        }

        var now = DateTime.UtcNow;
        if (!_hasNetBaseline)
        {
            _prevBytesReceived = totalRx;
            _prevBytesSent = totalTx;
            _prevNetTime = now;
            _hasNetBaseline = true;
            return (0, 0, connected);
        }

        double seconds = Math.Max(0.25, (now - _prevNetTime).TotalSeconds);
        double downMbps = Math.Max(0, (totalRx - _prevBytesReceived) * 8.0 / (seconds * 1_000_000.0));
        double upMbps = Math.Max(0, (totalTx - _prevBytesSent) * 8.0 / (seconds * 1_000_000.0));

        _prevBytesReceived = totalRx;
        _prevBytesSent = totalTx;
        _prevNetTime = now;

        return (Math.Round(downMbps, 2), Math.Round(upMbps, 2), connected);
    }
}
