#include "dispatch.h"

#ifdef _WIN32

static HANDLE gSectionHandle = NULL;
static JaMeetSharedSegment* gKernelSharedSegment = NULL;
static SIZE_T gKernelViewSize = 0;

static KSPIN_LOCK gProducerLock;
static PEPROCESS gProducerProcess = NULL;
static HANDLE gProducerProcessHandle = NULL;
static PFILE_OBJECT gActiveProducerFileObject = NULL;
static PVOID gUserViewBaseAddress = NULL;
static SIZE_T gUserViewSize = 0;

static PDRIVER_DISPATCH gPortClsDeviceControl = NULL;
static PDRIVER_DISPATCH gPortClsCleanup = NULL;
static PDRIVER_DISPATCH gPortClsClose = NULL;
static PDRIVER_DISPATCH gPortClsCreate = NULL;

JaMeetSharedSegment* JaMeetDispatch_GetKernelSharedSegment(void) {
    return gKernelSharedSegment;
}

NTSTATUS JaMeetDispatch_InitSection(void) {
    KeInitializeSpinLock(&gProducerLock);

    LARGE_INTEGER sectionSize;
    sectionSize.QuadPart = sizeof(JaMeetSharedSegment);

    OBJECT_ATTRIBUTES objAttr;
    InitializeObjectAttributes(&objAttr, NULL, OBJ_KERNEL_HANDLE, NULL, NULL);

    NTSTATUS status = ZwCreateSection(
        &gSectionHandle,
        SECTION_ALL_ACCESS,
        &objAttr,
        &sectionSize,
        PAGE_READWRITE,
        SEC_COMMIT,
        NULL
    );
    if (!NT_SUCCESS(status)) {
        return status;
    }

    gKernelViewSize = sizeof(JaMeetSharedSegment);
    status = ZwMapViewOfSection(
        gSectionHandle,
        ZwCurrentProcess(),
        (PVOID*)&gKernelSharedSegment,
        0,
        sizeof(JaMeetSharedSegment),
        NULL,
        &gKernelViewSize,
        ViewUnmap,
        0,
        PAGE_READWRITE
    );
    if (!NT_SUCCESS(status)) {
        ZwClose(gSectionHandle);
        gSectionHandle = NULL;
        return status;
    }

    /* Initialize shared segment format with zero initial generation */
    memset(gKernelSharedSegment, 0, sizeof(JaMeetSharedSegment));
    gKernelSharedSegment->header.magic = JAMEET_SHM_MAGIC;
    gKernelSharedSegment->header.abiVersion = JAMEET_ABI_VERSION;
    gKernelSharedSegment->header.headerSizeBytes = sizeof(JaMeetSharedHeader);
    gKernelSharedSegment->header.slotSizeBytes = sizeof(JaMeetAudioSlot);
    gKernelSharedSegment->header.totalSegmentSizeBytes = sizeof(JaMeetSharedSegment);
    gKernelSharedSegment->header.slotCount = JAMEET_SLOT_COUNT;
    gKernelSharedSegment->header.slotFrames = JAMEET_SLOT_FRAMES;
    gKernelSharedSegment->header.totalFrames = JAMEET_TOTAL_FRAMES;
    gKernelSharedSegment->header.sampleRate = JAMEET_SAMPLE_RATE;
    gKernelSharedSegment->header.channels = JAMEET_CHANNELS;

    return STATUS_SUCCESS;
}

void JaMeetDispatch_TeardownSection(void) {
    KIRQL oldIrql;
    KeAcquireSpinLock(&gProducerLock, &oldIrql);

    if (gProducerProcessHandle != NULL && gUserViewBaseAddress != NULL) {
        ZwUnmapViewOfSection(gProducerProcessHandle, gUserViewBaseAddress);
        ZwClose(gProducerProcessHandle);
        gProducerProcessHandle = NULL;
        gUserViewBaseAddress = NULL;
    }
    if (gProducerProcess != NULL) {
        ObDereferenceObject(gProducerProcess);
        gProducerProcess = NULL;
    }
    gActiveProducerFileObject = NULL;

    KeReleaseSpinLock(&gProducerLock, oldIrql);

    if (gKernelSharedSegment != NULL) {
        ZwUnmapViewOfSection(ZwCurrentProcess(), (PVOID)gKernelSharedSegment);
        gKernelSharedSegment = NULL;
    }

    if (gSectionHandle != NULL) {
        ZwClose(gSectionHandle);
        gSectionHandle = NULL;
    }
}

