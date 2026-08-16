#include "minwave.h"
#include "dispatch.h"
#include "jameet_remote_kernel_consumer.h"

#ifdef _WIN32

/*
 * Data range descriptors for 48 kHz stereo IEEE Float and PCM formats
 */
static const KSDATARANGE_AUDIO PinDataRangesAudio[] = {
    {
        {
            sizeof(KSDATARANGE_AUDIO),
            0,
            0,
            0,
            STATICGUIDOF(KSDATAFORMAT_TYPE_AUDIO),
            STATICGUIDOF(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT),
            STATICGUIDOF(KSDATAFORMAT_SPECIFIER_WAVEFORMATEX)
        },
        2,  /* Maximum channels */
        32, /* Minimum bits per sample */
        32, /* Maximum bits per sample */
        48000, /* Minimum sample frequency */
        48000  /* Maximum sample frequency */
    },
    {
        {
            sizeof(KSDATARANGE_AUDIO),
            0,
            0,
            0,
            STATICGUIDOF(KSDATAFORMAT_TYPE_AUDIO),
            STATICGUIDOF(KSDATAFORMAT_SUBTYPE_PCM),
            STATICGUIDOF(KSDATAFORMAT_SPECIFIER_WAVEFORMATEX)
        },
        2,  /* Maximum channels */
        16, /* Minimum bits per sample */
        16, /* Maximum bits per sample */
        48000, /* Minimum sample frequency */
        48000  /* Maximum sample frequency */
    }
};

static const PKSDATARANGE PinDataRangePointers[] = {
    (PKSDATARANGE)&PinDataRangesAudio[0],
    (PKSDATARANGE)&PinDataRangesAudio[1]
};

/*
 * Pin descriptors for WaveRT filter:
 * Pin 0: WaveRT Capture Stream Pin (Streaming)
 * Pin 1: WaveRT Bridge Pin (connected to Topology)
 */
static const PCPIN_DESCRIPTOR WavePins[] = {
    {
        1, 1, 0,
        NULL,
        {
            0, NULL,
            0, NULL,
            SIZEOF_ARRAY(PinDataRangePointers),
            PinDataRangePointers,
            KSPIN_DATAFLOW_OUT,
            KSPIN_COMMUNICATION_BOTH,
            (GUID*)&KSCATEGORY_AUDIO,
            (GUID*)&PINNAME_RECORDING_SOURCE,
            0
        }
    },
    {
        0, 0, 0,
        NULL,
        {
            0, NULL,
            0, NULL,
            SIZEOF_ARRAY(PinDataRangePointers),
            PinDataRangePointers,
            KSPIN_DATAFLOW_IN,
            KSPIN_COMMUNICATION_NONE,
            (GUID*)&KSCATEGORY_AUDIO,
            NULL,
            0
        }
    }
};

static const PCNODE_DESCRIPTOR WaveNodes[] = {
    {
        0,
        NULL,
        (GUID*)&KSNODETYPE_ADC,
        NULL
    }
};

static const PCCONNECTION_DESCRIPTOR WaveConnections[] = {
    { PCFILTER_NODE, 1, 0, 1 },
    { 0, 0, PCFILTER_NODE, 0 }
};

static const GUID WaveCategories[] = {
    STATICGUIDOF(KSCATEGORY_AUDIO),
    STATICGUIDOF(KSCATEGORY_CAPTURE),
    STATICGUIDOF(KSCATEGORY_REALTIME)
};

static const PCFILTER_DESCRIPTOR WaveFilterDescriptor = {
    0,
    NULL,
    sizeof(PCPIN_DESCRIPTOR),
    SIZEOF_ARRAY(WavePins),
    WavePins,
    sizeof(PCNODE_DESCRIPTOR),
    SIZEOF_ARRAY(WaveNodes),
    WaveNodes,
    sizeof(PCCONNECTION_DESCRIPTOR),
    SIZEOF_ARRAY(WaveConnections),
    WaveConnections,
    SIZEOF_ARRAY(WaveCategories),
    WaveCategories
};

/*
 * Forward declaration of DPC routine
 */
KDEFERRED_ROUTINE WaveRTServicingDpcRoutine;

/*
 * CMiniportWaveRTCaptureStream
 * Real-time WaveRT capture stream reading from mapped kernel shared segment
 * with periodic timer servicing and notification delivery.
 */
class CMiniportWaveRTCaptureStream : public IMiniportWaveRTStreamNotification, public CUnknown {
private:
    PVOID m_pDmaBuffer;
    ULONG m_ulDmaBufferSize;
    ULONG m_ulNotificationIntervalMs;
    ULONG m_ulPosition;
    ULONGLONG m_ullLinearPosition;
    JaMeetKernelConsumer m_Consumer;
    BOOLEAN m_bFloatFormat;
    KTIMER m_Timer;
    KDPC m_Dpc;
    PKEVENT m_pNotificationEvents[2];
    ULONG m_ulNotificationEventCount;
    KSSTATE m_StreamState;

public:
    DECLARE_STD_UNKNOWN();

