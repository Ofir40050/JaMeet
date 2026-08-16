#ifdef _WIN32
#include <windows.h>
#include <setupapi.h>
#include <newdev.h>
#include <cfgmgr32.h>
#include <initguid.h>
#include <devguid.h>
#include <devpkey.h>
#include <stdio.h>
#include <stdbool.h>

#pragma comment(lib, "setupapi.lib")
#pragma comment(lib, "newdev.lib")
#pragma comment(lib, "cfgmgr32.lib")
#pragma comment(lib, "advapi32.lib")

#define JAMEET_HARDWARE_ID L"ROOT\\JaMeetRemote"

#ifndef DEFINE_DEVPROPKEY
#define DEFINE_DEVPROPKEY(name, l, w1, w2, b1, b2, b3, b4, b5, b6, b7, b8, pid) const DEVPROPKEY name = { { l, w1, w2, { b1, b2, b3, b4, b5, b6, b7, b8 } }, pid }
#endif

#ifndef DEVPKEY_Device_DriverInfPath
DEFINE_DEVPROPKEY(DEVPKEY_Device_DriverInfPath, 0xa45c254e, 0xdf1c, 0x4efd, 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0, 1);
#endif

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
            fwprintf(stderr, L"[JaMeetInstaller] Error: SetupCopyOEMInfW staging failed: 0x%08X\n", err);
            return (int)err;
        }
        wprintf(L"[JaMeetInstaller] Driver package already exists in DriverStore.\n");
    } else {
        wprintf(L"[JaMeetInstaller] Staged driver in DriverStore as: %s\n", destinationInfFileName);
    }

    /* 2. Locate existing device node or create a new root device instance */
    HDEVINFO devInfoSet = SetupDiGetClassDevsW(
        &GUID_DEVCLASS_MEDIA,
        NULL,
        NULL,
        DIGCF_ALLCLASSES
    );

    if (devInfoSet == INVALID_HANDLE_VALUE) {
        DWORD err = GetLastError();
        fwprintf(stderr, L"[JaMeetInstaller] Error: SetupDiGetClassDevsW failed: 0x%08X\n", err);
        return (int)err;
    }

    SP_DEVINFO_DATA devInfoData;
    bool deviceFound = false;

    for (DWORD idx = 0; ; idx++) {
        memset(&devInfoData, 0, sizeof(devInfoData));
        devInfoData.cbSize = sizeof(SP_DEVINFO_DATA);

        if (!SetupDiEnumDeviceInfo(devInfoSet, idx, &devInfoData)) {
            DWORD err = GetLastError();
            if (err == ERROR_NO_MORE_ITEMS) {
                break; /* Normal enumeration completion */
            }
            fwprintf(stderr, L"[JaMeetInstaller] Error: SetupDiEnumDeviceInfo failed at index %u: 0x%08X\n", idx, err);
            SetupDiDestroyDeviceInfoList(devInfoSet);
            return (int)err;
        }

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
                wprintf(L"[JaMeetInstaller] Found existing JaMeet Remote device instance (index %u), reusing for upgrade.\n", idx);
                deviceFound = true;
                break;
            }
        } else {
            DWORD propErr = GetLastError();
            /* Devices that legitimately do not expose SPDRP_HARDWAREID continue normally */
            if (propErr != ERROR_INVALID_DATA && propErr != ERROR_NOT_FOUND &&
                propErr != ERROR_NO_SUCH_DEVINST && propErr != ERROR_FILE_NOT_FOUND) {
                fwprintf(stderr, L"[JaMeetInstaller] Error: SetupDiGetDeviceRegistryPropertyW failed: 0x%08X\n", propErr);
                SetupDiDestroyDeviceInfoList(devInfoSet);
                return (int)propErr;
            }
        }
    }

    bool newlyCreatedDevice = false;
    if (!deviceFound) {
        SetupDiDestroyDeviceInfoList(devInfoSet);

        devInfoSet = SetupDiCreateDeviceInfoList(&GUID_DEVCLASS_MEDIA, NULL);
        if (devInfoSet == INVALID_HANDLE_VALUE) {
            DWORD err = GetLastError();
            fwprintf(stderr, L"[JaMeetInstaller] Error: SetupDiCreateDeviceInfoList failed: 0x%08X\n", err);
            return (int)err;
        }

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
            fwprintf(stderr, L"[JaMeetInstaller] Error: SetupDiCreateDeviceInfoW failed: 0x%08X\n", err);
            SetupDiDestroyDeviceInfoList(devInfoSet);
            return (int)err;
        }

        /* Set Hardware ID property */
        WCHAR hwIdBuffer[MAX_PATH] = { 0 };
        wcscpy_s(hwIdBuffer, MAX_PATH, JAMEET_HARDWARE_ID);
        DWORD hwIdSize = (DWORD)((wcslen(hwIdBuffer) + 2) * sizeof(WCHAR)); /* Double null terminated */

        if (!SetupDiSetDeviceRegistryPropertyW(
            devInfoSet,
            &devInfoData,
            SPDRP_HARDWAREID,
            (const BYTE*)hwIdBuffer,
            hwIdSize
        )) {
            DWORD err = GetLastError();
            fwprintf(stderr, L"[JaMeetInstaller] Error: SetupDiSetDeviceRegistryPropertyW failed: 0x%08X\n", err);
            SetupDiDestroyDeviceInfoList(devInfoSet);
            return (int)err;
        }

        /* Register device instance */
        if (!SetupDiCallClassInstaller(DIF_REGISTERDEVICE, devInfoSet, &devInfoData)) {
            DWORD err = GetLastError();
            fwprintf(stderr, L"[JaMeetInstaller] Error: DIF_REGISTERDEVICE failed: 0x%08X\n", err);
            SetupDiDestroyDeviceInfoList(devInfoSet);
            return (int)err;
        }

        newlyCreatedDevice = true;
    }

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

        /* Roll back newly created device instance if binding fails */
        if (newlyCreatedDevice) {
            wprintf(L"[JaMeetInstaller] Rolling back newly created device instance after driver binding failure...\n");
            SetupDiCallClassInstaller(DIF_REMOVE, devInfoSet, &devInfoData);
        }

        SetupDiDestroyDeviceInfoList(devInfoSet);
        return (int)err;
    }

    SetupDiDestroyDeviceInfoList(devInfoSet);

    wprintf(L"[JaMeetInstaller] JaMeet Remote device installed successfully.%s\n", rebootRequired ? L" (Reboot required)" : L"");
    return 0;
}

