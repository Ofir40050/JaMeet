#ifdef _WIN32
#define INITGUID
#endif

#include "adapter.h"
#include "dispatch.h"
#include "minwave.h"
#include "mintopo.h"

#ifdef _WIN32

static PDEVICE_OBJECT gPhysicalDeviceObject = NULL;
static UNICODE_STRING gDeviceInterfaceName = { 0, 0, NULL };

static NTSTATUS StartDevice(
    IN PDEVICE_OBJECT DeviceObject,
    IN PIRP Irp,
    IN PRESOURCELIST ResourceList
) {
    (void)Irp;

    if (!DeviceObject) return STATUS_INVALID_PARAMETER;

    NTSTATUS status;
    PPORTWAVERT pPortWave = NULL;
    PUNKNOWN pMiniWave = NULL;
    PPORTTOPOLOGY pPortTopo = NULL;
    PUNKNOWN pMiniTopo = NULL;

    /* 1. Create and register PortWaveRT subdevice */
    status = PcNewPort((PPORT*)&pPortWave, CLSID_PortWaveRT);
    if (NT_SUCCESS(status)) {
        status = CreateMiniportWaveRT(&pMiniWave, CLSID_PortWaveRT, NULL, NonPagedPoolNx);
        if (NT_SUCCESS(status)) {
            status = pPortWave->Init(DeviceObject, Irp, pMiniWave, NULL, ResourceList);
            if (NT_SUCCESS(status)) {
                status = PcRegisterSubdevice(DeviceObject, L"Wave", pPortWave);
            }
        }
    }

    if (!NT_SUCCESS(status)) {
        if (pMiniWave) pMiniWave->Release();
        if (pPortWave) pPortWave->Release();
        return status;
    }

    /* 2. Create and register PortTopology subdevice */
    status = PcNewPort((PPORT*)&pPortTopo, CLSID_PortTopology);
    if (NT_SUCCESS(status)) {
        status = CreateMiniportTopology(&pMiniTopo, CLSID_PortTopology, NULL, NonPagedPoolNx);
        if (NT_SUCCESS(status)) {
            status = pPortTopo->Init(DeviceObject, Irp, pMiniTopo, NULL, ResourceList);
            if (NT_SUCCESS(status)) {
                status = PcRegisterSubdevice(DeviceObject, L"Topology", pPortTopo);
            }
        }
    }

    if (!NT_SUCCESS(status)) {
        if (pMiniTopo) pMiniTopo->Release();
        if (pPortTopo) pPortTopo->Release();
        if (pMiniWave) pMiniWave->Release();
        if (pPortWave) pPortWave->Release();
        return status;
    }

    /* 3. Register physical connection between Topology and WaveRT */
    status = PcRegisterPhysicalConnection(DeviceObject, pPortTopo, 0, pPortWave, 1);

    /* Release temporary references (PortCls retains registered subdevices) */
    if (pMiniTopo) pMiniTopo->Release();
    if (pPortTopo) pPortTopo->Release();
    if (pMiniWave) pMiniWave->Release();
    if (pPortWave) pPortWave->Release();

    /* 4. Register dynamic device interface on the Physical Device Object (PDO) */
    if (gPhysicalDeviceObject != NULL) {
        NTSTATUS ifStatus = IoRegisterDeviceInterface(
            gPhysicalDeviceObject,
            &GUID_DEVINTERFACE_JAMEET_REMOTE,
            NULL,
            &gDeviceInterfaceName
        );

        if (NT_SUCCESS(ifStatus) && gDeviceInterfaceName.Buffer != NULL) {
            IoSetDeviceInterfaceState(&gDeviceInterfaceName, TRUE);
        }
    }

    return STATUS_SUCCESS;
}

NTSTATUS AddDevice(
    IN PDRIVER_OBJECT DriverObject,
    IN PDEVICE_OBJECT PhysicalDeviceObject
) {
    gPhysicalDeviceObject = PhysicalDeviceObject;

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
