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
        2,     /* Maximum channels */
        32,    /* Minimum bits per sample */
        32,    /* Maximum bits per sample */
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
        2,     /* Maximum channels */
        16,    /* Minimum bits per sample */
        16,    /* Maximum bits per sample */
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

/* Forward declaration of DPC routine */
KDEFERRED_ROUTINE WaveRTServicingDpcRoutine;

/*
 * CMiniportWaveRTCaptureStream
 * Real-time WaveRT capture stream reading from nonpaged kernel shared segment
 * using PortCls IPortWaveRTStream buffer allocation model and cyclic servicing.
 */
class CMiniportWaveRTCaptureStream : public IMiniportWaveRTStreamNotification, public CUnknown {
private:
    PPORTWAVERTSTREAM m_pPortStream;
    PMDL m_pAudioBufferMdl;
    PVOID m_pDmaBuffer;
    ULONG m_ulDmaBufferSize;
    ULONG m_ulNotificationCount;
    ULONG m_ulNotificationIntervalFrames;
    ULONG m_ulNotificationPeriodMs;
    ULONG m_ulPosition;
    ULONGLONG m_ullLinearPosition;
    JaMeetKernelConsumer m_Consumer;
    BOOLEAN m_bFloatFormat;
    KTIMER m_Timer;
    KDPC m_Dpc;
    KSPIN_LOCK m_EventLock;
    PKEVENT m_pNotificationEvents[2];
    ULONG m_ulNotificationEventCount;
    KSSTATE m_StreamState;

public:
    DECLARE_STD_UNKNOWN();

    CMiniportWaveRTCaptureStream(PUNKNOWN pUnknownOuter, PPORTWAVERTSTREAM pPortStream) : CUnknown(pUnknownOuter) {
        m_pPortStream = pPortStream;
        if (m_pPortStream) {
            m_pPortStream->AddRef();
        }
        m_pAudioBufferMdl = NULL;
        m_pDmaBuffer = NULL;
        m_ulDmaBufferSize = 0;
        m_ulNotificationCount = 10;
        m_ulNotificationIntervalFrames = 480; /* Default 10 ms @ 48 kHz */
        m_ulNotificationPeriodMs = 10;
        m_ulPosition = 0;
        m_ullLinearPosition = 0;
        m_bFloatFormat = TRUE;
        m_ulNotificationEventCount = 0;
        m_pNotificationEvents[0] = NULL;
        m_pNotificationEvents[1] = NULL;
        m_StreamState = KSSTATE_STOP;

        JaMeetKernelConsumer_Init(&m_Consumer);
        KeInitializeSpinLock(&m_EventLock);
        KeInitializeTimer(&m_Timer);
        KeInitializeDpc(&m_Dpc, WaveRTServicingDpcRoutine, this);
    }

    ~CMiniportWaveRTCaptureStream() {
        m_StreamState = KSSTATE_STOP;

        /* Cancel timer and dequeue any pending DPC */
        KeCancelTimer(&m_Timer);
        KeRemoveQueueDpc(&m_Dpc);

        /* Flush queued/running DPCs across all processors to guarantee no DPC can execute */
        KeFlushQueuedDpcs();

        /* Unmap and free PortCls allocated WaveRT audio buffer */
        if (m_pPortStream && m_pAudioBufferMdl) {
            if (m_pDmaBuffer) {
                m_pPortStream->UnmapAllocatedPages(m_pDmaBuffer, m_pAudioBufferMdl);
                m_pDmaBuffer = NULL;
            }
            m_pPortStream->FreePagesFromMdl(m_pAudioBufferMdl);
            m_pAudioBufferMdl = NULL;
        }

        if (m_pPortStream) {
            m_pPortStream->Release();
            m_pPortStream = NULL;
        }
    }

    /* NonDelegatingQueryInterface implementing SysVAD COM pattern */
    STDMETHODIMP NonDelegatingQueryInterface(REFIID Interface, PVOID* Object) {
        if (!Object) return STATUS_INVALID_PARAMETER;

        if (IsEqualGUID(Interface, IID_IUnknown)) {
            *Object = (PUNKNOWN)(PMINIPORTWAVERTSTREAMNOTIFICATION)this;
        } else if (IsEqualGUID(Interface, IID_IMiniportWaveRTStream)) {
            *Object = (PMINIPORTWAVERTSTREAM)this;
        } else if (IsEqualGUID(Interface, IID_IMiniportWaveRTStreamNotification)) {
            *Object = (PMINIPORTWAVERTSTREAMNOTIFICATION)this;
        } else {
            *Object = NULL;
            return STATUS_INVALID_PARAMETER;
        }

        ((PUNKNOWN)*Object)->AddRef();
        return STATUS_SUCCESS;
    }

