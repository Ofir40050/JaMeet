#include "minwave.h"
#include "dispatch.h"
#include "jameet_remote_kernel_consumer.h"

#ifdef _WIN32

/*
 * CMiniportWaveRTCaptureStream
 * Real-time lock-free capture stream reading from mapped kernel shared segment.
 */
class CMiniportWaveRTCaptureStream : public IMiniportWaveRTStreamNotification, public CUnknown {
private:
    PVOID m_pDmaBuffer;
    ULONG m_ulDmaBufferSize;
    ULONG m_ulNotificationInterval;
    ULONG m_ulPosition;
    ULONGLONG m_ullLinearPosition;
    JaMeetKernelConsumer m_Consumer;
    BOOLEAN m_bFloatFormat;

public:
    DECLARE_STD_UNKNOWN();

    CMiniportWaveRTCaptureStream(PUNKNOWN pUnknownOuter) : CUnknown(pUnknownOuter) {
        m_pDmaBuffer = NULL;
        m_ulDmaBufferSize = 0;
        m_ulNotificationInterval = 0;
        m_ulPosition = 0;
        m_ullLinearPosition = 0;
        m_bFloatFormat = TRUE;
        JaMeetKernelConsumer_Init(&m_Consumer);
    }

    ~CMiniportWaveRTCaptureStream() {
        if (m_pDmaBuffer) {
            ExFreePool(m_pDmaBuffer);
            m_pDmaBuffer = NULL;
        }
    }

    /* IMiniportWaveRTStream methods */
    STDMETHODIMP SetState(IN KSSTATE State) {
        if (State == KSSTATE_RUN) {
            m_Consumer.active = TRUE;
        } else if (State == KSSTATE_STOP) {
            m_Consumer.active = FALSE;
            m_ulPosition = 0;
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
        PVOID pBuffer = ExAllocatePool2(POOL_FLAG_NON_PAGED, RequestedSize, 'TMJR');
        if (!pBuffer) return STATUS_INSUFFICIENT_RESOURCES;

        PMDL pMdl = IoAllocateMdl(pBuffer, RequestedSize, FALSE, FALSE, NULL);
        if (!pMdl) {
            ExFreePool(pBuffer);
            return STATUS_INSUFFICIENT_RESOURCES;
        }

        MmBuildMdlForNonPagedPool(pMdl);

        m_pDmaBuffer = pBuffer;
        m_ulDmaBufferSize = RequestedSize;

        *AudioBufferMdl = pMdl;
        *ActualSize = RequestedSize;
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
        (void)NotificationCount;
        return AllocateAudioBuffer(RequestedSize, AudioBufferMdl, ActualSize, OffsetFromFirstPage, CacheType);
    }

    STDMETHODIMP FreeBufferWithNotification(IN PMDL AudioBufferMdl, IN ULONG BufferSize) {
        return FreeAudioBuffer(AudioBufferMdl, BufferSize);
    }

    STDMETHODIMP RegisterNotificationEvent(IN PKEVENT NotificationEvent) {
        (void)NotificationEvent;
        return STATUS_SUCCESS;
    }

    STDMETHODIMP UnregisterNotificationEvent(IN PKEVENT NotificationEvent) {
        (void)NotificationEvent;
        return STATUS_SUCCESS;
    }

    /* Real-time audio transfer callback (strictly non-blocking, lock-free) */
    void ServiceTransfer(ULONG framesToRead, ULONGLONG nowMs) {
        if (!m_pDmaBuffer || framesToRead == 0) return;

        JaMeetSharedSegment* seg = JaMeetDispatch_GetKernelSharedSegment();
        ULONG bytesPerFrame = m_bFloatFormat ? (sizeof(float) * 2) : (sizeof(int16_t) * 2);
        ULONG writeOffset = m_ulPosition;

        if (writeOffset + (framesToRead * bytesPerFrame) > m_ulDmaBufferSize) {
            framesToRead = (m_ulDmaBufferSize - writeOffset) / bytesPerFrame;
        }

        if (m_bFloatFormat) {
            float* pOut = (float*)((PUCHAR)m_pDmaBuffer + writeOffset);
            JaMeetKernelConsumer_ReadFloatFrames(&m_Consumer, seg, pOut, framesToRead, nowMs);
        } else {
            int16_t* pOut = (int16_t*)((PUCHAR)m_pDmaBuffer + writeOffset);
            JaMeetKernelConsumer_ReadInt16Frames(&m_Consumer, seg, pOut, framesToRead, nowMs);
        }

        m_ulPosition = (writeOffset + (framesToRead * bytesPerFrame)) % m_ulDmaBufferSize;
        m_ullLinearPosition += framesToRead;
    }
};

#endif
