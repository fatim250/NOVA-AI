using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace WindowsNotchPro.Services;

public static class NativeInterop
{
    private const string NativeDll = "NotchNative.dll";

    public const int MouseLeft = 0;
    public const int MouseRight = 1;
    public const int MouseDoubleLeft = 2;
    public const int DwmCornerRound = 2;

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl)]
    private static extern int notch_mouse_move_smooth(int targetX, int targetY, int durationMs);

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl)]
    private static extern int notch_mouse_click(int button);

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl)]
    private static extern void notch_mouse_emergency_stop();

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl)]
    private static extern void notch_mouse_reset_stop();

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl)]
    private static extern int notch_mouse_is_stopped();

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl)]
    private static extern int notch_lock_workstation();

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl)]
    private static extern int notch_set_window_rounded_corners(IntPtr hwnd, int preference);

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl)]
    private static extern int notch_dpapi_protect(
        byte[] plaintext,
        uint plaintextLen,
        out IntPtr outCipher,
        out uint outCipherLen);

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl)]
    private static extern int notch_dpapi_unprotect(
        byte[] cipher,
        uint cipherLen,
        out IntPtr outPlaintext,
        out uint outPlaintextLen);

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl)]
    private static extern void notch_dpapi_free(IntPtr buffer, uint length);

    [DllImport(NativeDll, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
    private static extern int notch_pipe_send_unlock_request(
        string pipeName,
        byte[] payload,
        uint payloadLen,
        byte[] responseBuf,
        uint responseCap,
        out uint outResponseLen);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool LockWorkStation();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(
        ref DataBlob pDataIn,
        string? szDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        out DataBlob pDataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DataBlob pDataIn,
        IntPtr ppszDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        out DataBlob pDataOut);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr hMem);

    private static volatile bool _managedEmergencyStop;

    public static bool MoveMouseSmooth(int x, int y, int durationMs = 360)
    {
        if (_managedEmergencyStop) return false;
        try
        {
            return notch_mouse_move_smooth(x, y, durationMs) == 0;
        }
        catch (DllNotFoundException)
        {
            return SetCursorPos(x, y);
        }
    }

    public static bool ClickMouse(int button = MouseLeft)
    {
        if (_managedEmergencyStop) return false;
        try
        {
            return notch_mouse_click(button) == 0;
        }
        catch (DllNotFoundException)
        {
            return false;
        }
    }

    public static void TriggerEmergencyStop()
    {
        _managedEmergencyStop = true;
        try { notch_mouse_emergency_stop(); } catch (DllNotFoundException) { }
    }

    public static void ResetEmergencyStop()
    {
        _managedEmergencyStop = false;
        try { notch_mouse_reset_stop(); } catch (DllNotFoundException) { }
    }

    public static bool IsEmergencyStopped()
    {
        try { return _managedEmergencyStop || notch_mouse_is_stopped() != 0; } catch (DllNotFoundException) { return _managedEmergencyStop; }
    }

    public static bool LockWorkstation()
    {
        try
        {
            return notch_lock_workstation() == 0;
        }
        catch (DllNotFoundException)
        {
            return LockWorkStation();
        }
    }

    public static void EnableRoundedCorners(IntPtr hwnd)
    {
        try
        {
            notch_set_window_rounded_corners(hwnd, DwmCornerRound);
        }
        catch (DllNotFoundException)
        {
            try
            {
                int pref = DwmCornerRound;
                DwmSetWindowAttribute(hwnd, 33, ref pref, sizeof(int));
            }
            catch
            {
                // Ignored on Windows 10 where DWMWA_WINDOW_CORNER_PREFERENCE is unsupported
            }
        }
    }

    private static byte[] Win32Dpapi(byte[] input, bool protect)
    {
        IntPtr inPtr = Marshal.AllocHGlobal(input.Length);
        DataBlob outBlob = default;
        try
        {
            Marshal.Copy(input, 0, inPtr, input.Length);
            var inBlob = new DataBlob { cbData = input.Length, pbData = inPtr };
            const int cryptProtectUiForbidden = 0x1;

            bool ok = protect
                ? CryptProtectData(ref inBlob, "WindowsNotchPro_Vault", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, cryptProtectUiForbidden, out outBlob)
                : CryptUnprotectData(ref inBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, cryptProtectUiForbidden, out outBlob);

            if (!ok || outBlob.pbData == IntPtr.Zero || outBlob.cbData <= 0)
            {
                throw new CryptographicException("Win32 DPAPI operation failed.");
            }

            var result = new byte[outBlob.cbData];
            Marshal.Copy(outBlob.pbData, result, 0, outBlob.cbData);
            return result;
        }
        finally
        {
            if (inPtr != IntPtr.Zero)
            {
                Marshal.Copy(new byte[input.Length], 0, inPtr, input.Length);
                Marshal.FreeHGlobal(inPtr);
            }
            if (outBlob.pbData != IntPtr.Zero)
            {
                if (outBlob.cbData > 0)
                {
                    Marshal.Copy(new byte[outBlob.cbData], 0, outBlob.pbData, outBlob.cbData);
                }
                LocalFree(outBlob.pbData);
            }
        }
    }

    public static byte[] ProtectBytes(byte[] plaintext)
    {
        if (plaintext.Length == 0) return Array.Empty<byte>();
        IntPtr cipherPtr = IntPtr.Zero;
        uint cipherLen = 0;

        try
        {
            int rc = notch_dpapi_protect(plaintext, (uint)plaintext.Length, out cipherPtr, out cipherLen);
            if (rc != 0 || cipherPtr == IntPtr.Zero || cipherLen == 0)
            {
                throw new CryptographicException($"Native DPAPI CryptProtectData failed (code {rc}).");
            }

            var managed = new byte[cipherLen];
            Marshal.Copy(cipherPtr, managed, 0, (int)cipherLen);
            return managed;
        }
        catch (DllNotFoundException)
        {
            return Win32Dpapi(plaintext, protect: true);
        }
        finally
        {
            if (cipherPtr != IntPtr.Zero)
            {
                notch_dpapi_free(cipherPtr, cipherLen);
            }
        }
    }

    public static byte[] UnprotectBytes(byte[] cipher)
    {
        if (cipher.Length == 0) return Array.Empty<byte>();
        IntPtr plainPtr = IntPtr.Zero;
        uint plainLen = 0;

        try
        {
            int rc = notch_dpapi_unprotect(cipher, (uint)cipher.Length, out plainPtr, out plainLen);
            if (rc != 0 || plainPtr == IntPtr.Zero || plainLen == 0)
            {
                throw new CryptographicException($"Native DPAPI CryptUnprotectData failed (code {rc}).");
            }

            var managed = new byte[plainLen];
            Marshal.Copy(plainPtr, managed, 0, (int)plainLen);
            return managed;
        }
        catch (DllNotFoundException)
        {
            return Win32Dpapi(cipher, protect: false);
        }
        finally
        {
            if (plainPtr != IntPtr.Zero)
            {
                notch_dpapi_free(plainPtr, plainLen);
            }
        }
    }

    public static string? SendUnlockPipeRequest(string jsonPayload, string pipeName = @"\\.\pipe\WindowsNotchUnlock")
    {
        var payloadBytes = Encoding.UTF8.GetBytes(jsonPayload);
        var responseBuf = new byte[2048];
        try
        {
            int rc = notch_pipe_send_unlock_request(
                pipeName,
                payloadBytes,
                (uint)payloadBytes.Length,
                responseBuf,
                (uint)responseBuf.Length,
                out uint respLen);

            if (rc != 0 || respLen == 0) return null;
            return Encoding.UTF8.GetString(responseBuf, 0, (int)respLen);
        }
        catch (DllNotFoundException)
        {
            return null;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(payloadBytes);
            CryptographicOperations.ZeroMemory(responseBuf);
        }
    }
}
