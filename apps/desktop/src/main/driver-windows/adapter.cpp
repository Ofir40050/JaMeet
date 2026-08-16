#include "adapter.h"
#include "dispatch.h"
#include "minwave.h"
#include "mintopo.h"

#ifdef _WIN32

static UNICODE_STRING gDeviceInterfaceName = { 0, 0, NULL };

static NTSTATUS StartDevice(
    IN PDEVICE_OBJECT DeviceObject,
    IN PIRP Irp,
    IN PRESOURCELIST ResourceList
) {
    (void)Irp;
    (void)ResourceList;

    if (!DeviceObject) return STATUS_INVALID_PARAMETER;

    /* Register dynamic device interface GUID_DEVINTERFACE_JAMEET_REMOTE */
    NTSTATUS status = IoRegisterDeviceInterface(
        DeviceObject,
        &GUID_DEVINTERFACE_JAMEET_REMOTE,
        NULL,
        &gDeviceInterfaceName
    );

    if (NT_SUCCESS(status) && gDeviceInterfaceName.Buffer != NULL) {
        IoSetDeviceInterfaceState(&gDeviceInterfaceName, TRUE);
    }

    return STATUS_SUCCESS;
}

NTSTATUS AddDevice(
    IN PDRIVER_OBJECT DriverObject,
    IN PDEVICE_OBJECT PhysicalDeviceObject
) {
    return PcAddAdapterDevice(
        DriverObject,
        PhysicalDeviceObject,
        (PCPFNSTARTDEVICE)StartDevice,
        2, /* Max subdevices (Wave + Topology) */
        0
    );
}

extern "C" NTSTATUS DriverEntry(
    IN PDRIVER_OBJECT DriverObject,
    IN PUNICODE_STRING RegistryPath
) {
    if (!DriverObject || !RegistryPath) return STATUS_INVALID_PARAMETER;

    /* 1. Initialize kernel shared memory section */
    NTSTATUS status = JaMeetDispatch_InitSection();
    if (!NT_SUCCESS(status)) {
        return status;
    }

    /* 2. Initialize PortCls adapter driver */
    status = PcInitializeAdapterDriver(
        DriverObject,
        RegistryPath,
        (PDRIVER_ADD_DEVICE)AddDevice
    );
    if (!NT_SUCCESS(status)) {
        JaMeetDispatch_TeardownSection();
        return status;
    }

    /* 3. Install PortCls dispatch wrappers for custom control channel */
    status = JaMeetDispatch_InstallPortClsHooks(DriverObject);
    if (!NT_SUCCESS(status)) {
        JaMeetDispatch_TeardownSection();
        return status;
    }

    return STATUS_SUCCESS;
}

#endif