    CMiniportWaveRTCaptureStream(PUNKNOWN pUnknownOuter) : CUnknown(pUnknownOuter) {
        m_pDmaBuffer = NULL;
        m_ulDmaBufferSize = 0;
        m_ulNotificationIntervalMs = 10; /* Default 10 ms quantum (480 frames) */
        m_ulPosition = 0;
        m_ullLinearPosition = 0;
        m_bFloatFormat = TRUE;
        m_ulNotificationEventCount = 0;
        m_pNotificationEvents[0] = NULL;
        m_pNotificationEvents[1] = NULL;
        m_StreamState = KSSTATE_STOP;

        JaMeetKernelConsumer_Init(&m_Consumer);
        KeInitializeTimer(&m_Timer);
        KeInitializeDpc(&m_Dpc, WaveRTServicingDpcRoutine, this);
    }

    ~CMiniportWaveRTCaptureStream() {
        KeCancelTimer(&m_Timer);
        if (m_pDmaBuffer) {
            ExFreePool(m_pDmaBuffer);
            m_pDmaBuffer = NULL;
        }
    }

    /* IMiniportWaveRTStream methods */
    STDMETHODIMP SetState(IN KSSTATE State) {
        m_StreamState = State;
        if (State == KSSTATE_RUN) {
            m_Consumer.active = TRUE;
            /* Start periodic timer servicing every 10 ms */
            LARGE_INTEGER dueTime;
            dueTime.QuadPart = -100000LL; /* 10 ms relative due time */
            KeSetTimerEx(&m_Timer, dueTime, 10 /* 10 ms period */, &m_Dpc);
        } else if (State == KSSTATE_STOP) {
            KeCancelTimer(&m_Timer);
            m_Consumer.active = FALSE;
            m_ulPosition = 0;
        } else if (State == KSSTATE_PAUSE) {
            KeCancelTimer(&m_Timer);
        }
        return STATUS_SUCCESS;
    }

    STDMETHODIMP GetPosition(OUT PKSAUDIO_POSITION Position) {
        if (!Position) return STATUS_INVALID_PARAMETER;
        Position->PlayOffset = m_ulPosition;
        Position->WriteOffset = m_ulPosition;
        return STATUS_SUCCESS;
    }

    STDMETHODIMP AllocateAudioBuffer(
        IN ULONG RequestedSize,
        OUT PMDL* AudioBufferMdl,
        OUT ULONG* ActualSize,
        OUT ULONG* OffsetFromFirstPage,
        OUT MEMORY_CACHING_TYPE* CacheType
    ) {
        if (!AudioBufferMdl || !ActualSize || !OffsetFromFirstPage || !CacheType) {
            return STATUS_INVALID_PARAMETER;
        }

        ULONG bufferSize = RequestedSize;
        if (bufferSize < 4800 * sizeof(float) * 2) {
            bufferSize = 4800 * sizeof(float) * 2; /* 100 ms buffer */
        }

        PVOID pBuffer = ExAllocatePool2(POOL_FLAG_NON_PAGED, bufferSize, 'TMJR');
        if (!pBuffer) return STATUS_INSUFFICIENT_RESOURCES;

        memset(pBuffer, 0, bufferSize);

        PMDL pMdl = IoAllocateMdl(pBuffer, bufferSize, FALSE, FALSE, NULL);
        if (!pMdl) {
            ExFreePool(pBuffer);
            return STATUS_INSUFFICIENT_RESOURCES;
        }

        MmBuildMdlForNonPagedPool(pMdl);

        m_pDmaBuffer = pBuffer;
        m_ulDmaBufferSize = bufferSize;

        *AudioBufferMdl = pMdl;
        *ActualSize = bufferSize;
        *OffsetFromFirstPage = 0;
        *CacheType = MmCached;

        return STATUS_SUCCESS;
    }

    STDMETHODIMP FreeAudioBuffer(IN PMDL AudioBufferMdl, IN ULONG BufferSize) {
        (void)BufferSize;
        if (AudioBufferMdl) {
            IoFreeMdl(AudioBufferMdl);
        }
        if (m_pDmaBuffer) {
            ExFreePool(m_pDmaBuffer);
            m_pDmaBuffer = NULL;
        }
        return STATUS_SUCCESS;
    }

    STDMETHODIMP GetClockRegister(OUT PKSRTAUDIO_HWREGISTER Register) {
        (void)Register;
        return STATUS_NOT_IMPLEMENTED;
    }

