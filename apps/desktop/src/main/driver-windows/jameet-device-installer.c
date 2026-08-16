#ifdef _WIN32
#include <windows.h>
#include <setupapi.h>
#include <newdev.h>
#include <cfgmgr32.h>
#include <initguid.h>
#include <devguid.h>
#include <stdio.h>
#include <stdbool.h>

#pragma comment(lib, "setupapi.lib")
#pragma comment(lib, "newdev.lib")
#pragma comment(lib, "cfgmgr32.lib")
#pragma comment(lib, "advapi32.lib")

#define JAMEET_HARDWARE_ID L"ROOT\\JaMeetRemote"

static bool is_elevated(void) {
    BOOL isElevated = FALSE;
    HANDLE token = NULL;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
        TOKEN_ELEVATION elevation;
        DWORD size = sizeof(TOKEN_ELEVATION);
        if (GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size)) {
            isElevated = elevation.TokenIsElevated != 0;
        }
        CloseHandle(token);
    }
    return isElevated != FALSE;
}

static int install_device(const wchar_t* infPath) {
    if (!is_elevated()) {
        fwprintf(stderr, L"[JaMeetInstaller] Error: Administrator elevation required for driver installation.\n");
        return 5; /* ERROR_ACCESS_DENIED */
    }

    wprintf(L"[JaMeetInstaller] Installing JaMeet Remote device from: %s\n", infPath);

    /* 1. Stage driver into Windows DriverStore using SetupCopyOEMInf */
    WCHAR destinationInfFileName[MAX_PATH] = { 0 };
    if (!SetupCopyOEMInfW(
        infPath,
        NULL,
        SPOST_PATH,
        0,
        destinationInfFileName,
        MAX_PATH,
        NULL,
        NULL
    )) {
        DWORD err = GetLastError();
        if (err != ERROR_FILE_EXISTS) {
            fwprintf(stderr, L"[JaMeetInstaller] Warning: SetupCopyOEMInfW returned error: 0x%08X (proceeding to device update)\n", err);
        }
    } else {
        wprintf(L"[JaMeetInstaller] Staged driver as: %s\n", destinationInfFileName);
    }

    /* 2. Create and register the root enumerated device node */
    HDEVINFO devInfoSet = SetupDiCreateDeviceInfoList(&GUID_DEVCLASS_MEDIA, NULL);
    if (devInfoSet == INVALID_HANDLE_VALUE) {
        DWORD err = GetLastError();
        fwprintf(stderr, L"[JaMeetInstaller] Error: SetupDiCreateDeviceInfoList failed: 0x%08X\n", err);
        return (int)err;
    }

    SP_DEVINFO_DATA devInfoData;
    memset(&devInfoData, 0, sizeof(devInfoData));
    devInfoData.cbSize = sizeof(SP_DEVINFO_DATA);

    if (!SetupDiCreateDeviceInfoW(
        devInfoSet,
        L"ROOT\\JaMeetRemote",
        &GUID_DEVCLASS_MEDIA,
        L"JaMeet Remote",
        NULL,
        DICD_GENERATE_ID,
        &devInfoData
    )) {
        DWORD err = GetLastError();
        if (err != ERROR_DEVINST_ALREADY_EXISTS) {
            fwprintf(stderr, L"[JaMeetInstaller] Warning: SetupDiCreateDeviceInfoW returned: 0x%08X\n", err);
        }
    }

    /* Set Hardware ID property */
    WCHAR hwIdBuffer[MAX_PATH] = { 0 };
    wcscpy_s(hwIdBuffer, MAX_PATH, JAMEET_HARDWARE_ID);
    DWORD hwIdSize = (DWORD)((wcslen(hwIdBuffer) + 2) * sizeof(WCHAR)); /* Double null terminated */

    SetupDiSetDeviceRegistryPropertyW(
        devInfoSet,
        &devInfoData,
        SPDRP_HARDWAREID,
        (const BYTE*)hwIdBuffer,
        hwIdSize
    );

    /* Register device instance */
    if (!SetupDiCallClassInstaller(DIF_REGISTERDEVICE, devInfoSet, &devInfoData)) {
        DWORD err = GetLastError();
        fwprintf(stderr, L"[JaMeetInstaller] Warning: DIF_REGISTERDEVICE returned: 0x%08X\n", err);
    }

    SetupDiDestroyDeviceInfoList(devInfoSet);

    /* 3. Install driver package onto the device instance */
    BOOL rebootRequired = FALSE;
    if (!UpdateDriverForPlugAndPlayDevicesW(
        NULL,
        JAMEET_HARDWARE_ID,
        infPath,
        INSTALLFLAG_FORCE,
        &rebootRequired
    )) {
        DWORD err = GetLastError();
        fwprintf(stderr, L"[JaMeetInstaller] Error: UpdateDriverForPlugAndPlayDevices failed: 0x%08X\n", err);
        return (int)err;
    }

    wprintf(L"[JaMeetInstaller] JaMeet Remote device installed successfully.\n");
    return 0;
}

static int uninstall_device(void) {
    if (!is_elevated()) {
        fwprintf(stderr, L"[JaMeetInstaller] Error: Administrator elevation required for driver uninstallation.\n");
        return 5;
    }

    wprintf(L"[JaMeetInstaller] Removing JaMeet Remote device instances...\n");

    /* 1. Find and remove all ROOT\JaMeetRemote device instances */
    HDEVINFO devInfoSet = SetupDiGetClassDevsW(
        &GUID_DEVCLASS_MEDIA,
        NULL,
        NULL,
        DIGCF_ALLCLASSES
    );

    if (devInfoSet != INVALID_HANDLE_VALUE) {
        SP_DEVINFO_DATA devInfoData;
        devInfoData.cbSize = sizeof(SP_DEVINFO_DATA);

        for (DWORD idx = 0; SetupDiEnumDeviceInfo(devInfoSet, idx, &devInfoData); idx++) {
            WCHAR hwId[MAX_PATH] = { 0 };
            if (SetupDiGetDeviceRegistryPropertyW(
                devInfoSet,
                &devInfoData,
                SPDRP_HARDWAREID,
                NULL,
                (PBYTE)hwId,
                sizeof(hwId),
                NULL
            )) {
                if (_wcsicmp(hwId, JAMEET_HARDWARE_ID) == 0) {
                    wprintf(L"[JaMeetInstaller] Removing device node index %u...\n", idx);
                    SetupDiCallClassInstaller(DIF_REMOVE, devInfoSet, &devInfoData);
                }
            }
        }
        SetupDiDestroyDeviceInfoList(devInfoSet);
    }

    wprintf(L"[JaMeetInstaller] JaMeet Remote uninstalled cleanly.\n");
    return 0;
}

int wmain(int argc, wchar_t* argv[]) {
    if (argc < 2) {
        wprintf(L"Usage: jameet-device-installer.exe <install|uninstall> [path-to-inf]\n");
        return 1;
    }

    if (_wcsicmp(argv[1], L"install") == 0) {
        const wchar_t* infPath = (argc >= 3) ? argv[2] : L"JaMeetRemote.inf";
        return install_device(infPath);
    } else if (_wcsicmp(argv[1], L"uninstall") == 0) {
        return uninstall_device();
    } else {
        fwprintf(stderr, L"[JaMeetInstaller] Unknown command: %s\n", argv[1]);
        return 1;
    }
}

#else

#include <stdio.h>
int main(int argc, char* argv[]) {
    (void)argc;
    (void)argv;
    printf("[JaMeetInstaller] Windows device installer tool (stub on non-Windows)\n");
    return 0;
}

#endif
