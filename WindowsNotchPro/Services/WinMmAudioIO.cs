using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace WindowsNotchPro.Services;

/// <summary>
/// Zero-NuGet native Windows Multimedia (winmm.dll) 16-bit PCM microphone recorder (16kHz mono)
/// and real-time streaming audio player (24kHz mono) for Gemini Live Voice.
/// </summary>
public sealed class PcmAudioRecorder : IDisposable
{
    private const uint CallbackFunction = 0x00030000;
    private const uint WimData = 0x3C0;
    private const int BufferCount = 4;
    private const int ChunkBytes = 3200; // 100ms of 16kHz 16-bit mono PCM

    private delegate void WaveInProc(IntPtr hwi, uint uMsg, IntPtr dwInstance, IntPtr dwParam1, IntPtr dwParam2);

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveFormatEx
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveHdr
    {
        public IntPtr lpData;
        public uint dwBufferLength;
        public uint dwBytesRecorded;
        public IntPtr dwUser;
        public uint dwFlags;
        public uint dwLoops;
        public IntPtr lpNext;
        public IntPtr reserved;
    }

    [DllImport("winmm.dll")]
    private static extern int waveInOpen(out IntPtr phwi, uint uDeviceID, ref WaveFormatEx pwfx, WaveInProc dwCallback, IntPtr dwInstance, uint fdwOpen);
    [DllImport("winmm.dll")]
    private static extern int waveInPrepareHeader(IntPtr hwi, IntPtr pwh, uint cbwh);
    [DllImport("winmm.dll")]
    private static extern int waveInUnprepareHeader(IntPtr hwi, IntPtr pwh, uint cbwh);
    [DllImport("winmm.dll")]
    private static extern int waveInAddBuffer(IntPtr hwi, IntPtr pwh, uint cbwh);
    [DllImport("winmm.dll")]
    private static extern int waveInStart(IntPtr hwi);
    [DllImport("winmm.dll")]
    private static extern int waveInReset(IntPtr hwi);
    [DllImport("winmm.dll")]
    private static extern int waveInClose(IntPtr hwi);

    private IntPtr _hWaveIn;
    private WaveInProc? _callback;
    private readonly IntPtr[] _hdrPtrs = new IntPtr[BufferCount];
    private readonly IntPtr[] _dataPtrs = new IntPtr[BufferCount];
    private volatile bool _running;
    private readonly object _sync = new();

    public event Action<byte[]>? AudioChunkAvailable;

    public bool Start(int sampleRate = 16000)
    {
        lock (_sync)
        {
            if (_running) return true;

            var fmt = new WaveFormatEx
            {
                wFormatTag = 1, // WAVE_FORMAT_PCM
                nChannels = 1,
                nSamplesPerSec = (uint)sampleRate,
                wBitsPerSample = 16,
                nBlockAlign = 2,
                nAvgBytesPerSec = (uint)(sampleRate * 2),
                cbSize = 0
            };

            _callback = OnWaveInCallback;
            const uint waveMapper = 0xFFFFFFFF;
            int rc = waveInOpen(out _hWaveIn, waveMapper, ref fmt, _callback, IntPtr.Zero, CallbackFunction);
            if (rc != 0 || _hWaveIn == IntPtr.Zero)
            {
                return false;
            }

            uint hdrSize = (uint)Marshal.SizeOf<WaveHdr>();
            for (int i = 0; i < BufferCount; i++)
            {
                _dataPtrs[i] = Marshal.AllocHGlobal(ChunkBytes);
                _hdrPtrs[i] = Marshal.AllocHGlobal((int)hdrSize);

                var hdr = new WaveHdr
                {
                    lpData = _dataPtrs[i],
                    dwBufferLength = ChunkBytes
                };
                Marshal.StructureToPtr(hdr, _hdrPtrs[i], false);
                waveInPrepareHeader(_hWaveIn, _hdrPtrs[i], hdrSize);
                waveInAddBuffer(_hWaveIn, _hdrPtrs[i], hdrSize);
            }

            _running = true;
            if (waveInStart(_hWaveIn) != 0)
            {
                Stop();
                return false;
            }
            return true;
        }
    }

