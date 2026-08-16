#include "dispatch.h"

#ifdef _WIN32

static JaMeetSharedSegment* gKernelSharedSegment = NULL;
static PMDL gSharedMdl = NULL;

static KEVENT gProducerMutexEvent;
static PEPROCESS gProducerProcess = NULL;
static PFILE_OBJECT gActiveProducerFileObject = NULL;
static PVOID gUserViewBaseAddress = NULL;

static PDRIVER_DISPATCH gPortClsDeviceControl = NULL;
static PDRIVER_DISPATCH gPortClsCleanup = NULL;
static PDRIVER_DISPATCH gPortClsClose = NULL;
static PDRIVER_DISPATCH gPortClsCreate = NULL;

JaMeetSharedSegment* JaMeetDispatch_GetKernelSharedSegment(void) {
    return gKernelSharedSegment;
}

NTSTATUS JaMeetDispatch_InitSection(void) {
    KeInitializeEvent(&gProducerMutexEvent, SynchronizationEvent, TRUE);

    /* Allocate permanent nonpaged shared memory segment resident at DISPATCH_LEVEL */
    gKernelSharedSegment = (JaMeetSharedSegment*)ExAllocatePool2(
        POOL_FLAG_NON_PAGED,
        sizeof(JaMeetSharedSegment),
        'TMJR'
    );
    if (!gKernelSharedSegment) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    /* Zero all shared pages before exposure */
    RtlZeroMemory(gKernelSharedSegment, sizeof(JaMeetSharedSegment));

    /* Initialize shared segment format with exact authoritative ABI fields */
    gKernelSharedSegment->header.magic = JAMEET_SHM_MAGIC;
    gKernelSharedSegment->header.abiVersion = JAMEET_ABI_VERSION;
    gKernelSharedSegment->header.headerSizeBytes = sizeof(JaMeetSharedHeader);
    gKernelSharedSegment->header.totalSizeBytes = sizeof(JaMeetSharedSegment);
    gKernelSharedSegment->header.sampleRate = JAMEET_SAMPLE_RATE;
    gKernelSharedSegment->header.channels = JAMEET_CHANNELS;
    gKernelSharedSegment->header.slotCount = JAMEET_SLOT_COUNT;
    gKernelSharedSegment->header.framesPerSlot = JAMEET_SLOT_FRAMES;
    gKernelSharedSegment->header.totalCapacityFrames = JAMEET_TOTAL_FRAMES;

    /* Build MDL to allow mapping into user mode */
    gSharedMdl = IoAllocateMdl(gKernelSharedSegment, sizeof(JaMeetSharedSegment), FALSE, FALSE, NULL);
    if (!gSharedMdl) {
        ExFreePoolWithTag(gKernelSharedSegment, 'TMJR');
        gKernelSharedSegment = NULL;
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    MmBuildMdlForNonPagedPool(gSharedMdl);

    return STATUS_SUCCESS;
}

void JaMeetDispatch_TeardownSection(void) {
    KeWaitForSingleObject(&gProducerMutexEvent, Executive, KernelMode, FALSE, NULL);

    if (gUserViewBaseAddress != NULL && gSharedMdl != NULL) {
        __try {
            MmUnmapLockedPages(gUserViewBaseAddress, gSharedMdl);
        } __except (EXCEPTION_EXECUTE_HANDLER) {
        }
        gUserViewBaseAddress = NULL;
    }

    if (gProducerProcess != NULL) {
        ObDereferenceObject(gProducerProcess);
        gProducerProcess = NULL;
    }
    gActiveProducerFileObject = NULL;

    KeSetEvent(&gProducerMutexEvent, IO_NO_INCREMENT, FALSE);

    if (gSharedMdl != NULL) {
        IoFreeMdl(gSharedMdl);
        gSharedMdl = NULL;
    }

    if (gKernelSharedSegment != NULL) {
        ExFreePoolWithTag(gKernelSharedSegment, 'TMJR');
        gKernelSharedSegment = NULL;
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

        /* PASSIVE_LEVEL synchronization */
        KeWaitForSingleObject(&gProducerMutexEvent, Executive, KernelMode, FALSE, NULL);

        /* Single producer mutual exclusion: reject second writer */
        if (gActiveProducerFileObject != NULL || gUserViewBaseAddress != NULL) {
            KeSetEvent(&gProducerMutexEvent, IO_NO_INCREMENT, FALSE);
            Irp->IoStatus.Status = STATUS_DEVICE_BUSY;
            Irp->IoStatus.Information = 0;
            IoCompleteRequest(Irp, IO_NO_INCREMENT);
            return STATUS_DEVICE_BUSY;
        }

        PEPROCESS requestorProcess = IoGetRequestorProcess(Irp);
        if (!requestorProcess) {
            requestorProcess = PsGetCurrentProcess();
        }

        PVOID userMappedAddress = NULL;
        NTSTATUS status = STATUS_SUCCESS;

        __try {
            /* Safely map the nonpaged shared memory MDL into the requestor process space */
            userMappedAddress = MmMapLockedPagesSpecifyCache(
                gSharedMdl,
                UserMode,
                MmCached,
                NULL,
                FALSE,
                NormalPagePriority | MdlMappingNoExecute
            );
        } __except (EXCEPTION_EXECUTE_HANDLER) {
            status = GetExceptionCode();
            userMappedAddress = NULL;
        }

        if (!userMappedAddress || !NT_SUCCESS(status)) {
            KeSetEvent(&gProducerMutexEvent, IO_NO_INCREMENT, FALSE);
            Irp->IoStatus.Status = (status != STATUS_SUCCESS) ? status : STATUS_INSUFFICIENT_RESOURCES;
            Irp->IoStatus.Information = 0;
            IoCompleteRequest(Irp, IO_NO_INCREMENT);
            return Irp->IoStatus.Status;
        }

        ObReferenceObject(requestorProcess);
        gProducerProcess = requestorProcess;
        gUserViewBaseAddress = userMappedAddress;
        gActiveProducerFileObject = irpSp->FileObject;

        resp->status = 0;
        resp->abiVersion = JAMEET_ABI_VERSION;
        resp->viewBase = (uint64_t)(uintptr_t)gUserViewBaseAddress;
        resp->viewSize = (uint64_t)sizeof(JaMeetSharedSegment);

        KeSetEvent(&gProducerMutexEvent, IO_NO_INCREMENT, FALSE);

        Irp->IoStatus.Status = STATUS_SUCCESS;
        Irp->IoStatus.Information = sizeof(JaMeetMapProducerViewResponse);
        IoCompleteRequest(Irp, IO_NO_INCREMENT);
        return STATUS_SUCCESS;
    } else if (ioctlCode == IOCTL_JAMEET_UNMAP_PRODUCER_VIEW) {
        KeWaitForSingleObject(&gProducerMutexEvent, Executive, KernelMode, FALSE, NULL);

        if (irpSp->FileObject == gActiveProducerFileObject && gUserViewBaseAddress != NULL) {
            __try {
                MmUnmapLockedPages(gUserViewBaseAddress, gSharedMdl);
            } __except (EXCEPTION_EXECUTE_HANDLER) {
            }
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

        KeSetEvent(&gProducerMutexEvent, IO_NO_INCREMENT, FALSE);

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

        KeWaitForSingleObject(&gProducerMutexEvent, Executive, KernelMode, FALSE, NULL);
        resp->isProducerConnected = (gActiveProducerFileObject != NULL) ? 1 : 0;
        if (gKernelSharedSegment != NULL) {
            resp->isVoiceActive = gKernelSharedSegment->header.isVoiceActive;
            resp->lastHeartbeatMs = gKernelSharedSegment->header.heartbeatMs;
        }
        resp->sampleRate = JAMEET_SAMPLE_RATE;
        KeSetEvent(&gProducerMutexEvent, IO_NO_INCREMENT, FALSE);

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

    KeWaitForSingleObject(&gProducerMutexEvent, Executive, KernelMode, FALSE, NULL);

    if (irpSp->FileObject == gActiveProducerFileObject && gUserViewBaseAddress != NULL) {
        __try {
            MmUnmapLockedPages(gUserViewBaseAddress, gSharedMdl);
        } __except (EXCEPTION_EXECUTE_HANDLER) {
        }
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

    KeSetEvent(&gProducerMutexEvent, IO_NO_INCREMENT, FALSE);

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
