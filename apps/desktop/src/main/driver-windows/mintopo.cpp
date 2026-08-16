#include "mintopo.h"

#ifdef _WIN32

static const PHYSICALCONNECTIONTABLE TopologyPhysicalConnections[] = {
    { 0, NULL, 0, NULL }
};

class CMiniportTopology : public IMiniportTopology, public CUnknown {
private:
    PPORTTOPOLOGY m_pPort;

public:
    DECLARE_STD_UNKNOWN();

    CMiniportTopology(PUNKNOWN pUnknownOuter) : CUnknown(pUnknownOuter) {
        m_pPort = NULL;
    }

    ~CMiniportTopology() {
        if (m_pPort) {
            m_pPort->Release();
            m_pPort = NULL;
        }
    }

    STDMETHODIMP Init(IN PUNKNOWN UnknownAdapter, IN PRESOURCELIST ResourceList, IN PPORTTOPOLOGY Port) {
        (void)UnknownAdapter;
        (void)ResourceList;
        if (!Port) return STATUS_INVALID_PARAMETER;
        m_pPort = Port;
        m_pPort->AddRef();
        return STATUS_SUCCESS;
    }

    STDMETHODIMP GetDescription(OUT PPCFILTER_DESCRIPTOR* Description) {
        if (!Description) return STATUS_INVALID_PARAMETER;
        *Description = NULL;
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
};

NTSTATUS CreateMiniportTopology(
    OUT PUNKNOWN* Unknown,
    IN REFCLSID ClassId,
    IN PUNKNOWN UnknownOuter OPTIONAL,
    IN POOL_FLAGS PoolFlags
) {
    (void)ClassId;
    (void)PoolFlags;
    if (!Unknown) return STATUS_INVALID_PARAMETER;

    CMiniportTopology* p = new (POOL_FLAG_NON_PAGED, 'TMJR') CMiniportTopology(UnknownOuter);
    if (!p) return STATUS_INSUFFICIENT_RESOURCES;

    *Unknown = (PUNKNOWN)(IMiniportTopology*)p;
    (*Unknown)->AddRef();
    return STATUS_SUCCESS;
}

#endif
