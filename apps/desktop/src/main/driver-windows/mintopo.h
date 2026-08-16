#ifndef JAMEET_REMOTE_MINTOPO_H
#define JAMEET_REMOTE_MINTOPO_H

#ifdef _WIN32
#include <ntddk.h>
#include <portcls.h>
#endif

#ifdef __cplusplus
extern "C" {
#endif

NTSTATUS CreateMiniportTopology(
    OUT PUNKNOWN* Unknown,
    IN REFCLSID ClassId,
    IN PUNKNOWN UnknownOuter OPTIONAL,
    IN POOL_FLAGS PoolFlags
);

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_MINTOPO_H */
