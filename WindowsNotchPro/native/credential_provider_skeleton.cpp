// WindowsNotchPro Session-0 ICredentialProvider COM Skeleton (x64)
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