    /* IMiniportWaveRTStream methods */
    STDMETHODIMP SetState(IN KSSTATE State) {
        m_StreamState = State;
        if (State == KSSTATE_RUN) {
            m_Consumer.active = TRUE;
            /* Start periodic timer servicing matching exact calculated notification period */
            LARGE_INTEGER dueTime;
            dueTime.QuadPart = -((LONGLONG)m_ulNotificationPeriodMs * 10000LL);
            KeSetTimerEx(&m_Timer, dueTime, m_ulNotificationPeriodMs, &m_Dpc);
        } else if (State == KSSTATE_STOP) {
            KeCancelTimer(&m_Timer);
            KeRemoveQueueDpc(&m_Dpc);
            m_Consumer.active = FALSE;
            m_ulPosition = 0;
        } else if (State == KSSTATE_PAUSE) {
            KeCancelTimer(&m_Timer);
            KeRemoveQueueDpc(&m_Dpc);
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
        if (!AudioBufferMdl || !ActualSize || !OffsetFromFirstPage || !CacheType || !m_pPortStream) {
            return STATUS_INVALID_PARAMETER;
        }

        ULONG bytesPerFrame = m_bFloatFormat ? (sizeof(float) * 2) : (sizeof(int16_t) * 2);
        ULONG minSize = 4800 * bytesPerFrame; /* 100 ms buffer */
        ULONG bufferSize = (RequestedSize >= minSize) ? RequestedSize : minSize;
        bufferSize = (ULONG)ROUND_TO_PAGES(bufferSize);

        PHYSICAL_ADDRESS highAddress;
        highAddress.QuadPart = MAXULONG64;

        PMDL pMdl = NULL;
        NTSTATUS status = m_pPortStream->AllocatePagesForMdl(highAddress, bufferSize, &pMdl);
        if (!NT_SUCCESS(status) || !pMdl) {
            return status;
        }

        PVOID pBuffer = m_pPortStream->MapAllocatedPages(pMdl, MmCached);
        if (!pBuffer) {
            m_pPortStream->FreePagesFromMdl(pMdl);
            return STATUS_INSUFFICIENT_RESOURCES;
        }

        RtlZeroMemory(pBuffer, bufferSize);

        m_pDmaBuffer = pBuffer;
        m_pAudioBufferMdl = pMdl;
        m_ulDmaBufferSize = bufferSize;

        *AudioBufferMdl = pMdl;
        *ActualSize = bufferSize;
        *OffsetFromFirstPage = 0;
        *CacheType = MmCached;

        return STATUS_SUCCESS;
    }

    STDMETHODIMP FreeAudioBuffer(IN PMDL AudioBufferMdl, IN ULONG BufferSize) {
        (void)BufferSize;
        if (m_pPortStream && AudioBufferMdl) {
            if (m_pDmaBuffer) {
                m_pPortStream->UnmapAllocatedPages(m_pDmaBuffer, AudioBufferMdl);
                m_pDmaBuffer = NULL;
            }
            m_pPortStream->FreePagesFromMdl(AudioBufferMdl);
            m_pAudioBufferMdl = NULL;
        }
        m_ulDmaBufferSize = 0;
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
        PWAVEFORMATEX pWfx = (PWAVEFORMATEX)(DataFormat + 1);
        if (pWfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
            (pWfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
             IsEqualGUID(((PWAVEFORMATEXTENSIBLE)pWfx)->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT))) {
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
        NTSTATUS status = AllocateAudioBuffer(RequestedSize, AudioBufferMdl, ActualSize, OffsetFromFirstPage, CacheType);
        if (NT_SUCCESS(status)) {
            m_ulNotificationCount = (NotificationCount > 0) ? NotificationCount : 10;
            ULONG bytesPerFrame = m_bFloatFormat ? (sizeof(float) * 2) : (sizeof(int16_t) * 2);
            ULONG bytesPerNotification = m_ulDmaBufferSize / m_ulNotificationCount;
            m_ulNotificationIntervalFrames = bytesPerNotification / bytesPerFrame;
            if (m_ulNotificationIntervalFrames == 0) {
                m_ulNotificationIntervalFrames = 480;
            }
            m_ulNotificationPeriodMs = (m_ulNotificationIntervalFrames * 1000) / 48000;
            if (m_ulNotificationPeriodMs == 0) {
                m_ulNotificationPeriodMs = 1;
            }
        }
        return status;
    }

    STDMETHODIMP FreeBufferWithNotification(IN PMDL AudioBufferMdl, IN ULONG BufferSize) {
        return FreeAudioBuffer(AudioBufferMdl, BufferSize);
    }

    STDMETHODIMP RegisterNotificationEvent(IN PKEVENT NotificationEvent) {
        if (!NotificationEvent) return STATUS_INVALID_PARAMETER;
        KIRQL oldIrql;
        KeAcquireSpinLock(&m_EventLock, &oldIrql);
        if (m_ulNotificationEventCount < SIZEOF_ARRAY(m_pNotificationEvents)) {
            m_pNotificationEvents[m_ulNotificationEventCount++] = NotificationEvent;
            KeReleaseSpinLock(&m_EventLock, oldIrql);
            return STATUS_SUCCESS;
        }
        KeReleaseSpinLock(&m_EventLock, oldIrql);
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    STDMETHODIMP UnregisterNotificationEvent(IN PKEVENT NotificationEvent) {
        if (!NotificationEvent) return STATUS_INVALID_PARAMETER;
        KIRQL oldIrql;
        KeAcquireSpinLock(&m_EventLock, &oldIrql);
        for (ULONG i = 0; i < m_ulNotificationEventCount; i++) {
            if (m_pNotificationEvents[i] == NotificationEvent) {
                m_pNotificationEvents[i] = m_pNotificationEvents[m_ulNotificationEventCount - 1];
                m_ulNotificationEventCount--;
                KeReleaseSpinLock(&m_EventLock, oldIrql);
                return STATUS_SUCCESS;
            }
        }
        KeReleaseSpinLock(&m_EventLock, oldIrql);
        return STATUS_NOT_FOUND;
    }

    /* Real-time DPC servicing: transfers frames into cyclic buffer with wrap-around support */
    void ServicePeriodicTransfer(void) {
        if (m_StreamState != KSSTATE_RUN || !m_pDmaBuffer || m_ulDmaBufferSize == 0) return;

        ULONG framesToRead = m_ulNotificationIntervalFrames;
        JaMeetSharedSegment* seg = JaMeetDispatch_GetKernelSharedSegment();
        ULONG bytesPerFrame = m_bFloatFormat ? (sizeof(float) * 2) : (sizeof(int16_t) * 2);
        ULONG totalBytesToTransfer = framesToRead * bytesPerFrame;
        ULONG writeOffset = m_ulPosition;

        LARGE_INTEGER tickCount;
        KeQueryTickCount(&tickCount);
        ULONGLONG nowMs = (tickCount.QuadPart * KeQueryTimeIncrement()) / 10000;

        /* Check if transfer wraps around cyclic buffer */
        if (writeOffset + totalBytesToTransfer <= m_ulDmaBufferSize) {
            /* Single contiguous span */
            if (m_bFloatFormat) {
                float* pOut = (float*)((PUCHAR)m_pDmaBuffer + writeOffset);
                JaMeetKernelConsumer_ReadFloatFrames(&m_Consumer, seg, pOut, framesToRead, nowMs);
            } else {
                int16_t* pOut = (int16_t*)((PUCHAR)m_pDmaBuffer + writeOffset);
                JaMeetKernelConsumer_ReadInt16Frames(&m_Consumer, seg, pOut, framesToRead, nowMs);
            }
        } else {
            /* Two spans: Span 1 to end of buffer, Span 2 from beginning */
            ULONG span1Bytes = m_ulDmaBufferSize - writeOffset;
            ULONG span1Frames = span1Bytes / bytesPerFrame;
            ULONG span2Frames = framesToRead - span1Frames;

            if (m_bFloatFormat) {
                float* pOut1 = (float*)((PUCHAR)m_pDmaBuffer + writeOffset);
                JaMeetKernelConsumer_ReadFloatFrames(&m_Consumer, seg, pOut1, span1Frames, nowMs);
                float* pOut2 = (float*)m_pDmaBuffer;
                JaMeetKernelConsumer_ReadFloatFrames(&m_Consumer, seg, pOut2, span2Frames, nowMs);
            } else {
                int16_t* pOut1 = (int16_t*)((PUCHAR)m_pDmaBuffer + writeOffset);
                JaMeetKernelConsumer_ReadInt16Frames(&m_Consumer, seg, pOut1, span1Frames, nowMs);
                int16_t* pOut2 = (int16_t*)m_pDmaBuffer;
                JaMeetKernelConsumer_ReadInt16Frames(&m_Consumer, seg, pOut2, span2Frames, nowMs);
            }
        }

        m_ulPosition = (writeOffset + totalBytesToTransfer) % m_ulDmaBufferSize;
        m_ullLinearPosition += framesToRead;

        /* Signal registered notification events under lock */
        KIRQL oldIrql;
        KeAcquireSpinLock(&m_EventLock, &oldIrql);
        for (ULONG i = 0; i < m_ulNotificationEventCount; i++) {
            if (m_pNotificationEvents[i]) {
                KeSetEvent(m_pNotificationEvents[i], 0, FALSE);
            }
        }
        KeReleaseSpinLock(&m_EventLock, oldIrql);
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

    /* NonDelegatingQueryInterface implementing SysVAD COM pattern */
    STDMETHODIMP NonDelegatingQueryInterface(REFIID Interface, PVOID* Object) {
        if (!Object) return STATUS_INVALID_PARAMETER;

        if (IsEqualGUID(Interface, IID_IUnknown)) {
            *Object = (PUNKNOWN)(PMINIPORTWAVERT)this;
        } else if (IsEqualGUID(Interface, IID_IMiniport)) {
            *Object = (PMINIPORT)this;
        } else if (IsEqualGUID(Interface, IID_IMiniportWaveRT)) {
            *Object = (PMINIPORTWAVERT)this;
        } else {
            *Object = NULL;
            return STATUS_INVALID_PARAMETER;
        }

        ((PUNKNOWN)*Object)->AddRef();
        return STATUS_SUCCESS;
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
        if (!DataRange || !MatchingDataRange || !ResultantFormatLength) {
            return STATUS_INVALID_PARAMETER;
        }
        if (PinId != 0) {
            return STATUS_NOT_SUPPORTED;
        }

        PKSDATARANGE_AUDIO pDataRangeAudio = (PKSDATARANGE_AUDIO)DataRange;
        PKSDATARANGE_AUDIO pMatchingAudio = (PKSDATARANGE_AUDIO)MatchingDataRange;

        if (!IsEqualGUID(pDataRangeAudio->DataRange.MajorFormat, KSDATAFORMAT_TYPE_AUDIO) ||
            !IsEqualGUID(pMatchingAudio->DataRange.MajorFormat, KSDATAFORMAT_TYPE_AUDIO)) {
            return STATUS_NO_MATCH;
        }

        /* Strict validation: require 48 kHz and at least 2 channels */
        if (pDataRangeAudio->MaximumChannels < 2 ||
            pDataRangeAudio->MinimumSampleFrequency > 48000 ||
            pDataRangeAudio->MaximumSampleFrequency < 48000) {
            return STATUS_NO_MATCH;
        }

        BOOLEAN isFloat = IsEqualGUID(pDataRangeAudio->DataRange.SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) &&
                          IsEqualGUID(pMatchingAudio->DataRange.SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) &&
                          pDataRangeAudio->MinimumBitsPerSample <= 32 &&
                          pDataRangeAudio->MaximumBitsPerSample >= 32;

        BOOLEAN isPcm = IsEqualGUID(pDataRangeAudio->DataRange.SubFormat, KSDATAFORMAT_SUBTYPE_PCM) &&
                        IsEqualGUID(pMatchingAudio->DataRange.SubFormat, KSDATAFORMAT_SUBTYPE_PCM) &&
                        pDataRangeAudio->MinimumBitsPerSample <= 16 &&
                        pDataRangeAudio->MaximumBitsPerSample >= 16;

        if (!isFloat && !isPcm) {
            return STATUS_NO_MATCH;
        }

        ULONG formatSize = sizeof(KSDATAFORMAT_WAVEFORMATEXTENSIBLE);
        *ResultantFormatLength = formatSize;

        if (OutputBufferLength == 0) {
            return STATUS_BUFFER_OVERFLOW;
        }
        if (OutputBufferLength < formatSize) {
            return STATUS_BUFFER_TOO_SMALL;
        }

        PKSDATAFORMAT_WAVEFORMATEXTENSIBLE pResFormat = (PKSDATAFORMAT_WAVEFORMATEXTENSIBLE)ResultantFormat;
        RtlZeroMemory(pResFormat, formatSize);

        pResFormat->DataFormat.FormatSize = formatSize;
        pResFormat->DataFormat.Flags = 0;
        pResFormat->DataFormat.SampleSize = isFloat ? 8 : 4;
        pResFormat->DataFormat.Reserved = 0;
        pResFormat->DataFormat.MajorFormat = KSDATAFORMAT_TYPE_AUDIO;
        pResFormat->DataFormat.SubFormat = isFloat ? KSDATAFORMAT_SUBTYPE_IEEE_FLOAT : KSDATAFORMAT_SUBTYPE_PCM;
        pResFormat->DataFormat.Specifier = KSDATAFORMAT_SPECIFIER_WAVEFORMATEX;

        pResFormat->WaveFormatExt.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
        pResFormat->WaveFormatExt.Format.nChannels = 2;
        pResFormat->WaveFormatExt.Format.nSamplesPerSec = 48000;
        pResFormat->WaveFormatExt.Format.wBitsPerSample = isFloat ? 32 : 16;
        pResFormat->WaveFormatExt.Format.nBlockAlign = (pResFormat->WaveFormatExt.Format.nChannels * pResFormat->WaveFormatExt.Format.wBitsPerSample) / 8;
        pResFormat->WaveFormatExt.Format.nAvgBytesPerSec = pResFormat->WaveFormatExt.Format.nSamplesPerSec * pResFormat->WaveFormatExt.Format.nBlockAlign;
        pResFormat->WaveFormatExt.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
        pResFormat->WaveFormatExt.Samples.wValidBitsPerSample = pResFormat->WaveFormatExt.Format.wBitsPerSample;
        pResFormat->WaveFormatExt.dwChannelMask = KSAUDIO_SPEAKER_STEREO;
        pResFormat->WaveFormatExt.SubFormat = isFloat ? KSDATAFORMAT_SUBTYPE_IEEE_FLOAT : KSDATAFORMAT_SUBTYPE_PCM;

        return STATUS_SUCCESS;
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
        if (!Stream || !DataFormat || !Capture || Pin != 0 || !PortStream) return STATUS_INVALID_PARAMETER;

        /* Validate requested format strictly: 48 kHz stereo 32-bit Float or 16-bit PCM */
        PWAVEFORMATEX pWfx = (PWAVEFORMATEX)(DataFormat + 1);
        if (pWfx->nSamplesPerSec != 48000 || pWfx->nChannels != 2) {
            return STATUS_INVALID_PARAMETER;
        }

        BOOLEAN isFloat = FALSE;
        if (pWfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT && pWfx->wBitsPerSample == 32) {
            isFloat = TRUE;
        } else if (pWfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
            PWAVEFORMATEXTENSIBLE pWfe = (PWAVEFORMATEXTENSIBLE)pWfx;
            if (IsEqualGUID(pWfe->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) && pWfe->Format.wBitsPerSample == 32) {
                isFloat = TRUE;
            } else if (IsEqualGUID(pWfe->SubFormat, KSDATAFORMAT_SUBTYPE_PCM) && pWfe->Format.wBitsPerSample == 16) {
                isFloat = FALSE;
            } else {
                return STATUS_INVALID_PARAMETER;
            }
        } else if (pWfx->wFormatTag == WAVE_FORMAT_PCM && pWfx->wBitsPerSample == 16) {
            isFloat = FALSE;
        } else {
            return STATUS_INVALID_PARAMETER;
        }

        CMiniportWaveRTCaptureStream* pStream = new (POOL_FLAG_NON_PAGED, 'TMJR') CMiniportWaveRTCaptureStream(NULL, PortStream);
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