    private void OnWaveInCallback(IntPtr hwi, uint uMsg, IntPtr dwInstance, IntPtr dwParam1, IntPtr dwParam2)
    {
        if (uMsg != WimData || !_running || dwParam1 == IntPtr.Zero) return;

        try
        {
            var hdr = Marshal.PtrToStructure<WaveHdr>(dwParam1);
            if (hdr.dwBytesRecorded > 0 && hdr.lpData != IntPtr.Zero)
            {
                var bytes = new byte[hdr.dwBytesRecorded];
                Marshal.Copy(hdr.lpData, bytes, 0, (int)hdr.dwBytesRecorded);
                AudioChunkAvailable?.Invoke(bytes);
            }

            if (_running && _hWaveIn != IntPtr.Zero)
            {
                waveInAddBuffer(_hWaveIn, dwParam1, (uint)Marshal.SizeOf<WaveHdr>());
            }
        }
        catch
        {
            // Ignore shutdown races
        }
    }

    public void Stop()
    {
        lock (_sync)
        {
            _running = false;
            if (_hWaveIn != IntPtr.Zero)
            {
                waveInReset(_hWaveIn);
                uint hdrSize = (uint)Marshal.SizeOf<WaveHdr>();
                for (int i = 0; i < BufferCount; i++)
                {
                    if (_hdrPtrs[i] != IntPtr.Zero)
                    {
                        waveInUnprepareHeader(_hWaveIn, _hdrPtrs[i], hdrSize);
                        Marshal.FreeHGlobal(_hdrPtrs[i]);
                        _hdrPtrs[i] = IntPtr.Zero;
                    }
                    if (_dataPtrs[i] != IntPtr.Zero)
                    {
                        Marshal.FreeHGlobal(_dataPtrs[i]);
                        _dataPtrs[i] = IntPtr.Zero;
                    }
                }
                waveInClose(_hWaveIn);
                _hWaveIn = IntPtr.Zero;
            }
            _callback = null;
        }
    }

    public void Dispose() => Stop();
}

public sealed class PcmAudioPlayer : IDisposable
{
    private const uint CallbackFunction = 0x00030000;
    private const uint WomDone = 0x3BD;

    private delegate void WaveOutProc(IntPtr hwo, uint uMsg, IntPtr dwInstance, IntPtr dwParam1, IntPtr dwParam2);

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveFormatEx
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveHdr
    {
        public IntPtr lpData;
        public uint dwBufferLength;
        public uint dwBytesRecorded;
        public IntPtr dwUser;
        public uint dwFlags;
        public uint dwLoops;
        public IntPtr lpNext;
        public IntPtr reserved;
    }

    [DllImport("winmm.dll")]
    private static extern int waveOutOpen(out IntPtr phwo, uint uDeviceID, ref WaveFormatEx pwfx, WaveOutProc dwCallback, IntPtr dwInstance, uint fdwOpen);
    [DllImport("winmm.dll")]
    private static extern int waveOutPrepareHeader(IntPtr hwo, IntPtr pwh, uint cbwh);
    [DllImport("winmm.dll")]
    private static extern int waveOutUnprepareHeader(IntPtr hwo, IntPtr pwh, uint cbwh);
    [DllImport("winmm.dll")]
    private static extern int waveOutWrite(IntPtr hwo, IntPtr pwh, uint cbwh);
    [DllImport("winmm.dll")]
    private static extern int waveOutReset(IntPtr hwo);
    [DllImport("winmm.dll")]
    private static extern int waveOutClose(IntPtr hwo);

    private IntPtr _hWaveOut;
    private WaveOutProc? _callback;
    private readonly ConcurrentQueue<(IntPtr Hdr, IntPtr Data)> _completed = new();
    private readonly object _sync = new();
    private int _pendingBuffers;

    public bool IsPlaying => _pendingBuffers > 0;
    public event Action? PlaybackDrained;

