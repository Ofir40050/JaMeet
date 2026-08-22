#include "mintopo.h"

#ifdef _WIN32

static const KSDATARANGE PinDataRangesBridge[] = {
    {
        sizeof(KSDATARANGE),
        0,
        0,
        0,
        STATICGUIDOF(KSDATAFORMAT_TYPE_AUDIO),
        STATICGUIDOF(KSDATAFORMAT_SUBTYPE_ANALOG),
        STATICGUIDOF(KSDATAFORMAT_SPECIFIER_NONE)
    }
};

static const PKSDATARANGE PinDataRangeBridgePointers[] = {
    (PKSDATARANGE)&PinDataRangesBridge[0]
};

/*
 * Topology Pins for Full-Duplex:
 * Pin 0: Capture Bridge Pin (connected to WaveRT pin 1)
 * Pin 1: Physical Mic Pin (Recording source endpoint)
 * Pin 2: Render Bridge Pin (connected to WaveRT pin 3)
 * Pin 3: Physical Speaker Pin (Playback destination endpoint)
 */
static const PCPIN_DESCRIPTOR TopoPins[] = {
    {
        0, 0, 0,
        NULL,
        {
            0, NULL,
            0, NULL,
            SIZEOF_ARRAY(PinDataRangeBridgePointers),
            PinDataRangeBridgePointers,
            KSPIN_DATAFLOW_OUT,
            KSPIN_COMMUNICATION_NONE,
            (GUID*)&KSCATEGORY_AUDIO,
            NULL,
            0
        }
    },
    {
        0, 0, 0,
        NULL,
        {
            0, NULL,
            0, NULL,
            SIZEOF_ARRAY(PinDataRangeBridgePointers),
            PinDataRangeBridgePointers,
            KSPIN_DATAFLOW_IN,
            KSPIN_COMMUNICATION_NONE,
            (GUID*)&KSCATEGORY_AUDIO,
            (GUID*)&KSNODETYPE_MICROPHONE,
            0
        }
    },
    {
        0, 0, 0,
        NULL,
        {
            0, NULL,
            0, NULL,
            SIZEOF_ARRAY(PinDataRangeBridgePointers),
            PinDataRangeBridgePointers,
            KSPIN_DATAFLOW_IN,
            KSPIN_COMMUNICATION_NONE,
            (GUID*)&KSCATEGORY_AUDIO,
            NULL,
            0
        }
    },
    {
        0, 0, 0,
        NULL,
        {
            0, NULL,
            0, NULL,
            SIZEOF_ARRAY(PinDataRangeBridgePointers),
            PinDataRangeBridgePointers,
            KSPIN_DATAFLOW_OUT,
            KSPIN_COMMUNICATION_NONE,
            (GUID*)&KSCATEGORY_AUDIO,
            (GUID*)&KSNODETYPE_SPEAKER,
            0
        }
    }
};

static const PCNODE_DESCRIPTOR TopoNodes[] = {
    {
        0,
        NULL,
        (GUID*)&KSNODETYPE_ADC,
        NULL
    },
    {
        0,
        NULL,
        (GUID*)&KSNODETYPE_DAC,
        NULL
    }
};

static const PCCONNECTION_DESCRIPTOR TopoConnections[] = {
    { PCFILTER_NODE, 1, 0, 1 },
    { 0, 0, PCFILTER_NODE, 0 },
    { PCFILTER_NODE, 2, 1, 1 },
    { 1, 0, PCFILTER_NODE, 3 }
};

static const GUID TopoCategories[] = {
    STATICGUIDOF(KSCATEGORY_AUDIO),
    STATICGUIDOF(KSCATEGORY_CAPTURE),
    STATICGUIDOF(KSCATEGORY_RENDER),
    STATICGUIDOF(KSCATEGORY_TOPOLOGY)
};

static const PCFILTER_DESCRIPTOR TopoFilterDescriptor = {
    0,
    NULL,
    sizeof(PCPIN_DESCRIPTOR),
    SIZEOF_ARRAY(TopoPins),
    TopoPins,
    sizeof(PCNODE_DESCRIPTOR),
    SIZEOF_ARRAY(TopoNodes),
    TopoNodes,
    sizeof(PCCONNECTION_DESCRIPTOR),
    SIZEOF_ARRAY(TopoConnections),
    TopoConnections,
    SIZEOF_ARRAY(TopoCategories),
    TopoCategories
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

    /* NonDelegatingQueryInterface implementing SysVAD COM pattern */
    STDMETHODIMP NonDelegatingQueryInterface(REFIID Interface, PVOID* Object) {
        if (!Object) return STATUS_INVALID_PARAMETER;

        if (IsEqualGUID(Interface, IID_IUnknown)) {
            *Object = (PUNKNOWN)(PMINIPORTTOPOLOGY)this;
        } else if (IsEqualGUID(Interface, IID_IMiniport)) {
            *Object = (PMINIPORT)this;
        } else if (IsEqualGUID(Interface, IID_IMiniportTopology)) {
            *Object = (PMINIPORTTOPOLOGY)this;
        } else {
            *Object = NULL;
            return STATUS_INVALID_PARAMETER;
        }

        ((PUNKNOWN)*Object)->AddRef();
        return STATUS_SUCCESS;
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
        *Description = (PPCFILTER_DESCRIPTOR)&TopoFilterDescriptor;
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