    STDMETHODIMP GetPositionRegister(OUT PKSRTAUDIO_HWREGISTER Register) {
        (void)Register;
        return STATUS_NOT_IMPLEMENTED;
    }

    STDMETHODIMP GetHWLatency(OUT PKSRTAUDIO_HWLATENCY Latency) {
        if (!Latency) return STATUS_INVALID_PARAMETER;
        Latency->FifoSize = 0;
        Latency->ChipsetDelay = 0;
        Latency->CodecDelay = 0;
        return STATUS_SUCCESS;
    }

    STDMETHODIMP SetFormat(IN PKSDATAFORMAT DataFormat) {
        if (!DataFormat) return STATUS_INVALID_PARAMETER;
        PWAVEFORMATEXTENSIBLE pWfe = (PWAVEFORMATEXTENSIBLE)(DataFormat + 1);
        if (IsEqualGUID(pWfe->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) {
            m_bFloatFormat = TRUE;
        } else {
            m_bFloatFormat = FALSE;
        }
        return STATUS_SUCCESS;
    }

    /* IMiniportWaveRTStreamNotification methods */
    STDMETHODIMP AllocateBufferWithNotification(
        IN ULONG NotificationCount,
        IN ULONG RequestedSize,
        OUT PMDL* AudioBufferMdl,
        OUT ULONG* ActualSize,
        OUT ULONG* OffsetFromFirstPage,
        OUT MEMORY_CACHING_TYPE* CacheType
    ) {
        if (NotificationCount > 0) {
            m_ulNotificationIntervalMs = 100 / NotificationCount;
            if (m_ulNotificationIntervalMs == 0) m_ulNotificationIntervalMs = 10;
        }
        return AllocateAudioBuffer(RequestedSize, AudioBufferMdl, ActualSize, OffsetFromFirstPage, CacheType);
    }

    STDMETHODIMP FreeBufferWithNotification(IN PMDL AudioBufferMdl, IN ULONG BufferSize) {
        return FreeAudioBuffer(AudioBufferMdl, BufferSize);
    }

    STDMETHODIMP RegisterNotificationEvent(IN PKEVENT NotificationEvent) {
        if (!NotificationEvent) return STATUS_INVALID_PARAMETER;
        if (m_ulNotificationEventCount < SIZEOF_ARRAY(m_pNotificationEvents)) {
            m_pNotificationEvents[m_ulNotificationEventCount++] = NotificationEvent;
            return STATUS_SUCCESS;
        }
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    STDMETHODIMP UnregisterNotificationEvent(IN PKEVENT NotificationEvent) {
        for (ULONG i = 0; i < m_ulNotificationEventCount; i++) {
            if (m_pNotificationEvents[i] == NotificationEvent) {
                m_pNotificationEvents[i] = m_pNotificationEvents[m_ulNotificationEventCount - 1];
                m_ulNotificationEventCount--;
                return STATUS_SUCCESS;
            }
        }
        return STATUS_NOT_FOUND;
    }

    /* Real-time DPC servicing: transfers frames and signals notification events */
    void ServicePeriodicTransfer(void) {
        if (m_StreamState != KSSTATE_RUN || !m_pDmaBuffer) return;

        ULONG framesToRead = 480; /* 10 ms @ 48 kHz */
        JaMeetSharedSegment* seg = JaMeetDispatch_GetKernelSharedSegment();
        ULONG bytesPerFrame = m_bFloatFormat ? (sizeof(float) * 2) : (sizeof(int16_t) * 2);
        ULONG writeOffset = m_ulPosition;

        if (writeOffset + (framesToRead * bytesPerFrame) > m_ulDmaBufferSize) {
            framesToRead = (m_ulDmaBufferSize - writeOffset) / bytesPerFrame;
        }

        LARGE_INTEGER tickCount;
        KeQueryTickCount(&tickCount);
        ULONGLONG nowMs = (tickCount.QuadPart * KeQueryTimeIncrement()) / 10000;

        if (m_bFloatFormat) {
            float* pOut = (float*)((PUCHAR)m_pDmaBuffer + writeOffset);
            JaMeetKernelConsumer_ReadFloatFrames(&m_Consumer, seg, pOut, framesToRead, nowMs);
        } else {
            int16_t* pOut = (int16_t*)((PUCHAR)m_pDmaBuffer + writeOffset);
            JaMeetKernelConsumer_ReadInt16Frames(&m_Consumer, seg, pOut, framesToRead, nowMs);
        }

        m_ulPosition = (writeOffset + (framesToRead * bytesPerFrame)) % m_ulDmaBufferSize;
        m_ullLinearPosition += framesToRead;

        /* Signal registered notification events */
        for (ULONG i = 0; i < m_ulNotificationEventCount; i++) {
            if (m_pNotificationEvents[i]) {
                KeSetEvent(m_pNotificationEvents[i], 0, FALSE);
            }
        }
    }
};

VOID WaveRTServicingDpcRoutine(
    IN PKDPC Dpc,
    IN PVOID DeferredContext,
    IN PVOID SystemArgument1,
    IN PVOID SystemArgument2
) {
    (void)Dpc;
    (void)SystemArgument1;
    (void)SystemArgument2;
    CMiniportWaveRTCaptureStream* pStream = (CMiniportWaveRTCaptureStream*)DeferredContext;
    if (pStream) {
        pStream->ServicePeriodicTransfer();
    }
}

/*
 * CMiniportWaveRT
 * Implements IMiniportWaveRT
 */
class CMiniportWaveRT : public IMiniportWaveRT, public CUnknown {
private:
    PPORTWAVERT m_pPort;

public:
    DECLARE_STD_UNKNOWN();

    CMiniportWaveRT(PUNKNOWN pUnknownOuter) : CUnknown(pUnknownOuter) {
        m_pPort = NULL;
    }

    ~CMiniportWaveRT() {
        if (m_pPort) {
            m_pPort->Release();
            m_pPort = NULL;
        }
    }

    STDMETHODIMP Init(IN PUNKNOWN UnknownAdapter, IN PRESOURCELIST ResourceList, IN PPORTWAVERT Port) {
        (void)UnknownAdapter;
        (void)ResourceList;
        if (!Port) return STATUS_INVALID_PARAMETER;
        m_pPort = Port;
        m_pPort->AddRef();
        return STATUS_SUCCESS;
    }

    STDMETHODIMP GetDescription(OUT PPCFILTER_DESCRIPTOR* Description) {
        if (!Description) return STATUS_INVALID_PARAMETER;
        *Description = (PPCFILTER_DESCRIPTOR)&WaveFilterDescriptor;
        return STATUS_SUCCESS;
    }

    STDMETHODIMP DataRangeIntersection(
        IN ULONG PinId,
        IN PKSDATARANGE DataRange,
        IN PKSDATARANGE MatchingDataRange,
        IN ULONG OutputBufferLength,
        OUT PVOID ResultantFormat OPTIONAL,
        OUT PULONG ResultantFormatLength
    ) {
        (void)PinId;
        (void)DataRange;
        (void)MatchingDataRange;
        (void)OutputBufferLength;
        (void)ResultantFormat;
        (void)ResultantFormatLength;
        return STATUS_NOT_IMPLEMENTED;
    }

    STDMETHODIMP GetDeviceDescription(OUT PDEVICE_DESCRIPTION DeviceDescription) {
        if (!DeviceDescription) return STATUS_INVALID_PARAMETER;
        RtlZeroMemory(DeviceDescription, sizeof(DEVICE_DESCRIPTION));
        DeviceDescription->Master = TRUE;
        DeviceDescription->ScatterGather = TRUE;
        DeviceDescription->Dma32BitAddresses = TRUE;
        DeviceDescription->InterfaceType = Internal;
        return STATUS_SUCCESS;
    }

    STDMETHODIMP NewStream(
        OUT PMINIPORTWAVERTSTREAM* Stream,
        IN PPORTWAVERTSTREAM PortStream,
        IN ULONG Pin,
        IN BOOLEAN Capture,
        IN PKSDATAFORMAT DataFormat
    ) {
        (void)PortStream;
        (void)Pin;
        if (!Stream || !DataFormat || !Capture) return STATUS_INVALID_PARAMETER;

        CMiniportWaveRTCaptureStream* pStream = new (POOL_FLAG_NON_PAGED, 'TMJR') CMiniportWaveRTCaptureStream(NULL);
        if (!pStream) return STATUS_INSUFFICIENT_RESOURCES;

        pStream->SetFormat(DataFormat);

        *Stream = (PMINIPORTWAVERTSTREAM)pStream;
        (*Stream)->AddRef();
        return STATUS_SUCCESS;
    }
};

NTSTATUS CreateMiniportWaveRT(
    OUT PUNKNOWN* Unknown,
    IN REFCLSID ClassId,
    IN PUNKNOWN UnknownOuter OPTIONAL,
    IN POOL_FLAGS PoolFlags
) {
    (void)ClassId;
    (void)PoolFlags;
    if (!Unknown) return STATUS_INVALID_PARAMETER;

    CMiniportWaveRT* p = new (POOL_FLAG_NON_PAGED, 'TMJR') CMiniportWaveRT(UnknownOuter);
    if (!p) return STATUS_INSUFFICIENT_RESOURCES;

    *Unknown = (PUNKNOWN)(IMiniportWaveRT*)p;
    (*Unknown)->AddRef();
    return STATUS_SUCCESS;
}

#endif
