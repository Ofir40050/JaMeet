#ifndef JAMEET_REMOTE_MINWAVE_H
#define JAMEET_REMOTE_MINWAVE_H

#ifdef _WIN32
#include <ntddk.h>
#include <portcls.h>
#include <ksdebug.h>
#else
#include <stdint.h>
#include <stdbool.h>
#endif

#include "jameet_remote_kernel_consumer.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Format Specifications */
#define JAMEET_WAVERT_SAMPLE_RATE       48000U
#define JAMEET_WAVERT_CHANNELS          2U
#define JAMEET_WAVERT_BITS_PER_SAMPLE   32U     /* 32-bit IEEE Float primary format */
#define JAMEET_WAVERT_BUFFER_FRAMES     4800U   /* 100 ms cyclic buffer */

#ifdef _WIN32
NTSTATUS CreateMiniportWaveRT(
    OUT PUNKNOWN* Unknown,
    IN REFCLSID ClassId,
    IN PUNKNOWN UnknownOuter OPTIONAL,
    IN POOL_FLAGS PoolFlags
);
#endif

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_MINWAVE_H */
