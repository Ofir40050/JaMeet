#include "jameet_remote_transport.h"
#include "jameet_remote_win32_ioctl.h"

#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#ifdef _WIN32
#include <windows.h>
#include <cfgmgr32.h>
#include <initguid.h>

#pragma comment(lib, "cfgmgr32.lib")

JaMeetTransport* JaMeetTransport_OpenWin32Device(void) {
    CONFIGRET cr;
    ULONG bufferLen = 0;
    PWSTR deviceInterfaceList = NULL;
    HANDLE deviceHandle = INVALID_HANDLE_VALUE;

    /* 1. Query device interface buffer length */
    cr = CM_Get_Device_Interface_List_SizeW(
        &bufferLen,
        (LPGUID)&GUID_DEVINTERFACE_JAMEET_REMOTE,
        NULL,
        CM_GET_DEVICE_INTERFACE_LIST_PRESENT
    );
    if (cr != CR_SUCCESS || bufferLen <= 1) {
        return NULL;
    }

    deviceInterfaceList = (PWSTR)malloc(bufferLen * sizeof(WCHAR));
    if (!deviceInterfaceList) {
        return NULL;
    }

    /* 2. Retrieve dynamic device interface paths */
    cr = CM_Get_Device_Interface_ListW(
        (LPGUID)&GUID_DEVINTERFACE_JAMEET_REMOTE,
        NULL,
        deviceInterfaceList,
        bufferLen,
        CM_GET_DEVICE_INTERFACE_LIST_PRESENT
    );
    if (cr != CR_SUCCESS || deviceInterfaceList[0] == L'\0') {
        free(deviceInterfaceList);
        return NULL;
    }

    /* 3. Open the primary device interface path */
    PCWSTR primaryDevicePath = deviceInterfaceList;
    deviceHandle = CreateFileW(
        primaryDevicePath,
        GENERIC_READ | GENERIC_WRITE,
        0, /* Exclusive handle for single-producer handshake */
        NULL,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );

    free(deviceInterfaceList);

    if (deviceHandle == INVALID_HANDLE_VALUE) {
        return NULL;
    }

    /* 4. Send IOCTL_JAMEET_MAP_PRODUCER_VIEW handshake */
    JaMeetMapProducerViewRequest req;
    memset(&req, 0, sizeof(req));
    req.magic = JAMEET_SHM_MAGIC;
    req.abiVersion = JAMEET_ABI_VERSION;
    req.processId = (uint32_t)GetCurrentProcessId();

    JaMeetMapProducerViewResponse resp;
    memset(&resp, 0, sizeof(resp));
    DWORD bytesReturned = 0;

    BOOL ok = DeviceIoControl(
        deviceHandle,
        IOCTL_JAMEET_MAP_PRODUCER_VIEW,
        &req,
        sizeof(req),
        &resp,
        sizeof(resp),
        &bytesReturned,
        NULL
    );

    if (!ok || bytesReturned < sizeof(resp) || resp.status != 0 || resp.viewBase == 0) {
        CloseHandle(deviceHandle);
        return NULL;
    }

    JaMeetSharedSegment* seg = (JaMeetSharedSegment*)(uintptr_t)resp.viewBase;
    if (!seg || !JaMeetSegment_ValidateGeometry(seg)) {
        /* Geometry validation failed */
        DWORD unmapReturned = 0;
        DeviceIoControl(
            deviceHandle,
            IOCTL_JAMEET_UNMAP_PRODUCER_VIEW,
            NULL,
            0,
            NULL,
            0,
            &unmapReturned,
            NULL
        );
        CloseHandle(deviceHandle);
        return NULL;
    }

    JaMeetTransport* transport = (JaMeetTransport*)calloc(1, sizeof(JaMeetTransport));
    if (!transport) {
        CloseHandle(deviceHandle);
        return NULL;
    }

    transport->kind = JAMEET_TRANSPORT_KIND_WIN32_DRIVER;
    transport->segment = seg;
    transport->mappedSize = (size_t)resp.viewSize;
    transport->handle = (void*)deviceHandle;
    transport->fd = -1;
    transport->isOwner = true;
    transport->isReadOnly = false;
    transport->isNewlyCreated = false;

    return transport;
}

void JaMeetTransport_Close(JaMeetTransport* transport, bool unlinkShm) {
    (void)unlinkShm;
    if (!transport) return;

    if (transport->kind == JAMEET_TRANSPORT_KIND_WIN32_DRIVER) {
        if (transport->handle != NULL && transport->handle != INVALID_HANDLE_VALUE) {
            DWORD unmapReturned = 0;
            DeviceIoControl(
                (HANDLE)transport->handle,
                IOCTL_JAMEET_UNMAP_PRODUCER_VIEW,
                NULL,
                0,
                NULL,
                0,
                &unmapReturned,
                NULL
            );
            CloseHandle((HANDLE)transport->handle);
            transport->handle = NULL;
        }
        /* Note: transport->segment is a mapped section view; do NOT free it */
        transport->segment = NULL;
    } else if (transport->kind == JAMEET_TRANSPORT_KIND_MEMORY) {
        if (transport->segment) {
            free(transport->segment);
            transport->segment = NULL;
        }
    }

    free(transport);
}

#else

JaMeetTransport* JaMeetTransport_OpenWin32Device(void) {
    /* Stubs on non-Windows platforms */
    return NULL;
}

#endif