    public bool Open(int sampleRate = 24000)
    {
        lock (_sync)
        {
            if (_hWaveOut != IntPtr.Zero) return true;

            var fmt = new WaveFormatEx
            {
                wFormatTag = 1,
                nChannels = 1,
                nSamplesPerSec = (uint)sampleRate,
                wBitsPerSample = 16,
                nBlockAlign = 2,
                nAvgBytesPerSec = (uint)(sampleRate * 2),
                cbSize = 0
            };

            _callback = OnWaveOutCallback;
            const uint waveMapper = 0xFFFFFFFF;
            int rc = waveOutOpen(out _hWaveOut, waveMapper, ref fmt, _callback, IntPtr.Zero, CallbackFunction);
            return rc == 0 && _hWaveOut != IntPtr.Zero;
        }
    }

    public void Enqueue(byte[] pcmBytes)
    {
        if (pcmBytes.Length == 0) return;

        lock (_sync)
        {
            ReclaimCompletedLocked();
            if (_hWaveOut == IntPtr.Zero && !Open()) return;

            uint hdrSize = (uint)Marshal.SizeOf<WaveHdr>();
            IntPtr dataPtr = Marshal.AllocHGlobal(pcmBytes.Length);
            Marshal.Copy(pcmBytes, 0, dataPtr, pcmBytes.Length);

            IntPtr hdrPtr = Marshal.AllocHGlobal((int)hdrSize);
            var hdr = new WaveHdr
            {
                lpData = dataPtr,
                dwBufferLength = (uint)pcmBytes.Length,
                dwUser = dataPtr
            };
            Marshal.StructureToPtr(hdr, hdrPtr, false);

            if (waveOutPrepareHeader(_hWaveOut, hdrPtr, hdrSize) == 0 &&
                waveOutWrite(_hWaveOut, hdrPtr, hdrSize) == 0)
            {
                System.Threading.Interlocked.Increment(ref _pendingBuffers);
            }
            else
            {
                Marshal.FreeHGlobal(hdrPtr);
                Marshal.FreeHGlobal(dataPtr);
            }
        }
    }

    public void Flush()
    {
        lock (_sync)
        {
            if (_hWaveOut != IntPtr.Zero)
            {
                waveOutReset(_hWaveOut);
                ReclaimCompletedLocked();
            }
        }
    }

    private void OnWaveOutCallback(IntPtr hwo, uint uMsg, IntPtr dwInstance, IntPtr dwParam1, IntPtr dwParam2)
    {
        if (uMsg != WomDone || dwParam1 == IntPtr.Zero) return;
        try
        {
            var hdr = Marshal.PtrToStructure<WaveHdr>(dwParam1);
            _completed.Enqueue((dwParam1, hdr.dwUser));
            if (System.Threading.Interlocked.Decrement(ref _pendingBuffers) <= 0)
            {
                System.Threading.Interlocked.Exchange(ref _pendingBuffers, 0);
                PlaybackDrained?.Invoke();
            }
        }
        catch { }
    }

    private void ReclaimCompletedLocked()
    {
        uint hdrSize = (uint)Marshal.SizeOf<WaveHdr>();
        while (_completed.TryDequeue(out var item))
        {
            if (_hWaveOut != IntPtr.Zero && item.Hdr != IntPtr.Zero)
            {
                waveOutUnprepareHeader(_hWaveOut, item.Hdr, hdrSize);
            }
            if (item.Hdr != IntPtr.Zero) Marshal.FreeHGlobal(item.Hdr);
            if (item.Data != IntPtr.Zero) Marshal.FreeHGlobal(item.Data);
        }
    }

    public void Close()
    {
        lock (_sync)
        {
            if (_hWaveOut != IntPtr.Zero)
            {
                waveOutReset(_hWaveOut);
                ReclaimCompletedLocked();
                waveOutClose(_hWaveOut);
                _hWaveOut = IntPtr.Zero;
            }
            _callback = null;
        }
    }

    public void Dispose() => Close();
}
