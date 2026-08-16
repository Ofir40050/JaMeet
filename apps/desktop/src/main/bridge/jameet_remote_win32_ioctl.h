#ifndef JAMEET_REMOTE_WIN32_IOCTL_H
#define JAMEET_REMOTE_WIN32_IOCTL_H

#ifdef _WIN32
#include <guiddef.h>
#else
#include <stdint.h>
#include <stdbool.h>
#endif

/* Device Interface GUID for JaMeet Remote Control: {8F58E71A-3BC8-4D33-9847-7E1CA25D6B90} */
#ifdef DEFINE_GUID
#ifdef INITGUID
DEFINE_GUID(GUID_DEVINTERFACE_JAMEET_REMOTE,
    0x8F58E71A, 0x3BC8, 0x4D33, 0x98, 0x47, 0x7E, 0x1C, 0xA2, 0x5D, 0x6B, 0x90);
#else
EXTERN_C const GUID GUID_DEVINTERFACE_JAMEET_REMOTE;
#endif
#endif

#define JAMEET_DEVICE_TYPE              0x8542U

/* IOCTL codes with explicit required access (FILE_READ_DATA | FILE_WRITE_DATA) */
#ifndef CTL_CODE
#define CTL_CODE( DeviceType, Function, Method, Access ) ( \
    ((DeviceType) << 16) | ((Access) << 14) | ((Function) << 2) | (Method) \
)
#define METHOD_BUFFERED                 0
#define FILE_READ_DATA                  0x0001
#define FILE_WRITE_DATA                 0x0002
#endif

#define IOCTL_JAMEET_MAP_PRODUCER_VIEW \
    CTL_CODE(JAMEET_DEVICE_TYPE, 0x801, METHOD_BUFFERED, FILE_READ_DATA | FILE_WRITE_DATA)

#define IOCTL_JAMEET_UNMAP_PRODUCER_VIEW \
    CTL_CODE(JAMEET_DEVICE_TYPE, 0x802, METHOD_BUFFERED, FILE_READ_DATA | FILE_WRITE_DATA)

#define IOCTL_JAMEET_GET_STATUS \
    CTL_CODE(JAMEET_DEVICE_TYPE, 0x803, METHOD_BUFFERED, FILE_READ_DATA)

#pragma pack(push, 1)

typedef struct JaMeetMapProducerViewRequest {
    uint32_t magic;         /* JAMEET_SHM_MAGIC (0x4A4D5254) */
    uint32_t abiVersion;    /* JAMEET_ABI_VERSION (1) */
    uint32_t processId;     /* Calling user process ID */
    uint32_t reserved;
} JaMeetMapProducerViewRequest;

typedef struct JaMeetMapProducerViewResponse {
    uint32_t status;        /* 0 = success, non-zero = error */
    uint32_t abiVersion;    /* JAMEET_ABI_VERSION (1) */
    uint64_t viewBase;      /* User-mode base address where section is mapped */
    uint64_t viewSize;      /* Mapped section size in bytes (139392) */
} JaMeetMapProducerViewResponse;

typedef struct JaMeetDriverStatusResponse {
    uint32_t isProducerConnected;
    uint32_t isVoiceActive;
    uint64_t lastHeartbeatMs;
    uint32_t activeClients;
    uint32_t sampleRate;
} JaMeetDriverStatusResponse;

#pragma pack(pop)

#endif /* JAMEET_REMOTE_WIN32_IOCTL_H */