static int uninstall_device(const wchar_t* infPath) {
    if (!is_elevated()) {
        fwprintf(stderr, L"[JaMeetInstaller] Error: Administrator elevation required for driver uninstallation.\n");
        return 5;
    }

    wprintf(L"[JaMeetInstaller] Removing JaMeet Remote device instances and driver package...\n");

    WCHAR discoveredOemInfs[8][MAX_PATH] = { 0 };
    DWORD discoveredOemCount = 0;
    DWORD devicesFound = 0;
    DWORD discoveryFailures = 0;
    DWORD removalFailures = 0;

    /* 1. Find all ROOT\JaMeetRemote device instances, extract their published OEM INF names, and remove them */
    HDEVINFO devInfoSet = SetupDiGetClassDevsW(
        &GUID_DEVCLASS_MEDIA,
        NULL,
        NULL,
        DIGCF_ALLCLASSES
    );

    if (devInfoSet == INVALID_HANDLE_VALUE) {
        DWORD err = GetLastError();
        fwprintf(stderr, L"[JaMeetInstaller] Error: SetupDiGetClassDevsW failed: 0x%08X\n", err);
        return (int)err;
    }

    SP_DEVINFO_DATA devInfoData;
    memset(&devInfoData, 0, sizeof(devInfoData));
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
                devicesFound++;
                wprintf(L"[JaMeetInstaller] Found JaMeet Remote device instance (index %u).\n", idx);

                /* Query published DriverInfPath property (e.g. oemNN.inf) */
                WCHAR oemInfName[MAX_PATH] = { 0 };
                DEVPROPTYPE propType = 0;
                if (!SetupDiGetDevicePropertyW(
                    devInfoSet,
                    &devInfoData,
                    &DEVPKEY_Device_DriverInfPath,
                    &propType,
                    (PBYTE)oemInfName,
                    sizeof(oemInfName),
                    NULL,
                    0
                ) || oemInfName[0] == L'\0') {
                    DWORD err = GetLastError();
                    if (err != ERROR_NOT_FOUND && err != ERROR_FILE_NOT_FOUND) {
                        fwprintf(stderr, L"[JaMeetInstaller] Error: Failed to resolve DriverInfPath for device instance: 0x%08X\n", err);
                        discoveryFailures++;
                    }
                } else {
                    wprintf(L"[JaMeetInstaller] Discovered published driver INF: %s\n", oemInfName);

                    /* Add to unique discovered list */
                    bool alreadyAdded = false;
                    for (DWORD d = 0; d < discoveredOemCount; d++) {
                        if (_wcsicmp(discoveredOemInfs[d], oemInfName) == 0) {
                            alreadyAdded = true;
                            break;
                        }
                    }
                    if (!alreadyAdded && discoveredOemCount < 8) {
                        wcscpy_s(discoveredOemInfs[discoveredOemCount++], MAX_PATH, oemInfName);
                    }
                }

                /* Remove device instance */
                wprintf(L"[JaMeetInstaller] Removing device instance...\n");
                if (!SetupDiCallClassInstaller(DIF_REMOVE, devInfoSet, &devInfoData)) {
                    DWORD err = GetLastError();
                    if (err != ERROR_NO_SUCH_DEVINST && err != ERROR_FILE_NOT_FOUND) {
                        fwprintf(stderr, L"[JaMeetInstaller] Error: Failed to remove device instance: 0x%08X\n", err);
                        removalFailures++;
                    }
                }
            }
        }
    }
    SetupDiDestroyDeviceInfoList(devInfoSet);

    if (devicesFound == 0) {
        wprintf(L"[JaMeetInstaller] No installed JaMeet Remote device instances found.\n");
    }

    if (discoveryFailures > 0) {
        fwprintf(stderr, L"[JaMeetInstaller] Error: Failed to resolve driver INF for %u device instance(s).\n", discoveryFailures);
        return 1;
    }

    if (removalFailures > 0) {
        fwprintf(stderr, L"[JaMeetInstaller] Error: Failed to remove %u device instance(s).\n", removalFailures);
        return 1;
    }

    /* 2. Uninstall discovered published OEM driver packages from DriverStore */
    DWORD packageFailures = 0;
    BOOL rebootRequired = FALSE;

    for (DWORD d = 0; d < discoveredOemCount; d++) {
        wprintf(L"[JaMeetInstaller] Uninstalling published package from DriverStore: %s\n", discoveredOemInfs[d]);
        if (!DiUninstallDriverW(NULL, discoveredOemInfs[d], 0, &rebootRequired)) {
            DWORD err = GetLastError();
            if (err != ERROR_FILE_NOT_FOUND && err != ERROR_PATH_NOT_FOUND && err != ERROR_NOT_FOUND) {
                fwprintf(stderr, L"[JaMeetInstaller] Error: DiUninstallDriverW failed for %s: 0x%08X\n", discoveredOemInfs[d], err);
                packageFailures++;
            }
        } else {
            wprintf(L"[JaMeetInstaller] Published driver package %s uninstalled successfully.%s\n",
                discoveredOemInfs[d], rebootRequired ? L" (Reboot required)" : L"");
        }
    }

    /* If no OEM INF was discovered from device instances, attempt uninstall using provided infPath if any */
    if (discoveredOemCount == 0 && infPath != NULL && wcslen(infPath) > 0) {
        wprintf(L"[JaMeetInstaller] Attempting DriverStore removal for INF: %s\n", infPath);
        if (!DiUninstallDriverW(NULL, infPath, 0, &rebootRequired)) {
            DWORD err = GetLastError();
            if (err != ERROR_FILE_NOT_FOUND && err != ERROR_PATH_NOT_FOUND && err != ERROR_NOT_FOUND) {
                fwprintf(stderr, L"[JaMeetInstaller] Error: DiUninstallDriverW failed: 0x%08X\n", err);
                packageFailures++;
            }
        } else {
            wprintf(L"[JaMeetInstaller] Driver package uninstalled from DriverStore.%s\n", rebootRequired ? L" (Reboot required)" : L"");
        }
    }

    if (packageFailures > 0) {
        fwprintf(stderr, L"[JaMeetInstaller] Error: Failed to uninstall %u DriverStore package(s).\n", packageFailures);
        return 1;
    }

    wprintf(L"[JaMeetInstaller] JaMeet Remote uninstalled successfully.%s\n", rebootRequired ? L" (Reboot required)" : L"");
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
        const wchar_t* infPath = (argc >= 3) ? argv[2] : L"JaMeetRemote.inf";
        return uninstall_device(infPath);
    } else {
        fwprintf(stderr, L"[JaMeetInstaller] Unknown command: %s\n", argv[1]);
        return 1;
    }
}

#else

int main(void) {
    return 0;
}

#endif
