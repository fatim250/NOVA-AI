#define NOTCH_NATIVE_EXPORTS
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