static NTSTATUS JaMeetDispatch_HandleDeviceControl(PDEVICE_OBJECT DeviceObject, PIRP Irp) {
    PIO_STACK_LOCATION irpSp = IoGetCurrentIrpStackLocation(Irp);
    ULONG ioctlCode = irpSp->Parameters.DeviceIoControl.IoControlCode;

    if (ioctlCode == IOCTL_JAMEET_MAP_PRODUCER_VIEW) {
        if (irpSp->Parameters.DeviceIoControl.InputBufferLength < sizeof(JaMeetMapProducerViewRequest) ||
            irpSp->Parameters.DeviceIoControl.OutputBufferLength < sizeof(JaMeetMapProducerViewResponse)) {
            Irp->IoStatus.Status = STATUS_BUFFER_TOO_SMALL;
            Irp->IoStatus.Information = 0;
            IoCompleteRequest(Irp, IO_NO_INCREMENT);
            return STATUS_BUFFER_TOO_SMALL;
        }

        JaMeetMapProducerViewRequest* req = (JaMeetMapProducerViewRequest*)Irp->AssociatedIrp.SystemBuffer;
        JaMeetMapProducerViewResponse* resp = (JaMeetMapProducerViewResponse*)Irp->AssociatedIrp.SystemBuffer;

        if (req->magic != JAMEET_SHM_MAGIC || req->abiVersion != JAMEET_ABI_VERSION) {
            Irp->IoStatus.Status = STATUS_INVALID_PARAMETER;
            Irp->IoStatus.Information = 0;
            IoCompleteRequest(Irp, IO_NO_INCREMENT);
            return STATUS_INVALID_PARAMETER;
        }

        KIRQL oldIrql;
        KeAcquireSpinLock(&gProducerLock, &oldIrql);

        /* Single producer mutual exclusion: reject second writer */
        if (gActiveProducerFileObject != NULL || gProducerProcessHandle != NULL) {
            KeReleaseSpinLock(&gProducerLock, oldIrql);
            Irp->IoStatus.Status = STATUS_DEVICE_BUSY;
            Irp->IoStatus.Information = 0;
            IoCompleteRequest(Irp, IO_NO_INCREMENT);
            return STATUS_DEVICE_BUSY;
        }

        PEPROCESS requestorProcess = IoGetRequestorProcess(Irp);
        if (!requestorProcess) {
            requestorProcess = PsGetCurrentProcess();
        }

        ObReferenceObject(requestorProcess);
        gProducerProcess = requestorProcess;

        NTSTATUS status = ObOpenObjectByPointer(
            requestorProcess,
            OBJ_KERNEL_HANDLE,
            NULL,
            PROCESS_VM_OPERATION,
            *PsProcessType,
            KernelMode,
            &gProducerProcessHandle
        );

        if (!NT_SUCCESS(status)) {
            ObDereferenceObject(gProducerProcess);
            gProducerProcess = NULL;
            KeReleaseSpinLock(&gProducerLock, oldIrql);
            Irp->IoStatus.Status = status;
            Irp->IoStatus.Information = 0;
            IoCompleteRequest(Irp, IO_NO_INCREMENT);
            return status;
        }

        gUserViewSize = sizeof(JaMeetSharedSegment);
        gUserViewBaseAddress = NULL;

        status = ZwMapViewOfSection(
            gSectionHandle,
            gProducerProcessHandle,
            &gUserViewBaseAddress,
            0,
            sizeof(JaMeetSharedSegment),
            NULL,
            &gUserViewSize,
            ViewUnmap,
            0,
            PAGE_READWRITE
        );

        if (!NT_SUCCESS(status)) {
            ZwClose(gProducerProcessHandle);
            gProducerProcessHandle = NULL;
            ObDereferenceObject(gProducerProcess);
            gProducerProcess = NULL;
            KeReleaseSpinLock(&gProducerLock, oldIrql);
            Irp->IoStatus.Status = status;
            Irp->IoStatus.Information = 0;
            IoCompleteRequest(Irp, IO_NO_INCREMENT);
            return status;
        }

        gActiveProducerFileObject = irpSp->FileObject;

        resp->status = 0;
        resp->abiVersion = JAMEET_ABI_VERSION;
        resp->viewBase = (uint64_t)(uintptr_t)gUserViewBaseAddress;
        resp->viewSize = (uint64_t)gUserViewSize;

        KeReleaseSpinLock(&gProducerLock, oldIrql);

        Irp->IoStatus.Status = STATUS_SUCCESS;
        Irp->IoStatus.Information = sizeof(JaMeetMapProducerViewResponse);
        IoCompleteRequest(Irp, IO_NO_INCREMENT);
        return STATUS_SUCCESS;
    } else if (ioctlCode == IOCTL_JAMEET_UNMAP_PRODUCER_VIEW) {
        KIRQL oldIrql;
        KeAcquireSpinLock(&gProducerLock, &oldIrql);

        if (irpSp->FileObject == gActiveProducerFileObject && gProducerProcessHandle != NULL && gUserViewBaseAddress != NULL) {
            ZwUnmapViewOfSection(gProducerProcessHandle, gUserViewBaseAddress);
            ZwClose(gProducerProcessHandle);
            gProducerProcessHandle = NULL;
            gUserViewBaseAddress = NULL;
            if (gProducerProcess != NULL) {
                ObDereferenceObject(gProducerProcess);
                gProducerProcess = NULL;
            }
            gActiveProducerFileObject = NULL;
            if (gKernelSharedSegment != NULL) {
                gKernelSharedSegment->header.isVoiceActive = 0;
            }
        }

        KeReleaseSpinLock(&gProducerLock, oldIrql);

        Irp->IoStatus.Status = STATUS_SUCCESS;
        Irp->IoStatus.Information = 0;
        IoCompleteRequest(Irp, IO_NO_INCREMENT);
        return STATUS_SUCCESS;
    } else if (ioctlCode == IOCTL_JAMEET_GET_STATUS) {
        if (irpSp->Parameters.DeviceIoControl.OutputBufferLength < sizeof(JaMeetDriverStatusResponse)) {
            Irp->IoStatus.Status = STATUS_BUFFER_TOO_SMALL;
            Irp->IoStatus.Information = 0;
            IoCompleteRequest(Irp, IO_NO_INCREMENT);
            return STATUS_BUFFER_TOO_SMALL;
        }

        JaMeetDriverStatusResponse* resp = (JaMeetDriverStatusResponse*)Irp->AssociatedIrp.SystemBuffer;
        memset(resp, 0, sizeof(JaMeetDriverStatusResponse));

        KIRQL oldIrql;
        KeAcquireSpinLock(&gProducerLock, &oldIrql);
        resp->isProducerConnected = (gActiveProducerFileObject != NULL) ? 1 : 0;
        if (gKernelSharedSegment != NULL) {
            resp->isVoiceActive = gKernelSharedSegment->header.isVoiceActive;
            resp->lastHeartbeatMs = gKernelSharedSegment->header.lastHeartbeatMs;
        }
        resp->sampleRate = JAMEET_SAMPLE_RATE;
        KeReleaseSpinLock(&gProducerLock, oldIrql);

        Irp->IoStatus.Status = STATUS_SUCCESS;
        Irp->IoStatus.Information = sizeof(JaMeetDriverStatusResponse);
        IoCompleteRequest(Irp, IO_NO_INCREMENT);
        return STATUS_SUCCESS;
    }

    /* Forward all unrelated DeviceControl IRPs to PortCls */
    if (gPortClsDeviceControl) {
        return gPortClsDeviceControl(DeviceObject, Irp);
    }

    Irp->IoStatus.Status = STATUS_NOT_SUPPORTED;
    Irp->IoStatus.Information = 0;
    IoCompleteRequest(Irp, IO_NO_INCREMENT);
    return STATUS_NOT_SUPPORTED;
}

