#ifndef NOTCH_NATIVE_H
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