static NTSTATUS JaMeetDispatch_HandleCleanup(PDEVICE_OBJECT DeviceObject, PIRP Irp) {
    PIO_STACK_LOCATION irpSp = IoGetCurrentIrpStackLocation(Irp);

    KIRQL oldIrql;
    KeAcquireSpinLock(&gProducerLock, &oldIrql);

    if (irpSp->FileObject == gActiveProducerFileObject) {
        /* Process-specific user memory unmapping using retained kernel handle */
        if (gProducerProcessHandle != NULL && gUserViewBaseAddress != NULL) {
            ZwUnmapViewOfSection(gProducerProcessHandle, gUserViewBaseAddress);
            ZwClose(gProducerProcessHandle);
            gProducerProcessHandle = NULL;
            gUserViewBaseAddress = NULL;
        }
        if (gProducerProcess != NULL) {
            ObDereferenceObject(gProducerProcess);
            gProducerProcess = NULL;
        }
        gActiveProducerFileObject = NULL;
        if (gKernelSharedSegment != NULL) {
            gKernelSharedSegment->header.isVoiceActive = 0;
        }
    }

    KeReleaseSpinLock(&gProducerLock, oldIrql);

    /* Forward to PortCls cleanup handler */
    if (gPortClsCleanup) {
        return gPortClsCleanup(DeviceObject, Irp);
    }

    Irp->IoStatus.Status = STATUS_SUCCESS;
    IoCompleteRequest(Irp, IO_NO_INCREMENT);
    return STATUS_SUCCESS;
}

NTSTATUS JaMeetDispatch_InstallPortClsHooks(PDRIVER_OBJECT DriverObject) {
    if (!DriverObject) return STATUS_INVALID_PARAMETER;

    /* Save original PortCls handlers */
    gPortClsDeviceControl = DriverObject->MajorFunction[IRP_MJ_DEVICE_CONTROL];
    gPortClsCleanup = DriverObject->MajorFunction[IRP_MJ_CLEANUP];
    gPortClsClose = DriverObject->MajorFunction[IRP_MJ_CLOSE];
    gPortClsCreate = DriverObject->MajorFunction[IRP_MJ_CREATE];

    /* Install wrapper dispatch hooks */
    DriverObject->MajorFunction[IRP_MJ_DEVICE_CONTROL] = JaMeetDispatch_HandleDeviceControl;
    DriverObject->MajorFunction[IRP_MJ_CLEANUP] = JaMeetDispatch_HandleCleanup;

    return STATUS_SUCCESS;
}

#else

/* Non-Windows stubs */
JaMeetSharedSegment* JaMeetDispatch_GetKernelSharedSegment(void) { return NULL; }
NTSTATUS JaMeetDispatch_InitSection(void) { return 0; }
void JaMeetDispatch_TeardownSection(void) {}

#endif
